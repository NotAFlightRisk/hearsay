import { describe, expect, it, vi } from 'vitest';
import { parseAsnTable } from '#lib/geo/asn.ts';
import { createNames, NAMES_PER_BUCKET } from '#lib/geo/names.ts';

// ASNs 1 to 2050, so ranks 0 to 2049 across three buckets
const table = parseAsnTable('US\n1,0,2050\n');

const fakeBuckets = () =>
  vi.fn(async (url: string) => {
    const bucket = /names\/(\d+)\.txt$/.exec(url)![1];
    return Array.from({ length: NAMES_PER_BUCKET }, (_, i) => `org ${bucket}.${i}`).join('\n');
  });

describe('createNames', () => {
  it('reads the right line of the right bucket either side of a boundary', async () => {
    const name = createNames('/data', table, fakeBuckets());
    expect(await name(1)).toBe('org 0.0');
    expect(await name(1024)).toBe('org 0.1023');
    expect(await name(1025)).toBe('org 1.0');
    expect(await name(2050)).toBe('org 2.1');
  });

  it('fetches each bucket once, even when asked for it twice at the same time', async () => {
    const load = fakeBuckets();
    const name = createNames('/data', table, load);
    await Promise.all([name(1), name(2), name(500)]);
    await name(3);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('/data/names/0.txt');
  });

  it("doesn't fetch anything for an ASN nobody registered", async () => {
    const load = fakeBuckets();
    expect(await createNames('/data', table, load)(9999)).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it('gives up quietly on a failed fetch and tries again next time', async () => {
    const load = vi
      .fn<(url: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('Lovely Networks Ltd');
    const name = createNames('/data', table, load);
    expect(await name(1)).toBeUndefined();
    expect(await name(1)).toBe('Lovely Networks Ltd');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('treats a blank line as no name', async () => {
    expect(await createNames('/data', table, async () => '\nSecond')(1)).toBeUndefined();
  });
});
