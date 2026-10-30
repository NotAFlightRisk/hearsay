import { Lru } from './memory.ts';
import type { Anomaly, Asn } from './types.ts';

const RIPESTAT = 'https://stat.ripe.net/data';

/** Who RIPEstat reckons originates the address a prefix starts with */
export async function ripestatOwners(prefix: string): Promise<Asn[]> {
  const url = `${RIPESTAT}/network-info/data.json?resource=${prefix.split('/')[0]}&sourceapp=hearsay`;
  const response = await fetch(url);
  if (!response.ok) return [];
  const body = (await response.json()) as { data?: { asns?: (string | number)[] } };
  return (body.data?.asns ?? []).map(Number);
}

/** A surge's withdrawals don't say whose they were, so this asks about a few of them */
export class Blame {
  readonly #owners = new Lru<string, Asn[]>(50);
  readonly #latest = new Lru<string, Anomaly>(50);
  readonly #lookup: (prefix: string) => Promise<Asn[]>;
  readonly #blamed: (anomaly: Anomaly) => void;

  constructor(lookup: (prefix: string) => Promise<Asn[]>, blamed: (anomaly: Anomaly) => void) {
    this.#lookup = lookup;
    this.#blamed = blamed;
  }

  /** The anomaly with whoever's been blamed so far filled in, asking around if it's a new surge */
  apply(anomaly: Anomaly): Anomaly {
    if (anomaly.kind !== 'surge') return anomaly;
    this.#latest.set(anomaly.id, anomaly);
    const owners = this.#owners.get(anomaly.id);
    if (!owners) void this.#ask(anomaly);
    return owners?.length ? { ...anomaly, others: owners } : anomaly;
  }

  async #ask(surge: Anomaly) {
    this.#owners.set(surge.id, []);
    const owners = new Map<Asn, number>();
    await Promise.all(
      surge.sample.slice(0, 3).map(async (prefix) => {
        for (const asn of await this.#lookup(prefix)) owners.set(asn, (owners.get(asn) ?? 0) + 1);
      })
    ).catch(() => {});
    const top = [...owners].sort((a, b) => b[1] - a[1]).map(([asn]) => asn);
    if (!top.length) return;
    this.#owners.set(surge.id, top.slice(0, 3));
    // the surge has probably grown while RIPEstat was thinking, so this sends the latest copy
    this.#blamed(this.apply(this.#latest.get(surge.id) ?? surge));
  }
}
