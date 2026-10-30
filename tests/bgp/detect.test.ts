import { describe, expect, it } from 'vitest';
import { Detector } from '../../src/lib/bgp/detect.ts';
import type { Anomaly, Update } from '../../src/lib/bgp/types.ts';
import { PEERS, T0, announce, blocks, update, withdraw } from './helpers.ts';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const LEAKY = [3333, 1299, 57304, 174, 13335];

/** Everything the detector hands back for a run of updates, all at one moment */
function feed(detector: Detector, updates: Update[], now = T0) {
  return updates.flatMap((item) => detector.ingest(item, now).anomalies);
}

const only = (anomalies: Anomaly[], kind: string) => anomalies.filter((a) => a.kind === kind);

describe('changed', () => {
  it('only counts a different path from the same peer as a change', () => {
    const detector = new Detector();
    const prefix = ['11.0.0.0/24'];
    expect(detector.ingest(announce(prefix, [3333, 1299, 13335]), T0).changed).toBe(false);
    expect(detector.ingest(announce(prefix, [3333, 1299, 13335]), T0).changed).toBe(false);
    expect(detector.ingest(announce(prefix, [3333, 174, 13335], PEERS[1]), T0).changed).toBe(false);
    expect(detector.ingest(announce(prefix, [3333, 174, 13335]), T0).changed).toBe(true);
  });

  it('treats a re-announcement after a withdrawal as fresh', () => {
    const detector = new Detector();
    const prefix = ['11.0.0.0/24'];
    detector.ingest(announce(prefix, [3333, 1299, 13335]), T0);
    detector.ingest(withdraw(prefix), T0);
    expect(detector.ingest(announce(prefix, [3333, 174, 13335]), T0).changed).toBe(false);
  });
});

describe('leaks', () => {
  it('fires once a network between two tier-1s has carried 20 prefixes', () => {
    const detector = new Detector();
    expect(feed(detector, [announce(blocks(19), LEAKY)])).toEqual([]);
    const [leak] = feed(detector, [announce(blocks(1, 19), LEAKY)]);
    expect(leak).toMatchObject({
      id: 'leak:57304',
      kind: 'leak',
      severity: 'medium',
      asn: 57304,
      others: [1299, 174],
      path: LEAKY,
      prefixes: 20,
      peers: 1
    });
  });

  it('goes high once three peers see it', () => {
    const detector = new Detector();
    const anomalies = feed(detector, [
      announce(blocks(20), LEAKY, PEERS[0]),
      announce(blocks(1), LEAKY, PEERS[1]),
      announce(blocks(1), LEAKY, PEERS[2])
    ]);
    expect(anomalies.map((a) => a.severity)).toEqual(['medium', 'high']);
  });

  it.each([
    ['a sibling in the middle', [3333, 3356, 3549, 1299, 13335]],
    ['only one tier-1 next to it', [3333, 1299, 57304, 50000, 13335]],
    ['the same tier-1 both sides', [3333, 1299, 57304, 1299, 13335]]
  ])('ignores %s', (_, path) => {
    expect(only(feed(new Detector(), [announce(blocks(50), path)]), 'leak')).toEqual([]);
  });
});

describe('origin changes', () => {
  const settle = (detector: Detector, count: number, origin: number) =>
    feed(detector, [announce(blocks(count), [3333, 1299, origin])]);

  it('fires when two prefixes turn up with someone new originating them', () => {
    const detector = new Detector();
    settle(detector, 2, 100);
    expect(feed(detector, [announce(blocks(1), [3333, 174, 200])])).toEqual([]);
    const [moved] = feed(detector, [announce(blocks(1, 1), [3333, 174, 200])]);
    expect(moved).toMatchObject({ kind: 'origin', severity: 'low', asn: 200, others: [100] });
  });

  it('calls five of them medium, and never high from one peer', () => {
    const detector = new Detector();
    settle(detector, 80, 100);
    const anomalies = feed(detector, [announce(blocks(80), [3333, 174, 200])]);
    expect(anomalies.at(-1)).toMatchObject({ severity: 'medium', prefixes: 80, peers: 1 });
  });

  it('ignores the old origin still being in the path', () => {
    const detector = new Detector();
    settle(detector, 10, 100);
    expect(feed(detector, [announce(blocks(10), [3333, 100, 200])])).toEqual([]);
  });

  it('ignores a prefix going back to an origin it already had', () => {
    const detector = new Detector();
    settle(detector, 10, 100);
    feed(detector, [announce(blocks(1), [3333, 174, 200])]);
    expect(feed(detector, [announce(blocks(10), [3333, 1299, 100])])).toEqual([]);
  });
});

