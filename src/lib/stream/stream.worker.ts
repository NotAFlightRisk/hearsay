import { Blame, ripestatOwners } from '#lib/bgp/blame.ts';
import { Detector } from '#lib/bgp/detect.ts';
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
  OUT_OF_BUDGET,
  type FromRelay,
  type FromWorker,
  type Level,
  type Place,
  type Ripple,
  type Route,
  type Source,
  type Status,
  type Tally,
  type ToRelay,
  type ToWorker,
  type Watch
} from './protocol.ts';
import { Vantage, type Peer } from './vantage.ts';

const RIS = 'wss://ris-live.ripe.net/v1/ws/?client=hearsay-peng-ly';
const FRAME_MS = 100;
const MAX_RETRY_MS = 30_000;
// a relay that's down or out of budget gets left alone for this long
const RELAY_RETRY_MS = 10 * 60_000;
// some servers never answer a WebSocket they don't know, so the relay gets this long to pick up
const RELAY_PATIENCE_MS = 5000;
// anything queued up past this is old news by the time it'd be drawn
const MOST_QUEUED = 300;
// a watched network can light up a thousand peers at once, so even those get a ceiling
const MOST_WATCHED_ROUTES = 12;
// after this long without a word, the detector's sense of normal is out of date
const STALE_MS = 60_000;

const post = (message: FromWorker) => postMessage(message);
// ten-hop prepends turn up every few seconds, so only the truly silly ones make a bulletin
const freshDetector = () => new Detector({ prependTimes: 25 });
let detector = freshDetector();
const vantage = new Vantage(vantagePeers as Peer[]);
const ledger = new Ledger();

let table: AsnTable | undefined;
let place: ReturnType<typeof createPlacer> = () => undefined;
let names: ReturnType<typeof createNames> | undefined;
let countryIndex = new Map<string, number>();
let relayAt = '';
let relay: WebSocket | undefined;
let socket: WebSocket | undefined;
let source: Source = 'relay';
let relayRetryAt = 0;
let relayRetries = 0;
let relayPeers = 0;
let level: Level = 'standard';
let watch: Watch | null = null;
let paused = false;
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let lastHeard = 0;
let loaded: () => void;
// lookups wait for the ASN table, or a deep link asks before there's anything to answer with
const ready = new Promise<void>((resolve) => (loaded = resolve));

const fresh = (): Tally => ({ messages: 0, bytes: 0, announced: 0, withdrawn: 0, changed: 0 });
let tally = fresh();
let routes: Route[] = [];
let ripples: Ripple[] = [];
let countries = new Map<number, [number, number]>();
let anomalies = new Map<string, Anomaly>();
let places = new Map<number, Place>();
let budget = 0;
let watchedBudget = 0;
let queued: (() => void)[] = [];

const locate = (asn: number) => place(asn, table?.country(asn));
const status = (status: Status, detail?: string) =>
  post({ type: 'status', status, source, detail });
const peerCount = () => (source === 'direct' ? levels[level].peers : 0);

function note(anomaly: Anomaly) {
  anomalies.set(anomaly.id, anomaly);
  for (const asn of [anomaly.asn, ...anomaly.others, ...(anomaly.path ?? [])]) {
    const at = asn ? locate(asn) : undefined;
    if (at) places.set(asn, at);
  }
}
const blame = new Blame(ripestatOwners, note);
const noteAll = (found: Anomaly[]) => found.forEach((raw) => note(blame.apply(raw)));

function connect() {
  clearTimeout(retryTimer);
  if (paused) return;
  if (Date.now() >= relayRetryAt) connectRelay();
  else useDirect();
}

function retry() {
  const wait = Math.min(1000 * 2 ** retries++, MAX_RETRY_MS) * (0.75 + Math.random() / 2);
  retryTimer = setTimeout(connect, wait);
}

function connectRelay() {
  if (relay) return;
  if (source === 'relay') status('connecting');
  const ws = new WebSocket(relayAt);
  let opened = false;
  relay = ws;
  setTimeout(() => opened || ws.close(), RELAY_PATIENCE_MS);
  ws.onopen = () => {
    if (relay !== ws) return;
    opened = true;
    relayRetries = 0;
    source = 'relay';
    tell({ type: 'level', level });
    status('live');
    syncDirect();
  };
  ws.onmessage = (event) => hearRelay(event.data as string);
  ws.onclose = (event) => {
    if (relay !== ws) return;
    relay = undefined;
    if (paused) return;
    // one that dropped gets another go soon, one that never answered or is out of budget waits
    const dropped = opened && event.code !== OUT_OF_BUDGET;
    const wait = dropped ? Math.min(1000 * 2 ** relayRetries++, MAX_RETRY_MS) : RELAY_RETRY_MS;
    relayRetryAt = Date.now() + wait;
    useDirect();
  };
}

