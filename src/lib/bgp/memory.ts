import type { Asn } from './types.ts';

/** A Map that forgets whatever was touched longest ago once it's full */
export class Lru<K, V> {
  readonly #items = new Map<K, V>();
  readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  get size() {
    return this.#items.size;
  }

  get(key: K) {
    const value = this.#items.get(key);
    if (value !== undefined) {
      this.#items.delete(key);
      this.#items.set(key, value);
    }
    return value;
  }

  set(key: K, value: V) {
    this.#items.delete(key);
    this.#items.set(key, value);
    if (this.#items.size > this.limit) this.#items.delete(this.#items.keys().next().value as K);
  }

  delete(key: K) {
    return this.#items.delete(key);
  }

  entries() {
    return this.#items.entries();
  }
}

// a prefix can legitimately have a couple of origins (anycast, migrations), so keep a few
const MOST_ORIGINS = 3;

/** What each peer last said about each prefix, and who's been originating it */
export class RouteMemory {
  readonly #paths: Lru<string, number>;
  readonly #origins: Lru<string, Asn[]>;

  constructor(limit = 50_000) {
    this.#paths = new Lru(limit);
    this.#origins = new Lru(limit);
  }

  get size() {
    return { paths: this.#paths.size, origins: this.#origins.size };
  }

  /** Notes the path a peer gave for a prefix, true if it's different from last time */
  announce(peer: string, prefix: string, pathKey: number) {
    const key = `${peer} ${prefix}`;
    const before = this.#paths.get(key);
    this.#paths.set(key, pathKey);
    return before !== undefined && before !== pathKey;
  }

  withdraw(peer: string, prefix: string) {
    this.#paths.delete(`${peer} ${prefix}`);
  }

  /** Origins seen announcing the prefix, most recent first */
  origins(prefix: string): readonly Asn[] | undefined {
    return this.#origins.get(prefix);
  }

  rememberOrigin(prefix: string, origin: Asn) {
    const known = this.#origins.get(prefix);
    if (known?.[0] === origin) return;
    const rest = known?.filter((asn) => asn !== origin) ?? [];
    this.#origins.set(prefix, [origin, ...rest].slice(0, MOST_ORIGINS));
  }
}

/** Squashes a path down to a number, so comparing two is cheap */
export function pathKey(path: readonly Asn[], rawLength: number) {
  let hash = 2166136261 ^ rawLength;
  for (const asn of path) hash = Math.imul(hash ^ asn, 16777619);
  return hash >>> 0;
}
