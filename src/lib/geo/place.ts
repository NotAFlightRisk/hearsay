import type { Region } from './collectors.ts';

export type { Region };

/** static/data/world.json */
export interface World {
  /** ISO codes, in the order dots refer to them */
  countries: string[];
  /** parallel to countries, empty where it's nowhere in particular (Antarctica, open ocean) */
  regions: (Region | '')[];
  /** flat runs of [lat * 10, lon * 10, country index] for every land dot */
  dots: number[];
  /** flat runs of [lat, lon, weight] for each country's biggest places */
  cities: Record<string, number[]>;
  /** [lat, lon] somewhere sensible in the middle of each country */
  centres: Record<string, [number, number]>;
}

// asn.txt files a few hundred ASNs under a whole region rather than a country
const SPREAD: Record<string, string[]> = {
  EU: ['DE', 'NL', 'GB', 'FR', 'SE', 'IT', 'ES', 'PL', 'CH', 'AT', 'BE', 'CZ'],
  AP: ['SG', 'HK', 'JP', 'AU', 'IN', 'KR', 'ID', 'MY', 'TH', 'PH', 'VN', 'NZ']
};
const SPREAD_REGIONS: Record<string, Region> = { EU: 'eu', AP: 'as' };

// how far an AS can wander from its city, in degrees, smallest town to biggest
const NEAR = 0.25;
const FAR = 0.85;

/** A cheap, well-mixed 32 bit hash, as a fraction in [0, 1) */
function hash(asn: number, seed: number) {
  let x = (asn ^ Math.imul(seed, 0x9e3779b9)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 2 ** 32;
}

function scatter(asn: number, lat: number, lon: number, reach: number): [number, number] {
  const distance = reach * Math.sqrt(hash(asn, 3));
  const angle = 2 * Math.PI * hash(asn, 4);
  const squash = Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  const north = Math.min(Math.max(lat + distance * Math.cos(angle), -89.9), 89.9);
  const east = ((((lon + (distance * Math.sin(angle)) / squash + 180) % 360) + 360) % 360) - 180;
  return [north, east];
}

/** Puts each AS in a big-ish city of its registered country, the same spot every time */
export function createPlacer(world: World) {
  return (asn: number, country: string | undefined): [number, number] | undefined => {
    const spread = country && SPREAD[country];
    const code = spread ? spread[Math.floor(hash(asn, 1) * spread.length)] : country;
    if (!code) return undefined;

    const cities = world.cities[code];
    if (!cities?.length) {
      const centre = world.centres[code];
      return centre && scatter(asn, centre[0], centre[1], NEAR);
    }

    let total = 0;
    for (let i = 2; i < cities.length; i += 3) total += cities[i];
    let pick = hash(asn, 2) * total;
    let at = 0;
    while (at + 3 < cities.length && pick >= cities[at + 2]) {
      pick -= cities[at + 2];
      at += 3;
    }
    const reach = NEAR + (FAR - NEAR) * (cities[at + 2] / cities[2]);
    return scatter(asn, cities[at], cities[at + 1], reach);
  };
}

const lookups = new WeakMap<World, Map<string, Region | ''>>();

/** The region a country code sits in, with asn.txt's EU and AP codes understood too */
export function regionOf(world: World, country: string): Region | undefined {
  if (SPREAD_REGIONS[country]) return SPREAD_REGIONS[country];
  let lookup = lookups.get(world);
  if (!lookup) {
    lookup = new Map(world.countries.map((code, i) => [code, world.regions[i]]));
    lookups.set(world, lookup);
  }
  return lookup.get(country) || undefined;
}