function useDirect() {
  source = 'direct';
  queued = [];
  detector = freshDetector();
  syncDirect();
  if (socket?.readyState === WebSocket.OPEN) status('live');
}

const tell = (message: ToRelay) => {
  if (relay?.readyState === WebSocket.OPEN) relay.send(JSON.stringify(message));
};

function send(type: 'ris_subscribe' | 'ris_unsubscribe', data: object) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, data }));
}

const peerFilter = ({ host, peer }: Peer) => ({ host, peer, type: 'UPDATE' });
const watchFilter = (target: Watch) =>
  'asn' in target
    ? { path: `${target.asn}$`, type: 'UPDATE' }
    : { prefix: target.prefix, moreSpecific: true, type: 'UPDATE' };

function resubscribe({ add, drop }: { add: Peer[]; drop: Peer[] }) {
  for (const peer of drop) send('ris_unsubscribe', peerFilter(peer));
  for (const peer of add) send('ris_subscribe', peerFilter(peer));
}

/** RIS direct carries a few peers when there's no relay, and the watched network either way */
function syncDirect() {
  if (source === 'relay' && !watch) {
    disconnectDirect();
    vantage.reset(0, Date.now());
  } else if (socket) resubscribe(vantage.resize(peerCount(), Date.now()));
  else connectDirect();
}

function connectDirect() {
  if (paused || socket) return;
  if (source === 'direct') status('connecting');
  const ws = new WebSocket(RIS);
  socket = ws;
  ws.onopen = () => {
    if (source === 'direct') retries = 0;
    if (Date.now() - lastHeard > STALE_MS) detector = freshDetector();
    for (const peer of vantage.reset(peerCount(), Date.now()))
      send('ris_subscribe', peerFilter(peer));
    if (watch) send('ris_subscribe', watchFilter(watch));
    if (source === 'direct') status('live');
  };
  ws.onmessage = (event) => hear(event.data as string);
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = undefined;
    if (paused) return;
    if (source === 'relay') {
      if (watch) setTimeout(syncDirect, 5000);
      return;
    }
    status('offline', 'Lost the connection to RIS Live');
    retry();
  };
}

function disconnectDirect() {
  const ws = socket;
  socket = undefined;
  ws?.close();
}

