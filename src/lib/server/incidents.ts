import type { Incident } from '#lib/bgp/types.js';
import { report } from './report.ts';

const RADAR = 'https://api.cloudflare.com/client/v4/radar';
const IODA = 'https://api.ioda.inetintel.cc.gatech.edu/v2';
const WAIT_MS = 12_000;
const DAY_S = 24 * 60 * 60;
// per kind, so one chatty source can't crowd out the rest
const MOST_PER_KIND = 10;
const MOST_PER_IODA_KIND = 8;
// seen this widely and dragging this much along, it's not someone's typo
const MAJOR_LEAK = { peers: 10, prefixes: 100 };
const SURE_HIJACK = { confidence: 10, peers: 10 };
// anything shorter is IODA blinking
const SHORTEST_OUTAGE_S = 15 * 60;
// IODA stretches a live outage right up to the moment you ask
const STILL_GOING_S = 10 * 60;

interface RadarReply<T> {
  success: boolean;
  errors: { message: string }[];
  result: T;
}

interface RadarOutage {
  id: string;
  description: string;
  startDate: string;
  endDate: string | null;
  asns: number[];
  locations: string[];
  entities: {
    entityType: string;
    entityValue: string;
    entityName: string;
    entityLocation: string | null;
  }[];
  linkedUrl: string | null;
  outage?: { outageCause?: string };
}

interface RadarLeak {
  id: number;
  leak_asn: number;
  leak_seg: number[];
  countries: string[];
  min_ts: string;
  max_ts: string;
  finished: boolean;
  peer_count: number;
  prefix_count: number;
  origin_count: number;
}

interface RadarHijack {
  id: number;
  hijacker_asn: number;
  hijacker_country: string;
  victim_asns: number[];
  victim_countries: string[];
  prefixes: string[];
  peer_ip_count: number;
  min_hijack_ts: string;
  max_hijack_ts: string;
  is_stale: boolean;
  tags: { name: string; score: number }[];
}

interface IodaEvent {
  location: string;
  location_name: string;
  start: number;
  duration: number;
  score: number;
  datasource: string;
}

const signals: Record<string, string> = {
  bgp: 'Fewer of its routes than usual are visible in BGP',
  'ping-slash24': 'Fewer of its addresses than usual are answering pings',
  gtr: 'Less traffic than usual is reaching Google',
  'merit-nt': "Less stray traffic than usual is reaching Merit's network telescope"
};

// IODA writes "AS11694 ()" or "AS1848 (AS1848)" when it doesn't know a better name
const blankName = /\s*\((?:AS\d+)?\)$/;
const unique = <T>(items: T[]) => [...new Set(items)];
// Radar's BGP feeds leave the zone off, but they're UTC
const utc = (time: string) => new Date(time.endsWith('Z') ? time : `${time}Z`).toISOString();
const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
const listed = (names: string[]) =>
  names.length > 2 ? `${names[0]}, ${names[1]} and ${names.length - 2} more` : names.join(' and ');

async function getJson<T>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(WAIT_MS)
  });
  const { hostname, pathname } = new URL(url);
  if (!res.ok) throw new Error(`${hostname} answered ${res.status} for ${pathname}`);
  return res.json() as Promise<T>;
}

async function radar<T>(path: string, token: string) {
  const reply = await getJson<RadarReply<T>>(`${RADAR}${path}`, token);
  if (!reply.success) {
    throw new Error(`Radar turned down ${path}: ${reply.errors.map((e) => e.message).join(', ')}`);
  }
  return reply.result;
}

function fromOutage(outage: RadarOutage): Incident {
  const { entities } = outage;
  const what = outage.outage?.outageCause === 'GOVERNMENT_DIRECTED' ? 'Shutdown' : 'Outage';
  const where = listed(entities.map((entity) => entity.entityName));
  const preposition = entities[0]?.entityType === 'AS' ? 'at' : 'in';
  return {
    id: `radar-outage-${outage.id}`,
    kind: 'outage',
    source: 'Cloudflare Radar',
    title: where ? `${what} ${preposition} ${where}` : what,
    detail: outage.description,
    start: utc(outage.startDate),
    end: outage.endDate ? utc(outage.endDate) : undefined,
    asns: unique([
      ...outage.asns,
      ...entities.filter((e) => e.entityType === 'AS').map((e) => Number(e.entityValue))
    ]),
    countries: unique([
      ...outage.locations,
      ...entities.flatMap((e) =>
        e.entityType === 'LOCATION' ? [e.entityValue] : e.entityLocation ? [e.entityLocation] : []
      )
    ]),
    url: outage.linkedUrl ?? 'https://radar.cloudflare.com/outage-center'
  };
}

// Radar opens a fresh event for the same leak most days, so fold those together
function merge(a: RadarLeak, b: RadarLeak): RadarLeak {
  const [older, newer] = a.min_ts < b.min_ts ? [a, b] : [b, a];
  return {
    ...newer,
    min_ts: older.min_ts,
    max_ts: older.max_ts > newer.max_ts ? older.max_ts : newer.max_ts,
    finished: older.finished && newer.finished,
    peer_count: Math.max(a.peer_count, b.peer_count),
    prefix_count: Math.max(a.prefix_count, b.prefix_count),
    origin_count: Math.max(a.origin_count, b.origin_count)
  };
}

