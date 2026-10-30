import { Lru, RouteMemory, pathKey } from './memory.ts';
import { clique, prefixTrouble, reservedAsn } from './networks.ts';
import type { Anomaly, AnomalyKind, Asn, Severity, Update } from './types.ts';

const MINUTE = 60_000;

export const defaults = {
  leakPrefixes: 20,
  leakHighPrefixes: 200,
  leakHighPeers: 3,
  leakWindow: 10 * MINUTE,
  originPrefixes: 2,
  originMediumPrefixes: 5,
  originHighPrefixes: 50,
  originHighPeers: 3,
  originWindow: 10 * MINUTE,
  withdrawalPrefixes: 20,
  withdrawalHighPrefixes: 100,
  withdrawalHighPeers: 2,
  withdrawalWindow: MINUTE,
  surgeWarmup: 2 * MINUTE,
  surgeSpan: 10_000,
  surgeFactor: 4,
  /** prefixes withdrawn a second, below which nothing counts as a surge */
  surgeFloor: 20,
  /** how slowly the normal withdrawal rate moves */
  surgeBaseline: 5 * MINUTE,
  flapToggles: 6,
  flapWindow: 5 * MINUTE,
  overSpecificPrefixes: 3,
  oddityWindow: 10 * MINUTE,
  prependTimes: 10,
  /** a story that's still growing comes back at most this often */
  throttle: 5_000,
  expireAfter: 15 * MINUTE,
  memory: 50_000,
  stories: 2_000
};

export type Thresholds = typeof defaults;

interface Story {
  anomaly: Anomaly;
  prefixSet: Set<string>;
  peerSet: Set<string>;
  fired: boolean;
  /** bogons only: a reserved ASN or prefix, not just an over-specific one */
  reserved: boolean;
  sent?: { at: number; severity: Severity; prefixes: number; peers: number; count: number };
}

interface Flap {
  toggles: number;
  since: number;
  withdrawn: boolean;
}

const MOST_PREFIXES = 10_000;
const MOST_PEERS = 2_000;
const MOST_OTHERS = 6;
const SAMPLE = 5;
// a prefix flapping ten times a second still only counts once a tick towards a surge
const MOST_PENDING = 2_000;

/** A network sat between two tier-1s, as [before, leaker, after] */
function findLeak(path: readonly Asn[]): [Asn, Asn, Asn] | undefined {
  for (let i = 1; i < path.length - 1; i++) {
    const [before, leaker, after] = [path[i - 1], path[i], path[i + 1]];
    if (before !== after && !clique.has(leaker) && clique.has(before) && clique.has(after)) {
      return [before, leaker, after];
    }
  }
}

function add({ anomaly, prefixSet }: Story, prefix: string) {
  if (prefixSet.has(prefix) || prefixSet.size >= MOST_PREFIXES) return;
  prefixSet.add(prefix);
  if (anomaly.sample.length < SAMPLE) anomaly.sample.push(prefix);
}

function addOthers({ anomaly }: Story, ...asns: Asn[]) {
  for (const asn of asns) {
    if (anomaly.others.length < MOST_OTHERS && !anomaly.others.includes(asn)) {
      anomaly.others.push(asn);
    }
  }
}

const snapshot = ({ anomaly, prefixSet, peerSet }: Story): Anomaly => ({
  ...anomaly,
  others: [...anomaly.others],
  sample: [...anomaly.sample],
  path: anomaly.path && [...anomaly.path],
  prefixes: prefixSet.size,
  peers: peerSet.size
});

/** Watches the stream for leaks, hijack-ish origin changes, outages and general weirdness */
export class Detector {
  readonly #limits: Thresholds;
  readonly #windows: Record<AnomalyKind, number>;
  readonly #memory: RouteMemory;
  readonly #stories: Lru<string, Story>;
  readonly #flaps: Lru<string, Flap>;
  readonly #touched = new Set<Story>();
  #started?: number;
  #lastTick?: number;
  /** normal withdrawals a second: a plain average while warming up, slow-moving after */
  #baseline = 0;
  #warmCount = 0;
  #warmTime = 0;
  #pending = new Set<string>();
  #pendingPeers = new Set<string>();
  #recent: { at: number; count: number; elapsed: number }[] = [];
  #surge?: Story;

