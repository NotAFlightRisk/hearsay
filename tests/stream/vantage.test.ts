import { describe, expect, it } from 'vitest';
import { QUIET_MS, Vantage, type Peer } from '../../src/lib/stream/vantage.ts';

const peer = (name: string): Peer => ({
  host: 'rrc00',
  peer: name,
  asn: 1,
  v6: false,
  region: 'eu'
});
const all = ['a', 'b', 'c', 'd'].map(peer);

describe('Vantage', () => {
  it('starts with the first few on the list', () => {
    const vantage = new Vantage(all);
    expect(vantage.reset(2, 0).map((each) => each.peer)).toEqual(['a', 'b']);
  });

  it('swaps a peer that has gone quiet for the next spare', () => {
    const vantage = new Vantage(all);
    vantage.reset(2, 0);
    vantage.heardFrom('a', QUIET_MS + 5);
    const { add, drop } = vantage.sweep(QUIET_MS + 10);
    expect(drop.map((each) => each.peer)).toEqual(['b']);
    expect(add.map((each) => each.peer)).toEqual(['c']);
  });

  it('leaves everyone alone when nobody is talking, as that is the socket not the peers', () => {
    const vantage = new Vantage(all);
    vantage.reset(2, 0);
    expect(vantage.sweep(QUIET_MS * 3)).toEqual({ add: [], drop: [] });
  });

  it('gives a new peer time to speak before calling it quiet', () => {
    const vantage = new Vantage(all);
    vantage.reset(2, 0);
    vantage.heardFrom('a', QUIET_MS + 5);
    vantage.sweep(QUIET_MS + 10);
    vantage.heardFrom('a', QUIET_MS + 20);
    expect(vantage.sweep(QUIET_MS + 30).drop).toEqual([]);
  });

  it('drops the extras when the level goes down', () => {
    const vantage = new Vantage(all);
    vantage.reset(3, 0);
    const { add, drop } = vantage.resize(1, 0);
    expect(add).toEqual([]);
    expect(drop.map((each) => each.peer)).toEqual(['b', 'c']);
  });
});