describe('withdrawals', () => {
  const owned = (detector: Detector) => feed(detector, [announce(blocks(200), [3333, 1299, 300])]);

  it('fires when one origin loses 20 prefixes inside a minute', () => {
    const detector = new Detector();
    owned(detector);
    expect(feed(detector, [withdraw(blocks(19))])).toEqual([]);
    const [lost] = feed(detector, [withdraw(blocks(1, 19), PEERS[1])]);
    expect(lost).toMatchObject({ kind: 'withdrawals', asn: 300, severity: 'medium', peers: 2 });
  });

  it('is low when only one peer lost them, and high at 100 across two', () => {
    const detector = new Detector();
    owned(detector);
    expect(feed(detector, [withdraw(blocks(20))])[0].severity).toBe('low');
    expect(feed(detector, [withdraw(blocks(100), PEERS[1])])[0].severity).toBe('high');
  });

  it('starts again when the losses are spread over more than a minute', () => {
    const detector = new Detector();
    owned(detector);
    feed(detector, [withdraw(blocks(15))], T0);
    expect(feed(detector, [withdraw(blocks(15, 15), PEERS[1])], T0 + 61 * SECOND)).toEqual([]);
  });

  it("can't pin prefixes it never saw announced on anyone", () => {
    const detector = new Detector();
    expect(feed(detector, [withdraw(blocks(50))])).toEqual([]);
    expect(detector.originOf(blocks(1)[0])).toBeUndefined();
  });
});

describe('surges', () => {
  /** A steady trickle of fresh withdrawals each second, handing back any surges it caused */
  function steady(detector: Detector, seconds: number, perSecond = 1, from = 1) {
    const surges: Anomaly[] = [];
    for (let s = from; s < from + seconds; s++) {
      detector.ingest(withdraw(blocks(perSecond, s * perSecond)), T0 + s * SECOND);
      surges.push(...only(detector.tick(T0 + s * SECOND), 'surge'));
    }
    return surges;
  }

  // well clear of anything steady() hands out
  const used = 50_000;

  const spike = (detector: Detector, at: number, count: number, start: number) => {
    detector.ingest(withdraw(blocks(count, start)), at);
    return only(detector.tick(at), 'surge');
  };

  it('stays quiet while warming up, whatever happens', () => {
    const detector = new Detector();
    steady(detector, 60);
    expect(spike(detector, T0 + 61 * SECOND, 2000, used)).toEqual([]);
  });

  it('fires on a spike well over the usual rate once warm', () => {
    const detector = new Detector();
    steady(detector, 150);
    const [surge] = spike(detector, T0 + 151 * SECOND, 600, used);
    expect(surge).toMatchObject({ kind: 'surge', asn: 0, prefixes: 600 });
    expect(surge.sample).toHaveLength(5);
  });

  it('needs to clear the floor, not just the baseline', () => {
    const detector = new Detector();
    steady(detector, 150);
    expect(spike(detector, T0 + 151 * SECOND, 150, used)).toEqual([]);
  });

  it('raises the bar for a stream that was busy all along', () => {
    const detector = new Detector();
    steady(detector, 150, 10);
    expect(steady(detector, 10, 35, 151)).toEqual([]);
    expect(steady(detector, 10, 80, 161)).not.toEqual([]);
  });

  it("doesn't count one prefix flapping like mad as a surge", () => {
    const detector = new Detector();
    steady(detector, 150);
    const at = T0 + 151 * SECOND;
    for (let i = 0; i < 2000; i++) detector.ingest(withdraw(['11.200.0.0/24']), at);
    expect(only(detector.tick(at), 'surge')).toEqual([]);
  });
});

