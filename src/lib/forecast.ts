export const regions = {
  eu: 'Europe',
  af: 'Africa',
  me: 'Middle East',
  as: 'Asia',
  oc: 'Oceania',
  sa: 'South America',
  na: 'North America'
} as const;

export type RegionKey = keyof typeof regions;

// Beaufort, more or less: route updates a minute, per peer we're listening to
const scale = [
  { word: 'calm', below: 2 },
  { word: 'light', below: 15 },
  { word: 'moderate', below: 60 },
  { word: 'fresh', below: 180 },
  { word: 'strong', below: 500 },
  { word: 'gale', below: Infinity }
];

export type Visibility = 'good' | 'moderate' | 'poor';

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const band = (perMinute: number) => scale.findIndex(({ below }) => perMinute < below);

/** One stretch of the forecast, from the last five minutes of seconds, newest last */
function strength(seconds: number[], peers: number) {
  const recent = band(sum(seconds.slice(-60)) / peers);
  const overall = band(sum(seconds) / (seconds.length / 60 || 1) / peers);
  const word = scale[overall].word;
  if (recent === overall || seconds.length < 120) return word;
  return `${word}, ${recent > overall ? 'rising' : 'easing'} ${scale[recent].word}`;
}

export function forecastLine(
  announced: number[],
  withdrawn: number[],
  peers: number,
  visibility: Visibility
) {
  const listeners = Math.max(peers, 1);
  return `Announcements ${strength(announced, listeners)}. Withdrawals ${strength(withdrawn, listeners)}. ${visibility[0].toUpperCase()}${visibility.slice(1)}.`;
}