function disconnect() {
  clearTimeout(retryTimer);
  disconnectDirect();
  const ws = relay;
  relay = undefined;
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

function countryCount(index: number | undefined, announced: number, withdrawn: number) {
  if (index === undefined) return;
  const [a, w] = countries.get(index) ?? [0, 0];
  countries.set(index, [a + announced, w + withdrawn]);
}

function count(asn: number | undefined, announced: number, withdrawn: number) {
  const country = asn === undefined ? undefined : table?.country(asn);
  countryCount(country === undefined ? undefined : countryIndex.get(country), announced, withdrawn);
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

function drawRoute(kind: Route['kind'], path: number[]) {
  const route = trace(path);
  if (route) routes.push({ kind, ...route });
}

function drawWithdrawal(peerAsn: number, origin: number | undefined) {
  const from = locate(peerAsn);
  const to = origin === undefined ? undefined : locate(origin);
  if (from && to) routes.push({ kind: 1, asns: [peerAsn, origin!], points: [from, to] });
  const at = to ?? from;
  if (at) ripples.push({ kind: 1, at });
}

function hear(raw: string) {
  tally.bytes += raw.length;
  const update = parseRis(raw);
  if (!update) return;
  lastHeard = Date.now();
  if (source === 'relay') {
    if (!watching(update) || watchedBudget-- <= 0) return;
    if (update.announced.length) drawRoute(4, update.path);
    else drawWithdrawal(update.peerAsn, undefined);
    return;
  }
  tally.messages++;
  vantage.heardFrom(update.peer, lastHeard);
  const { changed, anomalies: found } = detector.ingest(update, Date.now());
  noteAll(found);
  tally.announced += update.announced.length;
  tally.withdrawn += update.withdrawn.length;
  if (changed) tally.changed++;
  const watched = watching(update);

  if (update.announced.length && update.origin !== undefined) {
    ledger.announce(update);
    count(update.origin, update.announced.length, 0);
    if (watched ? watchedBudget-- > 0 : budget-- > 0) {
      drawRoute(watched ? 4 : changed ? 2 : 0, update.path);
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
  for (const [origin, withdrawn] of byOrigin) {
    count(origin, 0, withdrawn);
    if (origin !== undefined) ledger.withdraw(origin, withdrawn, update.time);
    if (budget-- > 0) drawWithdrawal(update.peerAsn, origin);
  }
}

function hearRelay(raw: string) {
  tally.bytes += raw.length;
  const message = JSON.parse(raw) as FromRelay;
  if (message.type === 'network') {
    const { asn } = message.network;
    post({
      type: 'network',
      network: { ...message.network, country: table?.country(asn), at: locate(asn) }
    });
    return;
  }
  tally.messages += message.tally.messages;
  tally.announced += message.tally.announced;
  tally.withdrawn += message.tally.withdrawn;
  tally.changed += message.tally.changed;
  relayPeers = message.peers;
  for (const [kind, ...path] of message.routes) queued.push(() => drawRoute(kind, path));
  for (const [peer, origin] of message.withdrawals) queued.push(() => drawWithdrawal(peer, origin));
  if (queued.length > MOST_QUEUED) queued = queued.slice(-MOST_QUEUED);
  for (const [code, announced, withdrawn] of message.countries ?? [])
    countryCount(countryIndex.get(code), announced, withdrawn);
  message.anomalies.forEach(note);
}

function flush() {
  const now = Date.now();
  // the relay sends a few frames' worth at a time, and this spreads them out
  while (budget > 0 && queued.length) {
    budget--;
    queued.shift()!();
  }
  post({
    type: 'frame',
    tally,
    routes,
    ripples,
    countries: [...countries].map(([index, [a, w]]) => [index, a, w]),
    anomalies: [...anomalies.values()],
    places: [...places].map(([asn, at]) => [asn, ...at]),
    peers:
      source === 'relay'
        ? { listening: relayPeers, heard: relayPeers }
        : { listening: vantage.listening, heard: vantage.heard(now) }
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
  if (source === 'relay') return;
  const now = Date.now();
  if (!paused && now >= relayRetryAt) connectRelay();
  noteAll(detector.tick(now));
  resubscribe(vantage.sweep(now));
}, 1000);

onmessage = async ({ data }: MessageEvent<ToWorker>) => {
  switch (data.type) {
    case 'start': {
      level = data.level;
      relayAt = `${data.base.replace(/^http/, 'ws')}/feed`;
      countryIndex = new Map(data.world.countries.map((code, index) => [code, index]));
      place = createPlacer(data.world);
      post({ type: 'status', status: 'loading', source });
      const response = await fetch(`${data.base}/data/asn.txt`);
      if (!response.ok) throw new Error(`asn.txt answered ${response.status}`);
      table = parseAsnTable(await response.text());
      names = createNames(`${data.base}/data`, table);
      loaded();
      connect();
      break;
    }
    case 'level':
      level = data.level;
      tell({ type: 'level', level });
      if (source === 'relay') break;
      // a new rate would read as a surge against the old baseline
      detector = freshDetector();
      resubscribe(vantage.resize(peerCount(), Date.now()));
      break;
    case 'pause':
      paused = true;
      disconnect();
      status('paused');
      break;
    case 'resume':
      paused = false;
      connect();
      break;
    case 'watch':
      if (watch) send('ris_unsubscribe', watchFilter(watch));
      watch = data.watch;
      if (watch && socket) send('ris_subscribe', watchFilter(watch));
      else syncDirect();
      break;
    case 'name':
      await ready;
      post({ type: 'name', asn: data.asn, name: await names?.(data.asn) });
      break;
    case 'locate':
      await ready;
      for (const asn of data.asns) {
        const at = locate(asn);
        if (at) places.set(asn, at);
      }
      break;
    case 'inspect':
      await ready;
      // the relay's answer, when it comes, replaces this one
      tell({ type: 'inspect', asn: data.asn });
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
