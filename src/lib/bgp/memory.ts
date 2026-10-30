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

/** Roughly the last `limit` keys used, minus an LRU's shuffling on every read */
export class Recent<K, V> {
  #now = new Map<K, V>();
  #before = new Map<K, V>();
  readonly #half: number;

  constructor(limit: number) {
    this.#half = Math.max(1, Math.floor(limit / 2));
  }

  get size() {
    return this.#now.size + this.#before.size;
  }

  get(key: K) {
    const value = this.#now.get(key);
    if (value !== undefined) return value;
    const old = this.#before.get(key);
    if (old !== undefined) this.set(key, old);
    return old;
  }

  set(key: K, value: V) {
    this.#now.set(key, value);
    if (this.#now.size < this.#half) return;
    this.#before = this.#now;
    this.#now = new Map();
  }

  delete(key: K) {
    this.#now.delete(key);
    this.#before.delete(key);
  }
}

/** FNV-1a, cut to 30 bits so V8 keeps it as a small integer */
export function hash(text: string, seed = 2166136261) {
  let value = seed;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value & 0x3fffffff;
}

/** One number for a peer's view of a prefix, without gluing strings together */
export const routeKey = (peer: string, prefix: string) => hash(prefix, hash(peer));

// a prefix can legitimately have a couple of origins (anycast, migrations), so keep a few
const MOST_ORIGINS = 3;

/** What each peer last said about each prefix, and who's been originating it */
export class RouteMemory {
  readonly #paths: Recent<number, number>;
  readonly #origins: Recent<string, Asn[]>;

  constructor(limit = 50_000) {
    this.#paths = new Recent(limit);
    this.#origins = new Recent(limit);
  }

  get size() {
    return { paths: this.#paths.size, origins: this.#origins.size };
  }

  /** Notes the path a peer gave for a prefix, true if it's different from last time */
  announce(peer: string, prefix: string, pathKey: number) {
    const key = routeKey(peer, prefix);
    const before = this.#paths.get(key);
    this.#paths.set(key, pathKey);
    return before !== undefined && before !== pathKey;
  }

  withdraw(peer: string, prefix: string) {
    this.#paths.delete(routeKey(peer, prefix));
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
  let value = 2166136261 ^ rawLength;
  for (const asn of path) value = Math.imul(value ^ asn, 16777619);
  return value & 0x3fffffff;
}
