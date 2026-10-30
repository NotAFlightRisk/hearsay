import { describe, expect, it } from 'vitest';
import type { AsnTable } from '../../src/lib/geo/asn.ts';
import { Hub, Reservoir } from '../../src/lib/relay/hub.ts';

const countries: Record<number, string> = { 13335: 'US', 3320: 'DE' };
const table: AsnTable = { country: (asn) => countries[asn], rank: () => 0, size: 2 };
const nobody = async () => [];

const ris = (peer: string, path: number[], announced: string[] = [], withdrawn: string[] = []) =>
  JSON.stringify({
    type: 'ris_message',
    data: {
      type: 'UPDATE',
      timestamp: 1_790_000_000,
      host: 'rrc00',
      peer,
      peer_asn: String(path[0] ?? 64500),
      path,
      announcements: announced.length ? [{ prefixes: announced }] : [],
      withdrawals: withdrawn
    }
  });

describe('Hub', () => {
  it('counts every message but only sends each level its share of the routes', () => {
    const hub = new Hub(table, nobody);
    hub.frame(0);
    for (let i = 0; i < 500; i++) hub.hear(ris(`192.0.2.${i}`, [3320, 13335], ['1.1.1.0/24']), 0);
    const { light, standard, busy } = hub.frame(200);
    expect(busy.tally.messages).toBe(500);
    expect(busy.routes).toHaveLength(24);
    expect(standard.routes).toHaveLength(12);
    expect(light.routes).toHaveLength(6);
    expect(busy.routes[0]).toEqual([0, 3320, 13335]);
  });

  it("gives one peer two goes a frame, so a table resend can't hog the globe", () => {
    const hub = new Hub(table, nobody);
    for (let i = 0; i < 100; i++) hub.hear(ris('192.0.2.1', [3320, 13335], [`10.${i}.0.0/16`]), 0);
    expect(hub.frame(200).busy.routes).toHaveLength(2);
    hub.hear(ris('192.0.2.1', [3320, 13335], ['10.200.0.0/16']), 0);
    expect(hub.frame(400).busy.routes).toHaveLength(1);
  });

  it('pins a withdrawal on whoever was announcing the prefix', () => {
    const hub = new Hub(table, nobody);
    hub.hear(ris('192.0.2.1', [3320, 13335], ['1.1.1.0/24']), 0);
    hub.hear(ris('192.0.2.2', [64501], [], ['1.1.1.0/24']), 0);
    expect(hub.frame(200).busy.withdrawals).toEqual([[64501, 13335]]);
  });

  it('carries more routes in a frame that came late', () => {
    const hub = new Hub(table, nobody);
    hub.frame(0);
    for (let i = 0; i < 500; i++) hub.hear(ris(`192.0.2.${i}`, [3320, 13335], ['1.1.1.0/24']), 0);
    expect(hub.frame(400).busy.routes).toHaveLength(48);
  });

  it('sends the country counts about once a second', () => {
    const hub = new Hub(table, nobody);
    hub.hear(ris('192.0.2.1', [3320, 13335], ['1.1.1.0/24', '1.0.0.0/24']), 0);
    hub.hear(ris('192.0.2.2', [64501], [], ['1.1.1.0/24']), 0);
    const frames = [200, 400, 600, 800, 1000].map((now) => hub.frame(now).light);
    expect(frames.slice(0, 4).every((frame) => frame.countries === undefined)).toBe(true);
    expect(frames[4].countries).toEqual([['US', 2, 1]]);
  });

  it('keeps a tally per network for its card', () => {
    const hub = new Hub(table, nobody);
    hub.hear(ris('192.0.2.1', [3320, 13335], ['1.1.1.0/24', '1.0.0.0/24']), 0);
    expect(hub.network(13335)).toMatchObject({ asn: 13335, announced: 2, prefixes: 2 });
  });
});

describe('Reservoir', () => {
  it('keeps a fair sample of everything offered, then starts again', () => {
    const reservoir = new Reservoir<number>(200);
    for (let i = 0; i < 10_000; i++) reservoir.offer(i);
    const sample = reservoir.take();
    const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length;
    expect(sample).toHaveLength(200);
    expect(mean).toBeGreaterThan(4000);
    expect(mean).toBeLessThan(6000);
    expect(reservoir.take()).toEqual([]);
  });
});
