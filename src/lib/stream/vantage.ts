export interface Peer {
  host: string;
  peer: string;
  asn: number;
  v6: boolean;
  region: string;
}

// a full-table peer this quiet for this long has probably gone away
export const QUIET_MS = 120_000;

/** Keeps a few peers subscribed, and swaps out any that go quiet for the next in line */
export class Vantage {
  #listening: Peer[] = [];
  #heard = new Map<string, number>();
  #since = new Map<string, number>();
  #next = 0;

  constructor(private readonly all: Peer[]) {}

  get listening() {
    return this.#listening.length;
  }

  heardFrom(peer: string, now: number) {
    this.#heard.set(peer, now);
  }

  heard(now: number) {
    return this.#listening.filter(({ peer }) => now - (this.#heard.get(peer) ?? 0) < QUIET_MS)
      .length;
  }

  /** Starts over on a fresh connection, with the first few on the list */
  reset(want: number, now: number) {
    this.#listening = [];
    this.#next = 0;
    return this.resize(want, now).add;
  }

  resize(want: number, now: number) {
    const drop = this.#listening.splice(want);
    const add: Peer[] = [];
    while (this.#listening.length < Math.min(want, this.all.length)) {
      const peer = this.#take(now);
      if (!peer) break;
      this.#listening.push(peer);
      add.push(peer);
    }
    return { add, drop };
  }

  /** Swaps quiet peers, but only while someone else is talking, so a dead socket doesn't churn */
  sweep(now: number) {
    const quiet = (peer: Peer) =>
      now - Math.max(this.#heard.get(peer.peer) ?? 0, this.#since.get(peer.peer) ?? 0) > QUIET_MS;
    if (this.heard(now) === 0) return { add: [], drop: [] };
    const drop = this.#listening.filter(quiet);
    const add: Peer[] = [];
    for (const gone of drop) {
      const peer = this.#take(now);
      if (!peer) break;
      this.#listening[this.#listening.indexOf(gone)] = peer;
      add.push(peer);
    }
    return { add, drop: drop.slice(0, add.length) };
  }

  #take(now: number) {
    for (let tries = 0; tries < this.all.length; tries++) {
      const peer = this.all[this.#next];
      this.#next = (this.#next + 1) % this.all.length;
      if (!this.#listening.includes(peer)) {
        this.#since.set(peer.peer, now);
        return peer;
      }
    }
  }
}