function fromLeak(leak: RadarLeak): Incident {
  const neighbours = leak.leak_seg.filter((asn) => asn !== leak.leak_asn);
  const between =
    neighbours.length === 2 ? ` between AS${neighbours[0]} and AS${neighbours[1]}` : '';
  const home = leak.countries[leak.leak_seg.indexOf(leak.leak_asn)];
  return {
    id: `radar-leak-${leak.id}`,
    kind: 'leak',
    source: 'Cloudflare Radar',
    title: `AS${leak.leak_asn} leaked routes${between}`,
    detail: `${count(leak.prefix_count, 'prefix', 'prefixes')} from ${count(leak.origin_count, 'network')}, seen from ${count(leak.peer_count, 'vantage point')}`,
    start: utc(leak.min_ts),
    end: leak.finished ? utc(leak.max_ts) : undefined,
    asns: unique([leak.leak_asn, ...neighbours]),
    countries: unique([home, ...leak.countries].filter(Boolean)),
    prefixes: leak.prefix_count,
    url: `https://radar.cloudflare.com/routing/as${leak.leak_asn}`
  };
}

function fromHijack(hijack: RadarHijack): Incident {
  const [victim, ...others] = hijack.victim_asns;
  const whose =
    victim === undefined
      ? "it doesn't own"
      : `belonging to AS${victim}${others.length ? ` and ${count(others.length, 'other')}` : ''}`;
  const invalid = hijack.tags.some(
    (tag) => tag.name === 'rpki_new_origin_invalid' && tag.score > 0
  );
  return {
    id: `radar-hijack-${hijack.id}`,
    kind: 'hijack',
    source: 'Cloudflare Radar',
    title: `AS${hijack.hijacker_asn} announced prefixes ${whose}`,
    detail: `${count(hijack.prefixes.length, 'prefix', 'prefixes')}, seen from ${count(hijack.peer_ip_count, 'vantage point')}${invalid ? '. RPKI marks the new origin as invalid' : ''}`,
    start: utc(hijack.min_hijack_ts),
    end: hijack.is_stale ? utc(hijack.max_hijack_ts) : undefined,
    asns: unique([hijack.hijacker_asn, ...hijack.victim_asns]),
    countries: unique([hijack.hijacker_country, ...hijack.victim_countries].filter(Boolean)),
    prefixes: hijack.prefixes.length,
    url: `https://radar.cloudflare.com/routing/as${hijack.hijacker_asn}`
  };
}

function fromIoda(event: IodaEvent, until: number): Incident {
  const [type, code] = event.location.split('/');
  const country = type === 'country';
  const ends = event.start + event.duration;
  return {
    id: `ioda-${type}-${code}`,
    kind: 'outage',
    source: 'IODA',
    title: `Possible outage ${country ? 'in' : 'at'} ${event.location_name.replace(blankName, '')}`,
    detail: signals[event.datasource.split('.')[0]] ?? 'Its signals dropped below normal',
    start: new Date(event.start * 1000).toISOString(),
    end: ends >= until - STILL_GOING_S ? undefined : new Date(ends * 1000).toISOString(),
    asns: country ? [] : [Number(code)],
    countries: country ? [code] : [],
    url: `https://ioda.inetintel.cc.gatech.edu/${type}/${code}`
  };
}

async function outages(token: string) {
  const { annotations } = await radar<{ annotations: RadarOutage[] }>(
    `/annotations/outages?format=json&dateRange=7d&limit=${MOST_PER_KIND}`,
    token
  );
  return annotations.map(fromOutage);
}

async function leaks(token: string) {
  const { events } = await radar<{ events: RadarLeak[] }>(
    '/bgp/leaks/events?format=json&dateRange=2d&per_page=100&sortBy=PREFIXES&sortOrder=DESC',
    token
  );
  const merged = new Map<string, RadarLeak>();
  for (const leak of events) {
    const key = `${leak.leak_asn}:${leak.leak_seg.join(',')}`;
    const seen = merged.get(key);
    merged.set(key, seen ? merge(seen, leak) : leak);
  }
  return [...merged.values()]
    .filter(
      (leak) => leak.peer_count >= MAJOR_LEAK.peers && leak.prefix_count >= MAJOR_LEAK.prefixes
    )
    .slice(0, MOST_PER_KIND)
    .map(fromLeak);
}

async function hijacks(token: string) {
  const { events } = await radar<{ events: RadarHijack[] }>(
    `/bgp/hijacks/events?format=json&dateRange=2d&per_page=100&minConfidence=${SURE_HIJACK.confidence}&sortBy=CONFIDENCE&sortOrder=DESC`,
    token
  );
  return events
    .filter((hijack) => hijack.peer_ip_count >= SURE_HIJACK.peers)
    .slice(0, MOST_PER_KIND)
    .map(fromHijack);
}

async function ioda(type: 'country' | 'asn', now: number) {
  const until = Math.floor(now / 1000);
  const query = new URLSearchParams({
    entityType: type,
    from: String(until - DAY_S),
    until: String(until),
    format: 'codf',
    limit: '500',
    extendWindow: '0'
  });
  const reply = await getJson<{ error: string | null; data: IodaEvent[] }>(
    `${IODA}/outages/events?${query}`
  );
  if (reply.error) throw new Error(`IODA turned down ${type} outages: ${reply.error}`);
  const worst = new Map<string, IodaEvent>();
  for (const event of reply.data) {
    if (event.duration < SHORTEST_OUTAGE_S) continue;
    const seen = worst.get(event.location);
    if (!seen || event.score > seen.score) worst.set(event.location, event);
  }
  return [...worst.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MOST_PER_IODA_KIND)
    .map((event) => fromIoda(event, until));
}

/** What's gone wrong lately according to Radar and IODA, newest first. A broken source just goes missing */
export async function gatherIncidents(token?: string, now = Date.now()): Promise<Incident[]> {
  const sources = [ioda('country', now), ioda('asn', now)];
  if (token) sources.push(outages(token), leaks(token), hijacks(token));
  const results = await Promise.allSettled(sources);
  await Promise.all(
    results.flatMap((result) => (result.status === 'rejected' ? [report(result.reason)] : []))
  );
  return results
    .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
}
