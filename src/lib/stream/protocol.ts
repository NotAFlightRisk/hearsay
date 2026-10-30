import type { Anomaly } from '#lib/bgp/types.ts';
import type { World } from '#lib/geo/place.ts';

export type Level = 'light' | 'standard' | 'busy';

export const levels: Record<Level, { peers: number; routesPerSecond: number }> = {
  light: { peers: 4, routesPerSecond: 30 },
  standard: { peers: 8, routesPerSecond: 60 },
  busy: { peers: 16, routesPerSecond: 120 }
};

export type Watch = { asn: number } | { prefix: string };
export type Place = [lat: number, lon: number];

export type ToWorker =
  | { type: 'start'; base: string; world: World; level: Level }
  | { type: 'level'; level: Level }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'watch'; watch: Watch | null }
  | { type: 'name'; asn: number }
  | { type: 'locate'; asns: number[] }
  | { type: 'inspect'; asn: number };

/** 0 announced, 1 withdrawn, 2 path changed, 4 the network you're watching */
export interface Route {
  kind: 0 | 1 | 2 | 4;
  asns: number[];
  points: Place[];
}

export interface Ripple {
  kind: 1 | 3;
  at: Place;
}

export interface Tally {
  messages: number;
  bytes: number;
  announced: number;
  withdrawn: number;
  changed: number;
}

export interface Network {
  asn: number;
  country?: string;
  at?: Place;
  announced: number;
  withdrawn: number;
  prefixes: number;
  upstreams: number[];
  lastSeen?: number;
}

export type Status = 'loading' | 'connecting' | 'live' | 'paused' | 'offline';

/** Where the stream's coming from: the relay hearing every RIS peer, or a few peers direct */
export type Source = 'relay' | 'direct';

/** The close code the relay uses once it's spent this month's budget */
export const OUT_OF_BUDGET = 4000;

export type ToRelay = { type: 'level'; level: Level } | { type: 'inspect'; asn: number };

export interface RelayFrame {
  type: 'frame';
  /** RIS messages since the last frame and the prefixes in them */
  tally: Omit<Tally, 'bytes'>;
  /** RIS paths, peer first: 0 announced, 2 path changed */
  routes: [kind: 0 | 2, ...path: number[]][];
  withdrawals: [peer: number, origin: number][];
  /** [country code, announced, withdrawn], about once a second */
  countries?: [string, number, number][];
  anomalies: Anomaly[];
  peers: number;
}

export type FromRelay = RelayFrame | { type: 'network'; network: Omit<Network, 'country' | 'at'> };

export type FromWorker =
  | {
      type: 'frame';
      tally: Tally;
      routes: Route[];
      ripples: Ripple[];
      /** [country index, announced, withdrawn] for every update, not just the ones drawn */
      countries: [number, number, number][];
      anomalies: Anomaly[];
      places: [number, ...Place][];
      peers: { listening: number; heard: number };
    }
  | { type: 'status'; status: Status; source: Source; detail?: string }
  | { type: 'name'; asn: number; name?: string }
  | { type: 'network'; network: Network };
