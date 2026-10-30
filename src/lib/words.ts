import type { Anomaly } from '#lib/bgp/types.ts';

export type Namer = (asn: number) => string | undefined;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`;

export function shortName(name: string, most = 34) {
  if (name.length <= most) return name;
  const cut = name.slice(0, most);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 12 ? cut.lastIndexOf(' ') : most).replace(/[,.\s]+$/, '')}…`;
}

export function label(asn: number, name?: string) {
  return name ? `AS${asn} ${shortName(name)}` : `AS${asn}`;
}

/** A bulletin in plain words. The detector guesses, so the words say so */
export function describe(anomaly: Anomaly, nameOf: Namer) {
  const as = (asn: number) => label(asn, nameOf(asn));
  const { asn, others, prefixes, sample, count } = anomaly;
  switch (anomaly.kind) {
    case 'leak':
      return {
        title: `Possible route leak by ${as(asn)}`,
        detail: `It passed routes from ${as(others[0])} on to ${as(others[1])}. Big networks don't normally reach each other through a smaller one, so this is usually a config slip.`
      };
    case 'origin':
      return {
        title: `${as(asn)} started announcing someone else's addresses`,
        detail: `${plural(prefixes, 'prefix', 'prefixes')} that ${others.length ? as(others[0]) : 'another network'} was announcing a moment ago. Could be a planned move or a DDoS scrubber stepping in. Could be a hijack.`
      };
    case 'withdrawals':
      return {
        title: `${as(asn)} pulled ${plural(prefixes, 'route')}`,
        detail: 'All inside a minute. Maintenance, or the start of an outage.'
      };
    case 'surge':
      return {
        title: 'A burst of withdrawals',
        detail: `${plural(prefixes, 'route')} gone in a minute, well above the usual.${others.length ? ` Mostly ${as(others[0])}.` : ''}`
      };
    case 'flap':
      return {
        title: `${anomaly.prefix ?? sample[0]} keeps flapping`,
        detail: `Announced and withdrawn ${plural(count, 'time')} in five minutes${asn ? `, from ${as(asn)}` : ''}. Something's unstable.`
      };
    case 'bogon':
      return {
        title: `${as(asn)} announced something it shouldn't`,
        detail: `Reserved or over-specific routes, like ${sample[0] ?? 'a private network number'}, that usually get filtered out long before they reach us.`
      };
    case 'prepend':
      return {
        title: `${as(asn)} is padding its routes`,
        detail:
          'It repeats itself ten or more times in the path, so traffic picks another way in. Legal, just a bit much.'
      };
  }
}

export function ago(time: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

export const number = (value: number, digits = 0) =>
  value.toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits });

const countries = new Intl.DisplayNames(['en-GB'], { type: 'region' });

export function countryName(code?: string) {
  if (!code || code === 'ZZ') return undefined;
  if (code === 'EU') return 'Europe';
  if (code === 'AP') return 'Asia-Pacific';
  try {
    return countries.of(code);
  } catch {
    return code;
  }
}
