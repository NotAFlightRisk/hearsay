import type { AsnTable } from './asn.ts';

export const NAMES_PER_BUCKET = 1024;

const fetchText = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
};

/** Looks up an ASN's org name, fetching the small file it lives in the first time it's needed */
export function createNames(base: string, table: AsnTable, load = fetchText) {
  const buckets = new Map<number, Promise<string[]>>();

  const bucket = (index: number) => {
    let lines = buckets.get(index);
    if (!lines) {
      lines = load(`${base}/names/${index}.txt`).then((text) => text.split('\n'));
      // a failed fetch is forgotten, so the next lookup has another go
      lines.catch(() => buckets.delete(index));
      buckets.set(index, lines);
    }
    return lines;
  };

  return async (asn: number): Promise<string | undefined> => {
    const rank = table.rank(asn);
    if (rank < 0) return undefined;
    const lines = await bucket(Math.floor(rank / NAMES_PER_BUCKET)).catch(() => []);
    return lines[rank % NAMES_PER_BUCKET] || undefined;
  };
}
