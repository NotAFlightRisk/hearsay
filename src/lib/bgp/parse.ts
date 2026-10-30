import type { Asn, Update } from './types.ts';

interface RisUpdate {
  type?: string;
  timestamp: number;
  host: string;
  peer: string;
  peer_asn: string;
  path?: (Asn | Asn[])[];
  announcements?: { prefixes: string[] }[];
  withdrawals?: string[];
}

/** Turns one RIS Live message into an Update, or nothing if it isn't a BGP UPDATE */
export function parseRis(raw: string): Update | undefined {
  let message: { type?: string; data?: RisUpdate } | null;
  try {
    message = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const data = message?.data;
  if (message?.type !== 'ris_message' || data?.type !== 'UPDATE') return undefined;

  const hops = data.path ?? [];
  const path: Asn[] = [];
  let prepend: Update['prepend'];
  let run = 0;
  for (const hop of hops) {
    // AS_SETs are aggregation leftovers with no real order, so they're skipped
    if (typeof hop !== 'number') {
      run = 0;
      continue;
    }
    if (run > 0 && hop === path[path.length - 1]) run++;
    else {
      path.push(hop);
      run = 1;
    }
    if (run > (prepend?.times ?? 1)) prepend = { asn: hop, times: run };
  }

  const last = hops[hops.length - 1];
  return {
    time: Math.round(data.timestamp * 1000),
    host: data.host,
    peer: data.peer,
    peerAsn: Number(data.peer_asn),
    path,
    rawLength: hops.length,
    prepend,
    origin: typeof last === 'number' ? last : undefined,
    announced: (data.announcements ?? []).flatMap((announcement) => announcement.prefixes),
    withdrawn: data.withdrawals ?? []
  };
}
