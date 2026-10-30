import { describe, expect, it } from 'vitest';
import { prefixTrouble, reservedAsn } from '../../src/lib/bgp/networks.ts';

describe('prefixTrouble', () => {
  it.each([
    '10.20.0.0/16',
    '192.168.1.0/24',
    '100.64.0.0/10',
    '172.31.0.0/16',
    '0.0.0.0/0',
    '224.0.0.0/4',
    'fd12:3456::/48',
    'fe80::/64',
    '2001:db8:1::/48',
    '::/0',
    '::ffff:10.0.0.0/104'
  ])('calls %s a bogon', (prefix) => {
    expect(prefixTrouble(prefix)).toBe('bogon');
  });

  it.each([
    '1.1.1.0/24',
    '11.0.0.0/8',
    '172.32.0.0/16',
    '100.128.0.0/10',
    '198.20.0.0/16',
    '2606:4700::/32',
    '2a00:1450:4009::/48',
    '2001:db9::/32'
  ])('leaves %s alone', (prefix) => {
    expect(prefixTrouble(prefix)).toBeUndefined();
  });

  it('flags anything more specific than a /24 or /48', () => {
    expect(prefixTrouble('1.1.1.0/25')).toBe('too-specific');
    expect(prefixTrouble('2606:4700:10::/49')).toBe('too-specific');
    expect(prefixTrouble('2606:4700:10::/48')).toBeUndefined();
  });

  it('says nothing about prefixes it cannot read', () => {
    for (const prefix of ['nonsense', '1.2.3/24', '300.1.1.0/24', '1.2.3.0/33', '1::2::3/48']) {
      expect(prefixTrouble(prefix)).toBeUndefined();
    }
  });
});

describe('reservedAsn', () => {
  it.each([0, 23456, 64496, 64512, 65534, 65535, 65551, 131071, 4200000000, 4294967295])(
    'AS%i is reserved',
    (asn) => {
      expect(reservedAsn(asn)).toBe(true);
    }
  );

  it.each([1, 13335, 64495, 131072, 4199999999])('AS%i is a real network', (asn) => {
    expect(reservedAsn(asn)).toBe(false);
  });
});
