export interface AsnTable {
  country(asn: number): string | undefined;
  /** position among all registered ASNs, or -1 if it isn't one */
  rank(asn: number): number;
  size: number;
}

/**
 * Reads static/data/asn.txt: the country codes on line one, then one line per run of
 * consecutive ASNs sharing a country, as `gap,country[,length]`. The gap counts from the end
 * of the previous run, and a missing length means 1
 */
export function parseAsnTable(text: string): AsnTable {
  const [head, ...lines] = text.trimEnd().split('\n');
  const codes = head.split(',');
  const starts = new Uint32Array(lines.length);
  const lengths = new Uint32Array(lines.length);
  const countries = new Uint16Array(lines.length);
  const ranks = new Uint32Array(lines.length);
  let end = 0;
  let size = 0;
  lines.forEach((line, i) => {
    const [gap, country, length = '1'] = line.split(',');
    starts[i] = end + Number(gap);
    lengths[i] = Number(length);
    countries[i] = Number(country);
    ranks[i] = size;
    end = starts[i] + lengths[i];
    size += lengths[i];
  });

  // the run holding this ASN, or -1 if it falls in a gap
  const find = (asn: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (starts[mid] <= asn) low = mid + 1;
      else high = mid - 1;
    }
    return high >= 0 && asn < starts[high] + lengths[high] ? high : -1;
  };

  return {
    size,
    country(asn) {
      const run = find(asn);
      return run < 0 ? undefined : codes[countries[run]];
    },
    rank(asn) {
      const run = find(asn);
      return run < 0 ? -1 : ranks[run] + asn - starts[run];
    }
  };
}
