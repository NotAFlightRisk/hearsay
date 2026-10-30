import { Color } from 'three';
import type { Palette } from './layers.ts';

const tokens: Record<keyof Palette, string> = {
  ocean: '--globe-ocean',
  grid: '--globe-grid',
  night: '--globe-night',
  rim: '--globe-rim',
  land: '--globe-land',
  pressure: '--globe-pressure',
  alarm: '--alarm',
  ink: '--globe-ink',
  paper: '--globe-paper',
  announce: '--cool',
  withdraw: '--warm',
  change: '--occluded',
  focus: '--globe-ink'
};

/** Reads the globe's colours off the CSS tokens, light-dark() and all, via a probe's colour */
export function readPalette(): Palette {
  const probe = document.createElement('i');
  document.body.append(probe);
  const palette = Object.fromEntries(
    Object.entries(tokens).map(([name, token]) => {
      probe.style.color = `var(${token})`;
      return [name, new Color(getComputedStyle(probe).color)];
    })
  ) as unknown as Palette;
  probe.remove();
  return palette;
}

export const prefersDark = () =>
  getComputedStyle(document.documentElement).colorScheme === 'dark' ||
  (getComputedStyle(document.documentElement).colorScheme !== 'light' &&
    matchMedia('(prefers-color-scheme: dark)').matches);
