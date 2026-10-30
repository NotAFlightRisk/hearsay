// Rebuilds the static datasets the globe runs on: npm run data
import { geoArea, geoBounds, geoContains, geoDistance } from 'd3-geo';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { collectors } from '../src/lib/geo/collectors.ts';

const NATURAL_EARTH =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const NAMES_PER_BUCKET = 1024;
const LONGEST_NAME = 48;
const DOTS_ON_SPHERE = 72_000;
const CITIES_PER_COUNTRY = 12;
const MOST_VANTAGE = 32;
const FULL_V4 = 950_000;
const FULL_V6 = 200_000;
// Natural Earth leaves a few places without an ISO code
const NO_ISO = { SOL: 'SO', CYN: 'CY' };
// registered in asn.txt, but with no country or city of their own in Natural Earth
const TINY = { BQ: [12.2, -68.3], TK: [-9.2, -171.8] };
// Svalbard's nearest neighbour is Greenland, which would file it under North America
const REGION_OF = { SJ: 'eu' };

const out = (path) => new URL(`../${path}`, import.meta.url);
const tenth = (n) => Math.round(n * 10) / 10;

async function download(url, as = 'text') {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response[as]();
}

function write(path, text) {
  writeFileSync(out(path), text);
  const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
  console.log(`${path}: ${kb(Buffer.byteLength(text))}, ${kb(gzipSync(text).length)} gzipped`);
}

function asnTables(text) {
  const rows = text
    .split('\n')
    .map((line) => /^(\d+) (.*), ([A-Z]{2})$/.exec(line))
    .filter(Boolean)
    .map(([, asn, name, country]) => ({ asn: Number(asn), name, country }))
    .sort((a, b) => a.asn - b.asn);
  if (rows.length < 100_000) throw new Error(`asn.txt only had ${rows.length} ASNs in it`);

  const codes = [...new Set(rows.map((row) => row.country))].sort();
  const runs = [];
  for (const { asn, country } of rows) {
    const last = runs.at(-1);
    if (last && asn === last.start + last.length && country === last.country) last.length++;
    else runs.push({ start: asn, length: 1, country });
  }
  let end = 0;
  const lines = runs.map(({ start, length, country }) => {
    const line = `${start - end},${codes.indexOf(country)}${length > 1 ? `,${length}` : ''}`;
    end = start + length;
    return line;
  });
  write('static/data/asn.txt', `${codes.join(',')}\n${lines.join('\n')}\n`);

  rmSync(out('static/data/names'), { recursive: true, force: true });
  mkdirSync(out('static/data/names'), { recursive: true });
  const names = rows.map(({ name }) => {
    const [handle, org] = name.split(' - ', 2);
    return (org || handle).trim().slice(0, LONGEST_NAME).trimEnd();
  });
  for (let start = 0; start < names.length; start += NAMES_PER_BUCKET) {
    const bucket = names.slice(start, start + NAMES_PER_BUCKET).join('\n');
    writeFileSync(out(`static/data/names/${start / NAMES_PER_BUCKET}.txt`), bucket);
  }
  console.log(`static/data/names: ${Math.ceil(names.length / NAMES_PER_BUCKET)} buckets`);
  return { asns: rows.length, codes };
}

const codeOf = ({ ISO_A2, ISO_A2_EH, ADM0_A3 }) =>
  [ISO_A2_EH, ISO_A2].find((code) => /^[A-Z]{2}$/.test(code)) ?? NO_ISO[ADM0_A3];

function regionOf({ REGION_UN, SUBREGION }) {
  if (SUBREGION.startsWith('Seven seas')) return '';
  if (REGION_UN === 'Europe') return 'eu';
  if (REGION_UN === 'Africa') return 'af';
  if (REGION_UN === 'Oceania') return 'oc';
  if (REGION_UN === 'Americas') return SUBREGION === 'South America' ? 'sa' : 'na';
  if (REGION_UN === 'Asia') return SUBREGION === 'Western Asia' ? 'me' : 'as';
  return '';
}