  constructor(thresholds: Partial<Thresholds> = {}) {
    const limits = { ...defaults, ...thresholds };
    this.#limits = limits;
    this.#windows = {
      leak: limits.leakWindow,
      origin: limits.originWindow,
      withdrawals: limits.withdrawalWindow,
      surge: limits.surgeSpan,
      flap: limits.flapWindow,
      bogon: limits.oddityWindow,
      prepend: limits.oddityWindow
    };
    this.#memory = new RouteMemory(limits.memory);
    this.#stories = new Lru(limits.stories);
    this.#flaps = new Lru(Math.ceil(limits.memory / 5));
  }

  originOf(prefix: string) {
    return this.#memory.origins(prefix)?.[0];
  }

  ingest(update: Update, now: number) {
    this.#started ??= now;
    const { peer, path, origin, announced, withdrawn, prepend } = update;
    let changed = false;

    if (announced.length) {
      const key = pathKey(path, update.rawLength);
      const leak = findLeak(path);
      const leakStory = leak && this.#touch('leak', leak[1], peer, now);
      if (leakStory) {
        addOthers(leakStory, leak[0], leak[2]);
        leakStory.anomaly.path ??= [...path];
      }
      const reserved = path.filter(reservedAsn);
      const bogon = () => this.#touch('bogon', origin ?? 0, peer, now);
      const prepender =
        prepend && prepend.times >= this.#limits.prependTimes
          ? this.#touch('prepend', prepend.asn, peer, now)
          : undefined;
      if (prepender) prepender.anomaly.path ??= [...path];

      for (const prefix of announced) {
        if (this.#memory.announce(peer, prefix, key)) changed = true;
        this.#toggle(peer, prefix, false, origin, now);
        if (origin !== undefined) this.#checkOrigin(prefix, origin, path, peer, now);
        if (leakStory) add(leakStory, prefix);
        if (prepender) add(prepender, prefix);
        const trouble = prefixTrouble(prefix);
        if (trouble || reserved.length) {
          const story = bogon();
          story.reserved ||= trouble === 'bogon' || reserved.length > 0;
          addOthers(story, ...reserved);
          add(story, prefix);
        }
      }
    }

    for (const prefix of withdrawn) {
      this.#memory.withdraw(peer, prefix);
      const owner = this.originOf(prefix);
      this.#toggle(peer, prefix, true, owner, now);
      if (this.#pending.size < MOST_PENDING) this.#pending.add(prefix);
      if (this.#pendingPeers.size < MOST_PEERS) this.#pendingPeers.add(peer);
      if (owner !== undefined) add(this.#touch('withdrawals', owner, peer, now), prefix);
    }

    const anomalies: Anomaly[] = [];
    for (const story of this.#touched) this.#consider(story, now, anomalies);
    this.#touched.clear();
    return { changed, anomalies };
  }

  /** Call about once a second: rate checks, stragglers coming off the throttle, and tidying up */
  tick(now: number) {
    this.#started ??= now;
    const anomalies: Anomaly[] = [];
    this.#watchSurge(now, anomalies);
    for (const [id, story] of this.#stories.entries()) {
      const { kind, first, last } = story.anomaly;
      const over = story.fired
        ? now - last > this.#limits.expireAfter
        : now - first > this.#windows[kind];
      if (over) this.#stories.delete(id);
      else if (story.fired) this.#consider(story, now, anomalies);
    }
    return anomalies;
  }

  #story(kind: AnomalyKind, subject: string | number, asn: Asn, now: number) {
    const id = `${kind}:${subject}`;
    let story = this.#stories.get(id);
    // a trickle that never got going within its window starts again from scratch
    if (!story || (!story.fired && now - story.anomaly.first > this.#windows[kind])) {
      story = {
        anomaly: {
          id,
          kind,
          severity: 'low',
          asn,
          others: [],
          prefixes: 0,
          sample: [],
          peers: 0,
          count: 0,
          first: now,
          last: now
        },
        prefixSet: new Set(),
        peerSet: new Set(),
        fired: false,
        reserved: false
      };
      this.#stories.set(id, story);
    }
    return story;
  }

  /** The story for this subject, counted once per update however many prefixes it brings */
  #touch(kind: AnomalyKind, subject: string | number, peer: string, now: number) {
    const story = this.#story(kind, subject, typeof subject === 'number' ? subject : 0, now);
    if (!this.#touched.has(story)) {
      this.#touched.add(story);
      story.anomaly.count++;
      story.anomaly.last = now;
      if (story.peerSet.size < MOST_PEERS) story.peerSet.add(peer);
    }
    return story;
  }

  #checkOrigin(prefix: string, origin: Asn, path: readonly Asn[], peer: string, now: number) {
    const known = this.#memory.origins(prefix);
    // an old origin still in the path is just someone upstream aggregating, not a takeover
    if (known && !known.includes(origin) && !known.some((asn) => path.includes(asn))) {
      const story = this.#touch('origin', origin, peer, now);
      addOthers(story, known[0]);
      story.anomaly.path ??= [...path];
      add(story, prefix);
    }
    this.#memory.rememberOrigin(prefix, origin);
  }

  #toggle(peer: string, prefix: string, withdrawn: boolean, origin: Asn | undefined, now: number) {
    const key = `${peer} ${prefix}`;
    const flap = this.#flaps.get(key);
    // only prefixes that have been withdrawn at least once get watched, which keeps this small
    if (!flap) {
      if (withdrawn) this.#flaps.set(key, { toggles: 1, since: now, withdrawn });
      return;
    }
    if (flap.withdrawn === withdrawn) return;
    flap.withdrawn = withdrawn;
    if (now - flap.since > this.#limits.flapWindow) {
      flap.toggles = 1;
      flap.since = now;
    } else if (++flap.toggles >= this.#limits.flapToggles) {
      const story = this.#touch('flap', prefix, peer, now);
      story.anomaly.asn = origin ?? story.anomaly.asn;
      story.anomaly.prefix = prefix;
      add(story, prefix);
    }
  }

  #judge({ anomaly, prefixSet, peerSet, reserved }: Story): Severity | undefined {
    const limits = this.#limits;
    const prefixes = prefixSet.size;
    const peers = peerSet.size;
    switch (anomaly.kind) {
      case 'leak':
        if (prefixes < limits.leakPrefixes) return;
        return prefixes >= limits.leakHighPrefixes || peers >= limits.leakHighPeers
          ? 'high'
          : 'medium';
      case 'origin':
        // scrubbing services and anycast moves look just like this, so it takes a crowd to be high
        if (prefixes < limits.originPrefixes) return;
        if (prefixes >= limits.originHighPrefixes && peers >= limits.originHighPeers) return 'high';
        return prefixes >= limits.originMediumPrefixes ? 'medium' : 'low';
      case 'withdrawals':
        if (prefixes < limits.withdrawalPrefixes) return;
        if (prefixes >= limits.withdrawalHighPrefixes && peers >= limits.withdrawalHighPeers) {
          return 'high';
        }
        // one peer losing routes says more about that peer than the network
        return peers >= 2 ? 'medium' : 'low';
      case 'flap':
        return peers >= 2 ? 'medium' : 'low';
      case 'bogon':
        if (reserved) return 'medium';
        return prefixes >= limits.overSpecificPrefixes ? 'low' : undefined;
      case 'prepend':
        return 'low';
      case 'surge':
        return anomaly.severity;
    }
  }

  /** Hands back a copy if it's new, changed severity, or grew and is off the throttle */
  #consider(story: Story, now: number, out: Anomaly[]) {
    const severity = this.#judge(story);
    if (!severity) return;
    story.fired = true;
    story.anomaly.severity = severity;
    const prefixes = story.prefixSet.size;
    const peers = story.peerSet.size;
    const { count } = story.anomaly;
    const { sent } = story;
    if (sent?.severity === severity) {
      if (sent.prefixes === prefixes && sent.peers === peers && sent.count === count) return;
      if (now - sent.at < this.#limits.throttle) return;
    }
    story.sent = { at: now, severity, prefixes, peers, count };
    out.push(snapshot(story));
  }

  #watchSurge(now: number, out: Anomaly[]) {
    const limits = this.#limits;
    const elapsed = Math.max(now - (this.#lastTick ?? this.#started ?? now), 1);
    this.#lastTick = now;
    const prefixes = this.#pending;
    const peers = this.#pendingPeers;
    const count = prefixes.size;
    this.#pending = new Set();
    this.#pendingPeers = new Set();

    this.#recent.push({ at: now, count, elapsed });
    while (this.#recent[0].at <= now - limits.surgeSpan) this.#recent.shift();
    const recentCount = this.#recent.reduce((sum, entry) => sum + entry.count, 0);
    const recentTime = this.#recent.reduce((sum, entry) => sum + entry.elapsed, 0);
    const rate = (recentCount * 1000) / recentTime;

    const threshold = Math.max(limits.surgeFloor, this.#baseline * limits.surgeFactor);
    const warm = now - (this.#started ?? now) >= limits.surgeWarmup;
    const surging = warm && rate > threshold;

    if (!warm) {
      this.#warmCount += count;
      this.#warmTime += elapsed;
      this.#baseline = (this.#warmCount * 1000) / this.#warmTime;
    } else {
      // the baseline only learns a capped share of a spike, so a surge can't hide itself
      const tickRate = (count * 1000) / elapsed;
      const sample = Math.min(tickRate, threshold);
      this.#baseline += (1 - Math.exp(-elapsed / limits.surgeBaseline)) * (sample - this.#baseline);
    }

    if (!surging) {
      this.#surge = undefined;
      return;
    }
    const story = (this.#surge ??= this.#story('surge', now, 0, now));
    story.anomaly.count += count;
    story.anomaly.last = now;
    story.anomaly.severity = rate >= threshold * 3 ? 'high' : 'medium';
    for (const prefix of prefixes) add(story, prefix);
    for (const peer of peers) if (story.peerSet.size < MOST_PEERS) story.peerSet.add(peer);
    this.#consider(story, now, out);
  }
}
