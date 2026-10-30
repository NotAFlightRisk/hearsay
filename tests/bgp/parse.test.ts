import { describe, expect, it } from 'vitest';
import { parseRis } from '../../src/lib/bgp/parse.ts';

const ris = (data: object, type = 'ris_message') =>
  JSON.stringify({
    type,
    data: {
      timestamp: 1793389696.42,
      host: 'rrc13.ripe.net',
      peer: '195.208.208.147',
      peer_asn: '28917',
      type: 'UPDATE',
      ...data
    }
  });

describe('parseRis', () => {
  it('collapses prepends but remembers the longest run', () => {
    const update = parseRis(
      ris({
        path: [28917, 6762, 6762, 141549, 141549, 141549, 141549, 141549],
        announcements: [{ next_hop: '195.208.208.147', prefixes: ['103.1.2.0/24'] }]
      })
    );
    expect(update?.path).toEqual([28917, 6762, 141549]);
    expect(update?.rawLength).toBe(8);
    expect(update?.prepend).toEqual({ asn: 141549, times: 5 });
    expect(update?.origin).toBe(141549);
  });

  it('leaves prepend unset when nobody prepends', () => {
    expect(parseRis(ris({ path: [28917, 6762, 4755] }))?.prepend).toBeUndefined();
  });

  it('drops AS_SETs, and has no origin when the path ends in one', () => {
    const update = parseRis(ris({ path: [28917, 6762, [133037, 133038]] }));
    expect(update?.path).toEqual([28917, 6762]);
    expect(update?.origin).toBeUndefined();
    expect(parseRis(ris({ path: [28917, [1, 2], 4755] }))?.origin).toBe(4755);
  });

  it('reads a withdrawal-only update', () => {
    const update = parseRis(ris({ withdrawals: ['1.2.3.0/24', '2a00:1::/32'] }));
    expect(update).toMatchObject({ path: [], origin: undefined, announced: [] });
    expect(update?.withdrawn).toEqual(['1.2.3.0/24', '2a00:1::/32']);
  });

  it('flattens announcements across next hops', () => {
    const update = parseRis(
      ris({
        path: [28917, 13335],
        announcements: [
          { next_hop: '1.1.1.1', prefixes: ['1.1.1.0/24', '1.0.0.0/24'] },
          { next_hop: '2001:db8::1', prefixes: ['2606:4700::/32'] }
        ]
      })
    );
    expect(update?.announced).toEqual(['1.1.1.0/24', '1.0.0.0/24', '2606:4700::/32']);
  });

  it('gives times in milliseconds and the peer ASN as a number', () => {
    const update = parseRis(ris({ path: [28917] }));
    expect(update?.time).toBe(1793389696420);
    expect(update?.peerAsn).toBe(28917);
  });

  it('ignores everything that is not a BGP UPDATE', () => {
    expect(parseRis(ris({ type: 'KEEPALIVE' }))).toBeUndefined();
    expect(parseRis(ris({ type: 'RIS_PEER_STATE', state: 'down' }))).toBeUndefined();
    expect(
      parseRis(JSON.stringify({ type: 'ris_error', data: { message: 'nope' } }))
    ).toBeUndefined();
    expect(parseRis(JSON.stringify({ type: 'pong', data: null }))).toBeUndefined();
  });

  it('shrugs off garbage', () => {
    for (const raw of ['', 'not json', 'null', '[]', '{"type":"ris_message"}']) {
      expect(parseRis(raw)).toBeUndefined();
    }
  });
});
