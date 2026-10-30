import type { HandleServerError } from '@sveltejs/kit/hooks';
import { waitUntil } from 'cloudflare:workers';
import { report } from '#lib/server/report.ts';

export const handleError: HandleServerError = ({ kind, error, event }) => {
  if (kind !== 'unknown') return;
  waitUntil(report(error, event));
};