describe('flaps', () => {
  const toggle = (detector: Detector, times: number, gap = SECOND) => {
    const prefix = ['11.0.0.0/24'];
    const out: Anomaly[] = [];
    for (let i = 0; i < times; i++) {
      const item = i % 2 ? announce(prefix, [3333, 1299, 13335]) : withdraw(prefix);
      out.push(...detector.ingest(item, T0 + i * gap).anomalies);
    }
    return only(out, 'flap');
  };

  it('fires on the sixth toggle inside five minutes', () => {
    expect(toggle(new Detector(), 5)).toEqual([]);
    expect(toggle(new Detector(), 6)[0]).toMatchObject({
      kind: 'flap',
      prefix: '11.0.0.0/24',
      asn: 13335,
      severity: 'low'
    });
  });

  it('lets the count go when toggles are spread out', () => {
    expect(toggle(new Detector(), 12, 70 * SECOND)).toEqual([]);
  });
});

describe('bogons', () => {
  it('flags a reserved ASN in the path, grouped by origin', () => {
    const [bogon] = feed(new Detector(), [announce(blocks(1), [3333, 64512, 13335])]);
    expect(bogon).toMatchObject({ kind: 'bogon', severity: 'medium', asn: 13335, others: [64512] });
  });

  it('flags a private prefix straight away', () => {
    const [bogon] = feed(new Detector(), [announce(['10.0.0.0/8'], [3333, 1299, 13335])]);
    expect(bogon).toMatchObject({ kind: 'bogon', severity: 'medium', sample: ['10.0.0.0/8'] });
  });

  it('lets a couple of over-specifics slide, but not three', () => {
    const detector = new Detector();
    const path = [3333, 1299, 13335];
    expect(feed(detector, [announce(['11.0.0.0/25', '11.0.0.128/25'], path)])).toEqual([]);
    const [bogon] = feed(detector, [announce(['11.0.1.0/25'], path)]);
    expect(bogon).toMatchObject({ kind: 'bogon', severity: 'low', prefixes: 3 });
  });
});

describe('prepending', () => {
  const prepended = (times: number) =>
    feed(new Detector(), [
      update({ announced: blocks(1), prepend: { asn: 13335, times }, rawLength: times + 2 })
    ]);

  it('notes ten or more of the same ASN', () => {
    expect(prepended(10)[0]).toMatchObject({ kind: 'prepend', asn: 13335, severity: 'low' });
    expect(prepended(9)).toEqual([]);
  });
});

describe('merging', () => {
  it('holds back a growing story until the throttle lets it through', () => {
    const detector = new Detector();
    const [first] = feed(detector, [announce(blocks(20), LEAKY)]);
    expect(feed(detector, [announce(blocks(5, 20), LEAKY)], T0 + SECOND)).toEqual([]);
    expect(detector.tick(T0 + 2 * SECOND)).toEqual([]);
    const [later] = detector.tick(T0 + 6 * SECOND);
    expect(later).toMatchObject({ id: first.id, prefixes: 25, count: 2 });
    expect(detector.tick(T0 + 20 * SECOND)).toEqual([]);
  });

  it('comes back straight away when the severity changes', () => {
    const detector = new Detector();
    feed(detector, [announce(blocks(20), LEAKY)]);
    const [worse] = feed(detector, [announce(blocks(200, 20), LEAKY)], T0 + SECOND);
    expect(worse).toMatchObject({ severity: 'high', prefixes: 220 });
  });

  it('forgets a story after a quiet spell, so it can start afresh', () => {
    const detector = new Detector();
    feed(detector, [announce(blocks(20), LEAKY)]);
    detector.tick(T0 + 16 * MINUTE);
    const later = T0 + 17 * MINUTE;
    expect(feed(detector, [announce(blocks(19, 100), LEAKY)], later)).toEqual([]);
    const [again] = feed(detector, [announce(blocks(1, 119), LEAKY)], later);
    expect(again).toMatchObject({ first: later, prefixes: 20 });
  });
});

describe('memory', () => {
  it('forgets old prefixes rather than growing forever', () => {
    const detector = new Detector({ memory: 100 });
    feed(detector, [announce(blocks(1000), [3333, 1299, 13335])]);
    expect(detector.originOf(blocks(1)[0])).toBeUndefined();
    expect(detector.originOf(blocks(1, 999)[0])).toBe(13335);
  });
});
