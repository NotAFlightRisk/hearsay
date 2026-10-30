import { json } from '@sveltejs/kit';
import * as env from '$app/env/private';
import { cached } from '#lib/server/cache.js';
import { gatherIncidents } from '#lib/server/incidents.js';
import type { RequestHandler } from './$types';

export const prerender = false;

const FRESH_FOR = 10 * 60_000;

export const GET: RequestHandler = async () => {
  const token = env.RADAR_TOKEN?.trim() || undefined;
  const body = await cached(`incidents:${token ? 'radar' : 'ioda'}`, FRESH_FOR, async () => ({
    updated: new Date().toISOString(),
    radar: Boolean(token),
    incidents: await gatherIncidents(token)
  }));
  return json(body, { headers: { 'cache-control': 'public, max-age=300' } });
};
