import { describe, expect, it } from 'vitest';
import { Lru, RouteMemory, pathKey } from '../../src/lib/bgp/memory.ts';

describe('Lru', () => {
  it('forgets whatever was touched longest ago once full', () => {
    const lru = new Lru<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a');
    lru.set('c', 3);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
    expect(lru.get('c')).toBe(3);
    expect(lru.size).toBe(2);
  });
});

describe('RouteMemory', () => {
  it('never holds more than its limit, however much it is fed', () => {
    const memory = new RouteMemory(100);
    for (let i = 0; i < 1000; i++) {
      memory.announce('192.0.2.1', `11.0.${i}.0/24`, i);
      memory.rememberOrigin(`11.0.${i}.0/24`, i);
    }
    expect(memory.size).toEqual({ paths: 100, origins: 100 });
    expect(memory.origins('11.0.0.0/24')).toBeUndefined();
    expect(memory.origins('11.0.999.0/24')).toEqual([999]);
  });

  it('keeps the last three origins, most recent first', () => {
    const memory = new RouteMemory();
    for (const origin of [1, 2, 3, 1, 4]) memory.rememberOrigin('11.0.0.0/24', origin);
    expect(memory.origins('11.0.0.0/24')).toEqual([4, 1, 3]);
  });
});

describe('pathKey', () => {
  it('tells paths apart, prepending included', () => {
    expect(pathKey([1, 2, 3], 3)).toBe(pathKey([1, 2, 3], 3));
    expect(pathKey([1, 2, 3], 3)).not.toBe(pathKey([1, 3, 2], 3));
    expect(pathKey([1, 2, 3], 3)).not.toBe(pathKey([1, 2, 3], 5));
  });
});
