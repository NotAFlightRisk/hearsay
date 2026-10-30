import { Blame } from '#lib/bgp/blame.ts';
import { Detector, type Thresholds } from '#lib/bgp/detect.ts';
import { parseRis } from '#lib/bgp/parse.ts';
import type { Anomaly, Asn, Update } from '#lib/bgp/types.ts';
import type { AsnTable } from '#lib/geo/asn.ts';
import { Ledger } from '#lib/stream/ledger.ts';
import { levels, type Level, type RelayFrame } from '#lib/stream/protocol.ts';

export const FRAME_MS = 200;
// timers drift on Workers, so a late frame carries a bit more, up to this
const LONGEST_FRAME_MS = 2 * FRAME_MS;
const QUIET_MS = 120_000;
// a peer resending its whole table would otherwise have the globe to itself
const MOST_PER_PEER = 2;

/** With every RIS peer listening, "seen by a few peers" stops meaning much */
export const thresholds: Partial<Thresholds> = {
  prependTimes: 25,
  leakHighPeers: 25,
  originPeers: 3,
  originHighPeers: 25,
  withdrawalPeers: 10,
  withdrawalHighPeers: 25,
  flapPeers: 10,
  bogonPeers: 10,
  memory: 100_000
};

type Route = RelayFrame['routes'][number];
type Withdrawal = RelayFrame['withdrawals'][number];

const routesIn = (level: Level, ms: number) =>
  Math.ceil((levels[level].routesPerSecond * ms) / 1000);

/** A fair random handful of everything offered since the last take */
export class Reservoir<T> {
  #items: T[] = [];
  #seen = 0;
  readonly size: number;

  constructor(size: number) {
    this.size = size;
  }

  offer(item: T) {
    const slot = this.#seen++;
    if (slot < this.size) this.#items.push(item);
    else {
      const pick = Math.floor(Math.random() * (slot + 1));
      if (pick < this.size) this.#items[pick] = item;
    }
  }

  /** Shuffled, so cutting it short for a lighter level is still fair */
  take() {
    const items = this.#items;
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    this.#items = [];
    this.#seen = 0;
    return items;
  }
}

const fresh = () => ({ messages: 0, announced: 0, withdrawn: 0, changed: 0 });

/** Boils the whole RIS Live firehose down to a few KB a second for each browser */
export class Hub {
  readonly #table: AsnTable;
  readonly #ledger = new Ledger({ networks: 20_000, prefixes: 200 });
  readonly #blame: Blame;
  #detector = new Detector(thresholds);
  #routes = new Reservoir<Route>(routesIn('busy', LONGEST_FRAME_MS));
  #withdrawals = new Reservoir<Withdrawal>(Math.ceil(routesIn('busy', LONGEST_FRAME_MS) / 4));
  #turns = new Map<string, number>();
  #heard = new Map<string, number>();
  #tally = fresh();
  #countries = new Map<string, [number, number]>();
  #anomalies = new Map<string, Anomaly>();
  #framedAt = -Infinity;
  #countedAt = 0;

  constructor(table: AsnTable, lookup: (prefix: string) => Promise<Asn[]>) {
    this.#table = table;
    this.#blame = new Blame(lookup, (anomaly) => this.#anomalies.set(anomaly.id, anomaly));
  }

  /** Starts the detector over, as its sense of normal is stale after a gap */
  reset() {
    this.#detector = new Detector(thresholds);
  }

  hear(raw: string, now: number) {
    this.#tally.messages++;
    const update = parseRis(raw);
    if (!update) return;
    this.#heard.set(update.peer, now);
    const { changed, anomalies } = this.#detector.ingest(update, now);
    this.#note(anomalies);
    this.#tally.announced += update.announced.length;
    this.#tally.withdrawn += update.withdrawn.length;
    if (changed) this.#tally.changed++;

    const turns = this.#turns.get(update.peer) ?? 0;
    const offer = turns < MOST_PER_PEER;
    if (offer) this.#turns.set(update.peer, turns + 1);
    if (update.announced.length && update.origin !== undefined) {
      this.#ledger.announce(update);
      this.#count(update.origin, update.announced.length, 0);
      if (offer) this.#routes.offer([changed ? 2 : 0, ...update.path]);
    }
    if (update.withdrawn.length) this.#withdraw(update, offer);
  }

  /** Call about once a second */
  tick(now: number) {
    this.#note(this.#detector.tick(now));
    for (const [peer, at] of this.#heard) if (now - at > QUIET_MS) this.#heard.delete(peer);
  }

  /** Everything since the last frame, cut down to each level's share of routes */
  frame(now: number): Record<Level, RelayFrame> {
    const elapsed = Math.min(Math.max(now - this.#framedAt, FRAME_MS), LONGEST_FRAME_MS);
    this.#framedAt = now;
    const routes = this.#routes.take();
    const withdrawals = this.#withdrawals.take();
    const countries =
      now - this.#countedAt >= 1000
        ? [...this.#countries].map(([code, [a, w]]): [string, number, number] => [code, a, w])
        : undefined;
    if (countries) {
      this.#countries.clear();
      this.#countedAt = now;
    }
    const shared = {
      type: 'frame' as const,
      tally: this.#tally,
      countries,
      anomalies: [...this.#anomalies.values()],
      peers: this.#heard.size
    };
    this.#turns.clear();
    this.#tally = fresh();
    this.#anomalies = new Map();
    const cut = (level: Level): RelayFrame => {
      const size = routesIn(level, elapsed);
      return {
        ...shared,
        routes: routes.slice(0, size),
        withdrawals: withdrawals.slice(0, Math.ceil(size / 4))
      };
    };
    return { light: cut('light'), standard: cut('standard'), busy: cut('busy') };
  }

  network(asn: Asn) {
    return { asn, ...this.#ledger.get(asn) };
  }

  #note(found: Anomaly[]) {
    for (const raw of found) {
      // at this scale the low ones are a constant drizzle, mostly one prefix flapping somewhere
      if (raw.severity === 'low') continue;
      const anomaly = this.#blame.apply(raw);
      this.#anomalies.set(anomaly.id, anomaly);
    }
  }

  /** One message can withdraw routes from several networks, so each gets its own share */
  #withdraw(update: Update, offer: boolean) {
    const byOrigin = new Map<Asn, number>();
    for (const prefix of update.withdrawn) {
      const origin = this.#detector.originOf(prefix);
      if (origin !== undefined) byOrigin.set(origin, (byOrigin.get(origin) ?? 0) + 1);
    }
    for (const [origin, withdrawn] of byOrigin) {
      this.#count(origin, 0, withdrawn);
      this.#ledger.withdraw(origin, withdrawn, update.time);
      if (offer) this.#withdrawals.offer([update.peerAsn, origin]);
    }
  }

  #count(asn: Asn, announced: number, withdrawn: number) {
    const code = this.#table.country(asn);
    if (!code) return;
    const tally = this.#countries.get(code);
    if (tally) {
      tally[0] += announced;
      tally[1] += withdrawn;
    } else this.#countries.set(code, [announced, withdrawn]);
  }
}
