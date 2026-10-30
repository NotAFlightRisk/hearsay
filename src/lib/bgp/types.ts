export type Asn = number;

/** One BGP UPDATE as a RIS peer saw it, trimmed to what the globe needs */
export interface Update {
  /** epoch ms, from the collector */
  time: number;
  host: string;
  peer: string;
  peerAsn: Asn;
  /** prepends collapsed and AS_SETs dropped, nearest hop first, origin last */
  path: Asn[];
  /** hops before prepends were collapsed */
  rawLength: number;
  /** the longest run of one ASN, when anyone prepended at all */
  prepend?: { asn: Asn; times: number };
  /** undefined when the path is empty or ends in an AS_SET */
  origin: Asn | undefined;
  announced: string[];
  withdrawn: string[];
}

export type AnomalyKind =
  'leak' | 'origin' | 'withdrawals' | 'surge' | 'flap' | 'bogon' | 'prepend';
export type Severity = 'high' | 'medium' | 'low';

/** Something odd the detector spotted live. Same id = same story, updated in place */
export interface Anomaly {
  id: string;
  kind: AnomalyKind;
  severity: Severity;
  /** who it's about: the leaker, the new origin, the AS losing routes. 0 when nobody in particular */
  asn: Asn;
  /** supporting cast, e.g. the networks either side of a leak, or the previous origin */
  others: Asn[];
  /** set when the story is about one prefix rather than one network */
  prefix?: string;
  prefixes: number;
  sample: string[];
  /** an example path, for drawing */
  path?: Asn[];
  peers: number;
  count: number;
  first: number;
  last: number;
}

export type IncidentKind = 'outage' | 'leak' | 'hijack';

/** A confirmed-ish event from someone who watches the whole internet, not just our few peers */
export interface Incident {
  id: string;
  kind: IncidentKind;
  source: 'Cloudflare Radar' | 'IODA';
  title: string;
  detail?: string;
  /** ISO times, no end while it's ongoing */
  start: string;
  end?: string;
  /** the main network first */
  asns: Asn[];
  countries: string[];
  prefixes?: number;
  url?: string;
}
