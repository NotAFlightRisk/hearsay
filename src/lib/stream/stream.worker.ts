import { Detector } from '#lib/bgp/detect.ts';
import { Lru } from '#lib/bgp/memory.ts';
import { parsePrefix, within } from '#lib/bgp/networks.ts';
import { parseRis } from '#lib/bgp/parse.ts';
import type { Anomaly, Update } from '#lib/bgp/types.ts';
import vantagePeers from '#lib/data/vantage.json';
import { parseAsnTable, type AsnTable } from '#lib/geo/asn.ts';
import { createNames } from '#lib/geo/names.ts';
import { createPlacer } from '#lib/geo/place.ts';
import { Ledger } from './ledger.ts';
import {
  levels,
  type FromWorker,
  type Level,
  type Place,
  type Ripple,
  type Route,
  type Tally,
  type ToWorker,
  type Watch
} from './protocol.ts';
import { Vantage, type Peer } from './vantage.ts';

const RIS = 'wss://ris-live.ripe.net/v1/ws/?client=hearsay-peng-ly';
const RIPESTAT = 'https://stat.ripe.net/data';
const FRAME_MS = 100;
const MAX_RETRY_MS = 30_000;
// a watched network can light up a thousand peers at once, so even those get a ceiling
const MOST_WATCHED_ROUTES = 12;
// after this long without a word, the detector's sense of normal is out of date
const STALE_MS = 60_000;

const post = (message: FromWorker) => postMessage(message);
let detector = new Detector();
const vantage = new Vantage(vantagePeers as Peer[]);
const ledger = new Ledger();

let table: AsnTable | undefined;
let place: ReturnType<typeof createPlacer> = () => undefined;
let names: ReturnType<typeof createNames> | undefined;
let countryIndex = new Map<string, number>();
let socket: WebSocket | undefined;
let level: Level = 'standard';
let watch: Watch | null = null;
let paused = false;
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let lastHeard = 0;

const fresh = (): Tally => ({ messages: 0, bytes: 0, announced: 0, withdrawn: 0, changed: 0 });
let tally = fresh();
let routes: Route[] = [];
let ripples: Ripple[] = [];
let countries = new Map<number, [number, number]>();
let anomalies = new Map<string, Anomaly>();
let places = new Map<number, Place>();
let budget = 0;
let watchedBudget = 0;
const blamed = new Lru<string, number[]>(50);
const surges = new Lru<string, Anomaly>(50);

const locate = (asn: number) => place(asn, table?.country(asn));

function send(type: 'ris_subscribe' | 'ris_unsubscribe', data: object) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, data }));
}

const peerFilter = ({ host, peer }: Peer) => ({ host, peer, type: 'UPDATE' });
const watchFilter = (target: Watch) =>
  'asn' in target
    ? { path: `${target.asn}$`, type: 'UPDATE' }
    : { prefix: target.prefix, moreSpecific: true, type: 'UPDATE' };

function connect() {
  clearTimeout(retryTimer);
  if (paused || socket) return;
  post({ type: 'status', status: 'connecting' });
  const ws = new WebSocket(RIS);
  socket = ws;
  ws.onopen = () => {
    retries = 0;
    if (Date.now() - lastHeard > STALE_MS) detector = new Detector();
    for (const peer of vantage.reset(levels[level].peers, Date.now()))
      send('ris_subscribe', peerFilter(peer));
    if (watch) send('ris_subscribe', watchFilter(watch));
    post({ type: 'status', status: 'live' });
  };
  ws.onmessage = (event) => hear(event.data as string);
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = undefined;
    if (paused) return;
    post({ type: 'status', status: 'offline', detail: 'Lost the connection to RIS Live' });
    const wait = Math.min(1000 * 2 ** retries++, MAX_RETRY_MS) * (0.75 + Math.random() / 2);
    retryTimer = setTimeout(connect, wait);
  };
}

function disconnect() {
  clearTimeout(retryTimer);
  const ws = socket;
  socket = undefined;
  ws?.close();
}

function watching(update: Update) {
  if (!watch) return false;
  if ('asn' in watch) return update.origin === watch.asn;
  const range = parsePrefix(watch.prefix);
  return [...update.announced, ...update.withdrawn].some((each) => {
    const prefix = parsePrefix(each);
    return Boolean(range && prefix && within(prefix, range));
  });
}

function count(asn: number | undefined, announced: number, withdrawn: number) {
  const country = asn === undefined ? undefined : table?.country(asn);
  const index = country === undefined ? undefined : countryIndex.get(country);
  if (index === undefined) return;
  const [a, w] = countries.get(index) ?? [0, 0];
  countries.set(index, [a + announced, w + withdrawn]);
}

/** The path as points, origin first, skipping any network we can't put on the map */
function trace(path: number[]) {
  const asns: number[] = [];
  const points: Place[] = [];
  for (const asn of path.toReversed()) {
    const at = locate(asn);
    if (at) {
      asns.push(asn);
      points.push(at);
    }
  }
  return asns.length ? { asns, points } : undefined;
}

function queue(found: Anomaly[]) {
  for (const raw of found) {
    const owners = blamed.get(raw.id);
    const anomaly = owners ? { ...raw, others: owners } : raw;
    anomalies.set(anomaly.id, anomaly);
    for (const asn of [anomaly.asn, ...anomaly.others, ...(anomaly.path ?? [])]) {
      const at = asn ? locate(asn) : undefined;
      if (at) places.set(asn, at);
    }
    if (anomaly.kind === 'surge') {
      surges.set(anomaly.id, anomaly);
      if (!owners) void blame(anomaly);
    }
  }
}

