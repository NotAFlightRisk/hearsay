import type { Relay } from './relay.ts';

export { Relay } from './relay.ts';

export interface Env {
  RELAY: DurableObjectNamespace<Relay>;
}

const local = (origin: string | null) =>
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin ?? '');
// pages elsewhere could keep it listening on our bill, so only ours gets in, or anything local in dev
const welcome = (origin: string | null, site: string) =>
  origin === site || (local(site) && local(origin));

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/feed') return fetch(request);
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('This is a WebSocket', { status: 426 });
    }
    if (!welcome(request.headers.get('Origin'), url.origin)) {
      return new Response('Not from here', { status: 403 });
    }
    // RIS Live is in Amsterdam, so the relay lives nearby
    const relay = env.RELAY.get(env.RELAY.idFromName('world'), { locationHint: 'weur' });
    return relay.fetch(request);
  }
} satisfies ExportedHandler<Env>;
