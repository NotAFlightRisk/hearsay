import type { Layers } from '#lib/globe/globe.ts';
import type { Level } from '#lib/stream/protocol.ts';

export type Theme = 'auto' | 'light' | 'dark';

export interface Settings {
  level: Level;
  theme: Theme;
  layers: Layers;
}

const KEY = 'hearsay:settings';

/** Phones and anyone asking to save data start on the light stream */
function startingLevel(): Level {
  const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData || matchMedia('(max-width: 40rem)').matches ? 'light' : 'standard';
}

function defaults(): Settings {
  return {
    level: startingLevel(),
    theme: 'auto',
    layers: {
      routes: true,
      withdrawals: true,
      networks: true,
      stations: true,
      daylight: true,
      spin: !matchMedia('(prefers-reduced-motion: reduce)').matches
    }
  };
}

export function loadSettings(): Settings {
  const fallback = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { ...fallback, ...saved, layers: { ...fallback.layers, ...saved.layers } };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // private browsing, or storage full - it'll just forget next time
  }
  if (settings.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
}
