import { Lru } from '#lib/bgp/memory.ts';
import type { Update } from '#lib/bgp/types.ts';

interface Entry {
  announced: number;
  withdrawn: number;
  prefixes: Set<string>;
  upstreams: Map<number, number>;
  lastSeen: number;
}

// enough prefixes to say "lots", without keeping a big network's whole table
const MOST_PREFIXES = 500;
const MOST_UPSTREAMS = 16;

/** What we've heard about each network since the page opened, for its data block */
export class Ledger {
  #entries = new Lru<number, Entry>(30_000);

  #entry(asn: number) {
    let entry = this.#entries.get(asn);
    if (!entry) {
      entry = {
        announced: 0,
        withdrawn: 0,
        prefixes: new Set(),
        upstreams: new Map(),
        lastSeen: 0
      };
      this.#entries.set(asn, entry);
    }
    return entry;
  }

  announce({ origin, path, announced, time }: Update) {
    if (origin === undefined) return;
    const entry = this.#entry(origin);
    entry.announced += announced.length;
    entry.lastSeen = time;
    for (const prefix of announced) {
      if (entry.prefixes.size < MOST_PREFIXES) entry.prefixes.add(prefix);
    }
    const upstream = path.at(-2);
    if (upstream === undefined) return;
    entry.upstreams.set(upstream, (entry.upstreams.get(upstream) ?? 0) + 1);
    if (entry.upstreams.size > MOST_UPSTREAMS) {
      const [quietest] = [...entry.upstreams].sort((a, b) => a[1] - b[1])[0];
      entry.upstreams.delete(quietest);
    }
  }

  withdraw(origin: number, count: number, time: number) {
    const entry = this.#entry(origin);
    entry.withdrawn += count;
    entry.lastSeen = time;
  }

  get(asn: number) {
    const entry = this.#entries.get(asn);
    return {
      announced: entry?.announced ?? 0,
      withdrawn: entry?.withdrawn ?? 0,
      prefixes: entry?.prefixes.size ?? 0,
      upstreams: [...(entry?.upstreams ?? [])]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([upstream]) => upstream),
      lastSeen: entry?.lastSeen || undefined
    };
  }
}