// d3 wants clockwise rings, so anything wound the other way would cover the rest of the planet
function polygon(coordinates) {
  const shape = { type: 'Polygon', coordinates };
  if (geoArea(shape) > 2 * Math.PI)
    shape.coordinates = coordinates.map((ring) => ring.toReversed());
  const [[west, south], [east, north]] = geoBounds(shape);
  return { shape, west, south, east, north };
}

const inside = ({ west, south, east, north }, lon, lat) =>
  lat >= south &&
  lat <= north &&
  (west <= east ? lon >= west && lon <= east : lon >= west || lon <= east);

function citiesByCountry(placesGeo, byA3) {
  const grouped = new Map();
  for (const { properties: place } of placesGeo.features) {
    const code = place.iso_a2 !== '-99' ? place.iso_a2 : byA3.get(place.adm0_a3);
    if (!/^[A-Z]{2}$/.test(code ?? '') || !place.pop_max) continue;
    grouped.set(code, [...(grouped.get(code) ?? []), place]);
  }
  return Object.fromEntries(
    [...grouped]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, places]) => [
        code,
        places
          .sort((a, b) => b.pop_max - a.pop_max)
          .slice(0, CITIES_PER_COUNTRY)
          .flatMap((place) => [
            tenth(place.latitude),
            tenth(place.longitude),
            Math.round(Math.sqrt(place.pop_max))
          ])
      ])
  );
}

function worldData(countriesGeo, placesGeo) {
  const shapes = [];
  const best = new Map();
  for (const { properties, geometry } of countriesGeo.features) {
    const code = codeOf(properties);
    if (!code) continue;
    const parts = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const area = parts.reduce((sum, part) => {
      const piece = polygon(part);
      shapes.push({ code, ...piece });
      return sum + geoArea(piece.shape);
    }, 0);
    if (area > (best.get(code)?.area ?? -1)) best.set(code, { area, properties });
  }

  const byA3 = new Map(
    countriesGeo.features.map(({ properties }) => [properties.ADM0_A3, codeOf(properties)])
  );
  const cities = citiesByCountry(placesGeo, byA3);
  const centres = Object.fromEntries(
    [...best].map(([code, { properties }]) => [
      code,
      [tenth(properties.LABEL_Y), tenth(properties.LABEL_X)]
    ])
  );
  const regionByCode = new Map(
    [...best].map(([code, { properties }]) => [code, regionOf(properties)])
  );

  // overseas bits Natural Earth folds into another country borrow their nearest neighbour's region
  const distance = ([lat, lon], [otherLat, otherLon]) =>
    geoDistance([lon, lat], [otherLon, otherLat]);
  for (const code of [...Object.keys(cities), ...Object.keys(TINY)]) {
    if (best.has(code) || centres[code]) continue;
    const centre = TINY[code] ?? cities[code].slice(0, 2);
    const [nearest] = [...best.keys()].sort(
      (a, b) => distance(centre, centres[a]) - distance(centre, centres[b])
    );
    centres[code] = centre;
    regionByCode.set(code, REGION_OF[code] ?? regionByCode.get(nearest));
  }

  const countries = Object.keys(centres).sort();
  const index = new Map(countries.map((code, i) => [code, i]));
  const regions = countries.map((code) => regionByCode.get(code));

  const dots = [];
  const dotted = new Set();
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < DOTS_ON_SPHERE; i++) {
    const lat = (Math.asin(1 - (2 * (i + 0.5)) / DOTS_ON_SPHERE) * 180) / Math.PI;
    const lon = (((((i * golden * 180) / Math.PI) % 360) + 540) % 360) - 180;
    const hit = shapes.find(
      (piece) => inside(piece, lon, lat) && geoContains(piece.shape, [lon, lat])
    );
    if (!hit) continue;
    dots.push(Math.round(lat * 10), Math.round(lon * 10), index.get(hit.code));
    dotted.add(hit.code);
  }
  for (const code of countries.filter((code) => !dotted.has(code))) {
    const [lat, lon] = centres[code];
    dots.push(Math.round(lat * 10), Math.round(lon * 10), index.get(code));
  }

  write('static/data/world.json', JSON.stringify({ countries, regions, dots, cities, centres }));
  return { dots: dots.length / 3, countries };
}

