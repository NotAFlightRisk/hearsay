import { site } from '#lib/meta.ts';

export const prerender = true;

export function GET() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${site}/</loc></url></urlset>`;
  return new Response(xml, { headers: { 'content-type': 'application/xml' } });
}
