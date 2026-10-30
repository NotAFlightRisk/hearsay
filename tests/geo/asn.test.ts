import { describe, expect, it } from 'vitest';
import { parseAsnTable } from '#lib/geo/asn.ts';

// 1-3 US, 6 GB, 1000-1001 DE, then the very top of the 32 bit range
const table = parseAsnTable('DE,GB,US\n1,2,3\n2,1\n993,0,2\n4294966292,2\n');

describe('parseAsnTable', () => {
  it('finds the country for ASNs inside runs, including the first and last', () => {
    expect(table.country(1)).toBe('US');
    expect(table.country(3)).toBe('US');
    expect(table.country(6)).toBe('GB');
    expect(table.country(1000)).toBe('DE');
    expect(table.country(1001)).toBe('DE');
    expect(table.country(4294967294)).toBe('US');
  });

  it('knows nothing about ASNs in the gaps or past either end', () => {
    for (const asn of [0, 4, 5, 7, 999, 1002, 4294967293, 4294967295]) {
      expect(table.country(asn)).toBeUndefined();
      expect(table.rank(asn)).toBe(-1);
    }
  });

  it('ranks ASNs by their position among every registered one', () => {
    expect([1, 2, 3, 6, 1000, 1001, 4294967294].map(table.rank)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(table.size).toBe(7);
  });

  it('copes without a trailing newline', () => {
    expect(parseAsnTable('NL\n5,0').country(5)).toBe('NL');
  });
});
