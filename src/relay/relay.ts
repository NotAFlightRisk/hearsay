import { DurableObject } from 'cloudflare:workers';
import { ripestatOwners } from '#lib/bgp/blame.ts';
import { parseAsnTable } from '#lib/geo/asn.ts';
import { FRAME_MS, Hub } from '#lib/relay/hub.ts';
import {
  levels,
  OUT_OF_BUDGET,
  type FromRelay,
  type Level,
  type ToRelay
} from '#lib/stream/protocol.ts';
import type { Env } from './worker.ts';

const RIS = 'https://ris-live.ripe.net/v1/ws/?client=hearsay-relay';
// Cloudflare bills 20 incoming messages as one request, so this is about $19 a month
const MONTHLY_MESSAGES = 2_500_000_000;
const GRACE_MS = 30_000;
const SAVE_EVERY_MS = 60_000;
const STALE_MS = 60_000;
const MAX_RETRY_MS = 30_000;

interface Viewer {
  level: Level;
}

const month = () => new Date().toISOString().slice(0, 7);

/** Listens to every RIS peer while anyone's watching, and sends each of them the digest */
export class Relay extends DurableObject<Env> {
  #hub?: Hub;
  #starting?: Promise<void>;
  #ris?: WebSocket;
  #timers: number[] = [];
  #idle: number | null = null;
  #retry: number | null = null;
  #retries = 0;
  // bumps on every stop, so anything still in flight from an earlier run knows to give up
  #run = 0;
  #lastHeard = 0;
  #month = '';
  #used = 0;
  #savedAt = 0;

  async fetch(request: Request) {
    await this.#loadUsage();
    if (this.#used >= MONTHLY_MESSAGES) {
      return new Response('The relay has used up its budget for this month', { status: 503 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ level: 'standard' } satisfies Viewer);
    clearTimeout(this.#idle);
    const site = request.headers.get('Origin') ?? request.url;
    this.#starting ??= this.#start(new URL('/data/asn.txt', site)).catch(() => {
      // everyone's sent away to try again, which starts it afresh
      this.#starting = undefined;
      for (const viewer of this.#viewers()) viewer.close(1011, 'The relay failed to start');
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(viewer: WebSocket, message: string | ArrayBuffer) {
    let data: ToRelay;
    try {
      data = JSON.parse(String(message));
    } catch {
      return;
    }
    if (data.type === 'level' && data.level in levels) {
      viewer.serializeAttachment({ level: data.level } satisfies Viewer);
    } else if (data.type === 'inspect' && this.#hub) {
      const reply: FromRelay = { type: 'network', network: this.#hub.network(data.asn) };
      viewer.send(JSON.stringify(reply));
    }
  }

  webSocketClose() {
    this.#stopWhenAlone();
  }

  webSocketError() {
    this.#stopWhenAlone();
  }

  #viewers() {
    return this.ctx.getWebSockets().filter((viewer) => viewer.readyState === WebSocket.OPEN);
  }

  #stopWhenAlone() {
    if (this.#viewers().length) return;
    clearTimeout(this.#idle);
    this.#idle = setTimeout(() => this.#stop(), GRACE_MS);
  }

  async #start(asnTable: URL) {
    const run = this.#run;
    const response = await fetch(asnTable);
    if (!response.ok) throw new Error(`asn.txt answered ${response.status}`);
    const table = parseAsnTable(await response.text());
    if (run !== this.#run) return;
    this.#hub = new Hub(table, ripestatOwners);
    this.#timers = [
      setInterval(() => this.#broadcast(), FRAME_MS),
      setInterval(() => this.#tick(), 1000)
    ];
    await this.#listen();
  }

  #stop() {
    if (this.#viewers().length) return;
    this.#run++;
    for (const timer of this.#timers) clearInterval(timer);
    clearTimeout(this.#retry);
    this.#timers = [];
    this.#starting = undefined;
    this.#hub = undefined;
    const ris = this.#ris;
    this.#ris = undefined;
    ris?.close();
    void this.#saveUsage();
  }

  async #listen() {
    const run = this.#run;
    const response = await fetch(RIS, { headers: { Upgrade: 'websocket' } }).catch(() => undefined);
    const ris = response?.webSocket;
    ris?.accept();
    if (run !== this.#run) return ris?.close();
    if (!ris) return this.#reconnect();
    this.#ris = ris;
    this.#retries = 0;
    if (Date.now() - this.#lastHeard > STALE_MS) this.#hub?.reset();
    ris.send(JSON.stringify({ type: 'ris_subscribe', data: { type: 'UPDATE' } }));
    ris.addEventListener('message', ({ data }) => {
      this.#used++;
      this.#lastHeard = Date.now();
      this.#hub?.hear(String(data), this.#lastHeard);
    });
    const lost = () => {
      if (this.#ris !== ris) return;
      this.#ris = undefined;
      this.#reconnect();
    };
    ris.addEventListener('close', lost);
    ris.addEventListener('error', lost);
  }

  #reconnect() {
    if (!this.#hub) return;
    const wait = Math.min(1000 * 2 ** this.#retries++, MAX_RETRY_MS);
    this.#retry = setTimeout(() => void this.#listen(), wait);
  }

  #broadcast() {
    if (!this.#hub) return;
    const frames = this.#hub.frame(Date.now());
    const sent: Partial<Record<Level, string>> = {};
    for (const viewer of this.#viewers()) {
      const { level } = viewer.deserializeAttachment() as Viewer;
      try {
        viewer.send((sent[level] ??= JSON.stringify(frames[level])));
      } catch {
        // it's closing, and webSocketClose will tidy up
      }
    }
  }

  #tick() {
    const now = Date.now();
    this.#hub?.tick(now);
    if (month() !== this.#month) this.#rollOver();
    else if (now - this.#savedAt > SAVE_EVERY_MS) void this.#saveUsage();
    if (this.#used < MONTHLY_MESSAGES) return;
    for (const viewer of this.#viewers()) viewer.close(OUT_OF_BUDGET, 'Out of budget');
    this.#stop();
  }

  async #loadUsage() {
    if (this.#month === month()) return;
    this.#month = month();
    this.#used = (await this.ctx.storage.get<number>(`used:${this.#month}`)) ?? 0;
  }

  async #saveUsage() {
    this.#savedAt = Date.now();
    await this.ctx.storage.put(`used:${this.#month}`, this.#used);
  }

  #rollOver() {
    void this.ctx.storage.put(`used:${this.#month}`, this.#used);
    this.#month = month();
    this.#used = 0;
  }
}