function vantage(peers) {
  const full = (peer) => (peer.v4_prefix_count > FULL_V4) + (peer.v6_prefix_count > FULL_V6);
  const picks = new Map();
  for (const [host, list] of Object.entries(peers)) {
    if (!collectors[host]) continue;
    for (const peer of list.filter((peer) => full(peer) > 0)) {
      const v6 = peer.ip.includes(':');
      const key = `${host} ${v6}`;
      const size = (candidate) =>
        full(candidate) * 1e7 + candidate[v6 ? 'v6_prefix_count' : 'v4_prefix_count'];
      if (!picks.has(key) || size(peer) > size(picks.get(key))) picks.set(key, peer);
    }
  }

  const queues = new Map();
  for (const [key, peer] of picks) {
    const [host, v6] = key.split(' ');
    const { region } = collectors[host];
    queues.set(region, [
      ...(queues.get(region) ?? []),
      { host, peer: peer.ip, asn: Number(peer.asn), v6: v6 === 'true', region, size: full(peer) }
    ]);
  }
  // biggest tables first, then alternate families so v6 turns up early
  for (const [region, queue] of queues) {
    queue.sort((a, b) => b.size - a.size);
    const [v4, v6] = [queue.filter((peer) => !peer.v6), queue.filter((peer) => peer.v6)];
    queues.set(
      region,
      v4
        .flatMap((peer, i) => [peer, v6[i]])
        .concat(v6.slice(v4.length))
        .filter(Boolean)
    );
  }

  const order = [...queues.keys()].sort((a, b) => queues.get(b).length - queues.get(a).length);
  const list = [];
  while (list.length < MOST_VANTAGE && order.some((region) => queues.get(region).length)) {
    for (const region of order) {
      const next = queues.get(region).shift();
      if (next && list.length < MOST_VANTAGE) list.push(next);
    }
  }
  if (list.length < 8) throw new Error(`only found ${list.length} full-table peers`);
  // a network we've already got moves to the back, so any slice from the front stays varied
  const seen = new Set();
  const fresh = list.filter((peer) => !seen.has(peer.asn) && seen.add(peer.asn));
  const ordered = [...fresh, ...list.filter((peer) => !fresh.includes(peer))];
  write(
    'src/lib/data/vantage.json',
    `${JSON.stringify(
      ordered.map(({ size, ...peer }) => peer),
      null,
      2
    )}\n`
  );
  return list.length;
}

const [asnText, countriesGeo, placesGeo, risPeers] = await Promise.all([
  download('https://ftp.ripe.net/ripe/asnames/asn.txt'),
  download(`${NATURAL_EARTH}/ne_50m_admin_0_countries.geojson`, 'json'),
  download(`${NATURAL_EARTH}/ne_10m_populated_places_simple.geojson`, 'json'),
  download('https://stat.ripe.net/data/ris-peers/data.json?sourceapp=hearsay', 'json')
]);
mkdirSync(out('static/data'), { recursive: true });
mkdirSync(out('src/lib/data'), { recursive: true });
const { asns, codes } = asnTables(asnText);
const world = worldData(countriesGeo, placesGeo);
const homeless = codes.filter(
  (code) => !['EU', 'AP'].includes(code) && !world.countries.includes(code)
);
console.log(`${asns} ASNs, ${world.dots} dots`);
if (homeless.length)
  console.warn(`No idea where these are, so their ASNs won't be placed: ${homeless}`);
console.log(`${vantage(risPeers.data.peers)} vantage peers`);
