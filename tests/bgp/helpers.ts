import type { Asn, Update } from '../../src/lib/bgp/types.ts';

export const T0 = Date.parse('2026-10-30T12:00:00Z');
export const PEERS = ['192.0.2.1', '192.0.2.2', '192.0.2.3'];

/** An update with sensible defaults, origin and length worked out from the path */
export function update(fields: Partial<Update> = {}): Update {
  const path = fields.path ?? [3333, 1299, 13335];
  return {
    time: T0,
    host: 'rrc00',
    peer: PEERS[0],
    peerAsn: path[0] ?? 3333,
    path,
    rawLength: path.length,
    origin: path[path.length - 1],
    announced: [],
    withdrawn: [],
    ...fields
  };
}

export const announce = (announced: string[], path: Asn[], peer = PEERS[0]) =>
  update({ announced, path, peer });

export const withdraw = (withdrawn: string[], peer = PEERS[0]) =>
  update({ withdrawn, path: [], origin: undefined, peer });

/** Plain old /24s nobody would call a bogon */
export const blocks = (count: number, start = 0) =>
  Array.from({ length: count }, (_, i) => `11.${(start + i) >> 8}.${(start + i) & 255}.0/24`);
