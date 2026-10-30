import { SvelteMap } from 'svelte/reactivity';
import type { Anomaly, Incident, Severity } from '#lib/bgp/types.ts';
import { forecastLine, regions, type RegionKey, type Visibility } from '#lib/forecast.ts';
import type { Globe } from '#lib/globe/globe.ts';
import type { World } from '#lib/geo/place.ts';
import type { FromWorker, Level, Network, Place, Status, Watch } from '#lib/stream/protocol.ts';

const STEPS = 60;
const WINDOW = 300;
// how quickly a country's pressure follows its traffic, in seconds
const PRESSURE_TAU = 30;
const PAUSE_WHEN_HIDDEN_MS = 20_000;
const INCIDENTS_EVERY_MS = 10 * 60_000;
const MOST_BULLETINS = 60;
const MOST_PLACES = 2000;
const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const zeros = () => new Array<number>(WINDOW).fill(0);

export interface RegionForecast {
  key: RegionKey;
  name: string;
  line: string;
  visibility: Visibility;
}

export class Live {
  status = $state<Status>('loading');
  detail = $state<string>();
  perSecond = $state({ updates: 0, announced: 0, withdrawn: 0, changed: 0, kilobytes: 0 });
  steps = $state<number[]>(new Array(STEPS).fill(0));
  peers = $state({ listening: 0, heard: 0 });
  anomalies = $state<Anomaly[]>([]);
  incidents = $state<Incident[]>([]);
  radar = $state(false);
  selected = $state<number | null>(null);
  network = $state<Network | null>(null);
  watching = $state<Watch | null>(null);
  forecast = $state<RegionForecast[]>([]);
  names = new SvelteMap<number, string>();

  #worker: Worker;
  #globe?: Globe;
  #world: World;
  #places = new Map<number, Place>();
  #asked = new Set<number>();
  #bulletins = new Map<string, Anomaly>();
  #second = { updates: 0, announced: 0, withdrawn: 0, changed: 0, bytes: 0 };
  #countrySecond: Float32Array;
  #pressure: Float32Array;
  #alarm: Float32Array;
  #region = new Map<string, { announced: number[]; withdrawn: number[] }>();
  #regionSecond = new Map<string, [number, number]>();
  #timers: ReturnType<typeof setInterval>[] = [];
  #hiddenTimer?: ReturnType<typeof setTimeout>;
  #flyWhenFound = false;

