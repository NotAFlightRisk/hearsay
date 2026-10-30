import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlacer, regionOf, type World } from '#lib/geo/place.ts';

const world: World = {
  countries: ['AQ', 'FJ', 'GB', 'NL', 'TK'],
  regions: ['', 'oc', 'eu', 'eu', 'oc'],
  dots: [],
  cities: {
    GB: [51.5, -0.1, 3000, 53.5, -2.2, 1000],
    NL: [52.4, 4.9, 1000],
    FJ: [-18.1, 179.9, 500]
  },
  centres: { GB: [54, -2], NL: [52, 5.5], FJ: [-17.8, 178], TK: [-9.2, -171.8] }
};
const place = createPlacer(world);
const asns = Array.from({ length: 2000 }, (_, i) => i * 7919 + 1);

// degrees apart, allowing for the squeeze towards the poles and the wrap at 180
const apart = ([lat, lon]: number[], [otherLat, otherLon]: number[]) => {
  const east = Math.abs(((lon - otherLon + 540) % 360) - 180);
  return Math.hypot(lat - otherLat, east * Math.cos((lat * Math.PI) / 180));
};

describe('createPlacer', () => {
  it('puts the same AS in the same place every time', () => {
    const again = createPlacer(structuredClone(world));
    for (const asn of asns.slice(0, 50)) expect(again(asn, 'GB')).toEqual(place(asn, 'GB'));
  });

  it('keeps every AS close to one of its country cities', () => {
    for (const asn of asns) {
      const spot = place(asn, 'GB')!;
      const nearest = Math.min(apart(spot, [51.5, -0.1]), apart(spot, [53.5, -2.2]));
      expect(nearest).toBeLessThanOrEqual(0.86);
    }
  });

  it('sends more ASes to bigger cities', () => {
    const london = asns.filter((asn) => apart(place(asn, 'GB')!, [51.5, -0.1]) < 1).length;
    expect(london / asns.length).toBeGreaterThan(0.7);
    expect(london / asns.length).toBeLessThan(0.8);
  });

  it("doesn't stack ASes in one city on top of each other", () => {
    const spots = new Set(
      asns.map((asn) =>
        place(asn, 'NL')!
          .map((n) => n.toFixed(2))
          .join()
      )
    );
    expect(spots.size).toBeGreaterThan(asns.length * 0.9);
  });

  it('falls back to the middle of a country with no cities', () => {
    for (const asn of asns.slice(0, 100)) {
      expect(apart(place(asn, 'TK')!, [-9.2, -171.8])).toBeLessThanOrEqual(0.26);
    }
  });

  it('wraps round the date line rather than wandering off the map', () => {
    for (const asn of asns) {
      const [lat, lon] = place(asn, 'FJ')!;
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThan(180);
      expect(apart([lat, lon], [-18.1, 179.9])).toBeLessThanOrEqual(0.86);
    }
  });

  it('spreads region-wide registrations over that region', () => {
    const placed = asns.map((asn) => place(asn, 'EU')).filter(Boolean) as number[][];
    expect(placed.length).toBeGreaterThan(0);
    for (const spot of placed) {
      expect(
        Math.min(apart(spot, [51.5, -0.1]), apart(spot, [53.5, -2.2]), apart(spot, [52.4, 4.9]))
      ).toBeLessThanOrEqual(0.86);
    }
  });

  it('gives up on codes it knows nothing about', () => {
    expect(place(13335, 'ZZ')).toBeUndefined();
    expect(place(13335, undefined)).toBeUndefined();
    expect(place(13335, 'AQ')).toBeUndefined();
  });
});

describe('regionOf', () => {
  it('reads the region off the country list', () => {
    expect(regionOf(world, 'GB')).toBe('eu');
    expect(regionOf(world, 'FJ')).toBe('oc');
  });

  it("understands asn.txt's region-wide codes", () => {
    expect(regionOf(world, 'EU')).toBe('eu');
    expect(regionOf(world, 'AP')).toBe('as');
  });

  it("says nothing for unknown places or ones that aren't in any region", () => {
    expect(regionOf(world, 'ZZ')).toBeUndefined();
    expect(regionOf(world, 'AQ')).toBeUndefined();
  });
});

describe('the generated data', () => {
  it('can place an AS from every country asn.txt mentions', () => {
    const real: World = JSON.parse(readFileSync('static/data/world.json', 'utf8'));
    const codes = readFileSync('static/data/asn.txt', 'utf8').split('\n', 1)[0].split(',');
    const placeReal = createPlacer(real);
    expect(codes.filter((code) => !placeReal(64496, code))).toEqual([]);
  });
});
