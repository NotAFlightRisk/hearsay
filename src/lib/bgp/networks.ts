import type { Asn } from './types.ts';

/** Tier-1s and their siblings. Anyone between two of them is passing on routes they shouldn't */
export const clique = new Set<Asn>([
  // the tier-1s that are just the one ASN
  1299, 2914, 3257, 3320, 3491, 5511, 6461, 6762, 6830, 12956,
  // Cogent, and Sprint which it bought
  174, 1239,
  // Lumen, with Qwest, Global Crossing and tw telecom
  209, 3356, 3549, 4323,
  // Verizon, XO included
  701, 702, 703, 2828,
  // AT&T and its EMEA arm
  7018, 2686,
  // Tata, global and India
  6453, 4755,
  // Hurricane Electric isn't strictly tier-1, but it peers with nearly everyone
  6939
]);

/** AS 0, AS_TRANS, documentation, private and the reserved blocks in between */
export const reservedAsn = (asn: Asn) =>
  asn === 0 || asn === 23456 || (asn >= 64496 && asn <= 131071) || asn >= 4200000000;

interface Prefix {
  v6: boolean;
  /** the address as 16-bit words, two for v4 and eight for v6 */
  words: number[];
  length: number;
}

function words(address: string): number[] | undefined {
  if (!address.includes(':')) {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((octet) => !(octet >= 0 && octet < 256))) return;
    return [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
  }
  const halves = address.split('::');
  const hex = (part = '') =>
    part
      ? part
          .split(':')
          .flatMap((group) =>
            group.includes('.') ? (words(group) ?? [NaN]) : [parseInt(group, 16)]
          )
      : [];
  const front = hex(halves[0]);
  const back = hex(halves[1]);
  const gap = 8 - front.length - back.length;
  if (halves.length > 2 || gap < 0 || (halves.length === 1 && gap > 0)) return;
  const result = [...front, ...Array<number>(gap).fill(0), ...back];
  return result.every((word) => word >= 0 && word < 65536) ? result : undefined;
}

export function parsePrefix(prefix: string): Prefix | undefined {
  const [address, bits] = prefix.split('/');
  const parsed = words(address);
  const length = Number(bits);
  const v6 = parsed?.length === 8;
  if (!parsed || !(length >= 0 && length <= (v6 ? 128 : 32))) return;
  return { v6, words: parsed, length };
}

/** Whether a prefix sits inside (or is) a range */
export function within(prefix: Prefix, range: Prefix) {
  if (prefix.v6 !== range.v6 || prefix.length < range.length) return false;
  for (let word = 0, left = range.length; left > 0; word++, left -= 16) {
    const mask = left >= 16 ? 0xffff : (0xffff << (16 - left)) & 0xffff;
    if ((prefix.words[word] & mask) !== (range.words[word] & mask)) return false;
  }
  return true;
}

const bogons = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '2001:2::/48',
  '2001:10::/28',
  '2001:db8::/32',
  '3ffe::/16',
  '3fff::/20'
].map((range) => parsePrefix(range)!);
const globalUnicast = parsePrefix('2000::/3')!;

export type PrefixTrouble = 'bogon' | 'too-specific';

/** What's wrong with announcing this prefix to the whole internet, if anything */
export function prefixTrouble(raw: string): PrefixTrouble | undefined {
  const prefix = parsePrefix(raw);
  if (!prefix) return;
  if (prefix.length === 0 || (prefix.v6 && !within(prefix, globalUnicast))) return 'bogon';
  if (bogons.some((range) => within(prefix, range))) return 'bogon';
  if (prefix.length > (prefix.v6 ? 48 : 24)) return 'too-specific';
}