  constructor(world: World, level: Level, onError: (error: unknown) => void) {
    this.#world = world;
    const size = world.countries.length;
    this.#countrySecond = new Float32Array(size);
    this.#pressure = new Float32Array(size);
    this.#alarm = new Float32Array(size);
    for (const key of Object.keys(regions))
      this.#region.set(key, { announced: zeros(), withdrawn: zeros() });
    this.#worker = new Worker(new URL('./stream/stream.worker.ts', import.meta.url), {
      type: 'module'
    });
    this.#worker.onmessage = ({ data }: MessageEvent<FromWorker>) => this.#hear(data);
    this.#worker.onerror = (event) => onError(event.error ?? new Error(event.message));
    this.#worker.postMessage({ type: 'start', base: location.origin, world, level });
    this.#timers.push(setInterval(() => this.#everySecond(), 1000));
    this.#timers.push(setInterval(() => this.#refreshForecast(), 5000));
    this.#timers.push(setInterval(() => void this.loadIncidents(), INCIDENTS_EVERY_MS));
    document.addEventListener('visibilitychange', this.#visibility);
    void this.loadIncidents();
  }

  attach(globe: Globe) {
    this.#globe = globe;
  }

  setLevel(level: Level) {
    this.#worker.postMessage({ type: 'level', level });
  }

  nameOf = (asn: number) => {
    const name = this.names.get(asn);
    if (name === undefined && !this.#asked.has(asn)) {
      this.#asked.add(asn);
      this.#worker.postMessage({ type: 'name', asn });
    }
    return name;
  };

  #remember(asn: number, at: Place) {
    this.#places.delete(asn);
    this.#places.set(asn, at);
    if (this.#places.size > MOST_PLACES) this.#places.delete(this.#places.keys().next().value!);
  }

  placeOf(asn: number) {
    return this.#places.get(asn) ?? this.#globe?.where(asn);
  }

  select(asn: number | null, fly = true) {
    this.selected = asn;
    this.network = null;
    if (asn === null) {
      this.#globe?.focus(null);
      return;
    }
    this.nameOf(asn);
    this.#worker.postMessage({ type: 'inspect', asn });
    this.#worker.postMessage({ type: 'locate', asns: [asn] });
    this.#globe?.focus(new Set([asn]));
    const at = this.placeOf(asn);
    if (fly && at) this.#globe?.flyTo(at, true);
    this.#flyWhenFound = fly && !at;
  }

  watch(target: Watch | null) {
    this.watching = target;
    this.#worker.postMessage({ type: 'watch', watch: target });
  }

  async loadIncidents() {
    try {
      const response = await fetch('/api/incidents');
      if (!response.ok) return;
      const body = (await response.json()) as { radar: boolean; incidents: Incident[] };
      this.incidents = body.incidents;
      this.radar = body.radar;
      this.#worker.postMessage({
        type: 'locate',
        asns: body.incidents.flatMap((incident) => incident.asns)
      });
      this.#paintAlarms();
    } catch {
      // the bulletins just say there's nothing confirmed, which is true from here
    }
  }

  destroy() {
    for (const timer of this.#timers) clearInterval(timer);
    clearTimeout(this.#hiddenTimer);
    document.removeEventListener('visibilitychange', this.#visibility);
    this.#worker.terminate();
  }

  #visibility = () => {
    clearTimeout(this.#hiddenTimer);
    if (document.hidden) {
      this.#hiddenTimer = setTimeout(
        () => this.#worker.postMessage({ type: 'pause' }),
        PAUSE_WHEN_HIDDEN_MS
      );
    } else if (this.status === 'paused') {
      this.#worker.postMessage({ type: 'resume' });
    }
  };

  #hear(message: FromWorker) {
    switch (message.type) {
      case 'status':
        this.status = message.status;
        this.detail = message.detail;
        break;
      case 'name':
        this.names.set(message.asn, message.name ?? '');
        break;
      case 'network':
        if (message.network.asn === this.selected) {
          this.network = message.network;
          if (message.network.at) {
            this.#remember(message.network.asn, message.network.at);
            if (this.#flyWhenFound) this.#globe?.flyTo(message.network.at, true);
            this.#flyWhenFound = false;
            this.#globe?.focus(new Set([message.network.asn, ...message.network.upstreams]));
          }
        }
        break;
      case 'frame':
        this.#frame(message);
        break;
    }
  }

  #frame({
    tally,
    routes,
    ripples,
    countries,
    anomalies,
    places,
    peers
  }: Extract<FromWorker, { type: 'frame' }>) {
    this.#second.updates += tally.messages;
    this.#second.announced += tally.announced;
    this.#second.withdrawn += tally.withdrawn;
    this.#second.changed += tally.changed;
    this.#second.bytes += tally.bytes;
    this.peers = peers;
    for (const [asn, lat, lon] of places) this.#remember(asn, [lat, lon]);
    for (const [index, announced, withdrawn] of countries) {
      this.#countrySecond[index] += announced + withdrawn;
      const region = this.#world.regions[index];
      if (!region) continue;
      const [a, w] = this.#regionSecond.get(region) ?? [0, 0];
      this.#regionSecond.set(region, [a + announced, w + withdrawn]);
    }
    for (const route of routes) this.#globe?.route(route.points, route.asns, route.kind);
    for (const ripple of ripples) this.#globe?.ripple(ripple.at, ripple.kind);
    if (anomalies.length) this.#bulletin(anomalies);
  }

  #bulletin(found: Anomaly[]) {
    for (const anomaly of found) {
      const fresh = !this.#bulletins.has(anomaly.id);
      this.#bulletins.set(anomaly.id, anomaly);
      const at = this.#places.get(anomaly.asn);
      if (fresh && at && anomaly.severity !== 'low') this.#globe?.ripple(at, 3, 0.09);
      if (fresh && anomaly.kind === 'leak' && anomaly.path) {
        const hops = anomaly.path.toReversed().filter((asn) => this.#places.has(asn));
        this.#globe?.route(
          hops.map((asn) => this.#places.get(asn)!),
          hops,
          3
        );
      }
    }
    const stale = Date.now() - 30 * 60_000;
    for (const [id, anomaly] of this.#bulletins)
      if (anomaly.last < stale) this.#bulletins.delete(id);
    this.anomalies = [...this.#bulletins.values()]
      .sort((a, b) => rank[a.severity] - rank[b.severity] || b.last - a.last)
      .slice(0, MOST_BULLETINS);
  }

  #everySecond() {
    const second = this.#second;
    this.steps = [...this.steps.slice(1), second.updates];
    const smooth = (previous: number, value: number) => previous * 0.6 + value * 0.4;
    this.perSecond = {
      updates: smooth(this.perSecond.updates, second.updates),
      announced: smooth(this.perSecond.announced, second.announced),
      withdrawn: smooth(this.perSecond.withdrawn, second.withdrawn),
      changed: smooth(this.perSecond.changed, second.changed),
      kilobytes: smooth(this.perSecond.kilobytes, second.bytes / 1024)
    };
    this.#second = { updates: 0, announced: 0, withdrawn: 0, changed: 0, bytes: 0 };
    for (const [key, window] of this.#region) {
      const [announced, withdrawn] = this.#regionSecond.get(key) ?? [0, 0];
      window.announced.push(announced);
      window.withdrawn.push(withdrawn);
      window.announced.shift();
      window.withdrawn.shift();
    }
    this.#regionSecond.clear();
    this.#paintPressure();
  }

  /** Busy countries get bigger halftone dots, scaled against whoever's busiest right now */
  #paintPressure() {
    const keep = Math.exp(-1 / PRESSURE_TAU);
    let busiest = 1;
    for (let i = 0; i < this.#pressure.length; i++) {
      this.#pressure[i] = this.#pressure[i] * keep + this.#countrySecond[i] * (1 - keep);
      busiest = Math.max(busiest, this.#pressure[i]);
    }
    this.#countrySecond.fill(0);
    const scale = Math.log1p(busiest);
    this.#pressure.forEach((value, i) =>
      this.#globe?.setCountry(i, Math.log1p(value) / scale, this.#alarm[i])
    );
    this.#globe?.flushCountries();
  }

  #paintAlarms() {
    this.#alarm.fill(0);
    const index = new Map(this.#world.countries.map((code, i) => [code, i]));
    for (const incident of this.incidents) {
      if (incident.kind !== 'outage') continue;
      for (const code of incident.countries) {
        const i = index.get(code);
        if (i !== undefined) this.#alarm[i] = Math.max(this.#alarm[i], incident.end ? 0.35 : 1);
      }
    }
  }

  #refreshForecast() {
    const listening = Math.max(this.peers.heard, 1);
    const trouble = new Map<string, Visibility>();
    const regionOfCountry = new Map(
      this.#world.countries.map((code, i) => [code, this.#world.regions[i]])
    );
    const worsen = (region: string | undefined, visibility: Visibility) => {
      if (!region || trouble.get(region) === 'poor') return;
      trouble.set(region, visibility);
    };
    for (const incident of this.incidents) {
      if (!incident.end)
        for (const code of incident.countries) worsen(regionOfCountry.get(code), 'poor');
    }
    for (const anomaly of this.anomalies) {
      if (anomaly.severity === 'low') continue;
      const at = this.#places.get(anomaly.asn);
      const region = at && this.#nearestRegion(at);
      worsen(region, anomaly.severity === 'high' ? 'poor' : 'moderate');
    }
    this.forecast = (Object.entries(regions) as [RegionKey, string][]).map(([key, name]) => {
      const window = this.#region.get(key)!;
      const visibility = trouble.get(key) ?? 'good';
      return {
        key,
        name,
        visibility,
        line: forecastLine(window.announced, window.withdrawn, listening, visibility)
      };
    });
  }

  #nearestRegion([lat, lon]: Place) {
    let best: { region: string; distance: number } | undefined;
    const dots = this.#world.dots;
    for (let i = 0; i < dots.length; i += 3 * 7) {
      const distance = Math.hypot(dots[i] / 10 - lat, dots[i + 1] / 10 - lon);
      const region = this.#world.regions[dots[i + 2]];
      if (region && (!best || distance < best.distance)) best = { region, distance };
    }
    return best?.region;
  }
}