/** A surge's withdrawals don't say whose they were, so ask RIPEstat about a few of them */
async function blame(surge: Anomaly) {
  if (blamed.get(surge.id)) return;
  blamed.set(surge.id, []);
  const owners = new Map<number, number>();
  await Promise.all(
    surge.sample.slice(0, 3).map(async (prefix) => {
      const url = `${RIPESTAT}/network-info/data.json?resource=${prefix.split('/')[0]}&sourceapp=hearsay`;
      const body = await fetch(url).then((response) => (response.ok ? response.json() : undefined));
      for (const asn of body?.data?.asns ?? []) owners.set(+asn, (owners.get(+asn) ?? 0) + 1);
    })
  ).catch(() => {});
  const top = [...owners].sort((a, b) => b[1] - a[1]).map(([asn]) => asn);
  if (!top.length) return;
  blamed.set(surge.id, top.slice(0, 3));
  // the surge has probably grown while RIPEstat was thinking, so update the latest copy
  queue([surges.get(surge.id) ?? surge]);
}

function hear(raw: string) {
  tally.messages++;
  tally.bytes += raw.length;
  const update = parseRis(raw);
  if (!update) return;
  lastHeard = Date.now();
  vantage.heardFrom(update.peer, lastHeard);
  const { changed, anomalies: found } = detector.ingest(update, Date.now());
  queue(found);
  tally.announced += update.announced.length;
  tally.withdrawn += update.withdrawn.length;
  if (changed) tally.changed++;
  const watched = watching(update);

  if (update.announced.length && update.origin !== undefined) {
    ledger.announce(update);
    count(update.origin, update.announced.length, 0);
    if (watched ? watchedBudget-- > 0 : budget-- > 0) {
      const route = trace(update.path);
      if (route) routes.push({ kind: watched ? 4 : changed ? 2 : 0, ...route });
    }
  }

  if (update.withdrawn.length) withdraw(update);
}

/** One message can withdraw routes from several networks, so each gets its own share */
function withdraw(update: Update) {
  const byOrigin = new Map<number | undefined, number>();
  for (const prefix of update.withdrawn) {
    const origin = detector.originOf(prefix);
    byOrigin.set(origin, (byOrigin.get(origin) ?? 0) + 1);
  }
  const from = locate(update.peerAsn);
  for (const [origin, withdrawn] of byOrigin) {
    count(origin, 0, withdrawn);
    if (origin !== undefined) ledger.withdraw(origin, withdrawn, update.time);
    if (budget-- <= 0) continue;
    const to = origin === undefined ? undefined : locate(origin);
    if (from && to) routes.push({ kind: 1, asns: [update.peerAsn, origin!], points: [from, to] });
    const at = to ?? from;
    if (at) ripples.push({ kind: 1, at });
  }
}

function flush() {
  const now = Date.now();
  post({
    type: 'frame',
    tally,
    routes,
    ripples,
    countries: [...countries].map(([index, [a, w]]) => [index, a, w]),
    anomalies: [...anomalies.values()],
    places: [...places].map(([asn, at]) => [asn, ...at]),
    peers: { listening: vantage.listening, heard: vantage.heard(now) }
  });
  tally = fresh();
  routes = [];
  ripples = [];
  countries = new Map();
  anomalies = new Map();
  places = new Map();
  budget = Math.ceil(levels[level].routesPerSecond / (1000 / FRAME_MS));
  watchedBudget = MOST_WATCHED_ROUTES;
}

setInterval(flush, FRAME_MS);
setInterval(() => {
  const now = Date.now();
  queue(detector.tick(now));
  const { add, drop } = vantage.sweep(now);
  for (const peer of drop) send('ris_unsubscribe', peerFilter(peer));
  for (const peer of add) send('ris_subscribe', peerFilter(peer));
}, 1000);

onmessage = async ({ data }: MessageEvent<ToWorker>) => {
  switch (data.type) {
    case 'start': {
      level = data.level;
      countryIndex = new Map(data.world.countries.map((code, index) => [code, index]));
      place = createPlacer(data.world);
      post({ type: 'status', status: 'loading' });
      const response = await fetch(`${data.base}/data/asn.txt`);
      if (!response.ok) throw new Error(`asn.txt answered ${response.status}`);
      table = parseAsnTable(await response.text());
      names = createNames(`${data.base}/data`, table);
      connect();
      break;
    }
    case 'level': {
      level = data.level;
      // a new rate would read as a surge against the old baseline
      detector = new Detector();
      const { add, drop } = vantage.resize(levels[level].peers, Date.now());
      for (const peer of drop) send('ris_unsubscribe', peerFilter(peer));
      for (const peer of add) send('ris_subscribe', peerFilter(peer));
      break;
    }
    case 'pause':
      paused = true;
      disconnect();
      post({ type: 'status', status: 'paused' });
      break;
    case 'resume':
      paused = false;
      connect();
      break;
    case 'watch':
      if (watch) send('ris_unsubscribe', watchFilter(watch));
      watch = data.watch;
      if (watch) send('ris_subscribe', watchFilter(watch));
      break;
    case 'name':
      post({ type: 'name', asn: data.asn, name: await names?.(data.asn) });
      break;
    case 'locate':
      for (const asn of data.asns) {
        const at = locate(asn);
        if (at) places.set(asn, at);
      }
      break;
    case 'inspect':
      post({
        type: 'network',
        network: {
          asn: data.asn,
          country: table?.country(data.asn),
          at: locate(data.asn),
          ...ledger.get(data.asn)
        }
      });
      break;
  }
};
