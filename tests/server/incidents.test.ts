import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Incident } from '#lib/bgp/types.js';
import { gatherIncidents } from '#lib/server/incidents.js';
import { report } from '#lib/server/report.js';
import iodaAsn from '../fixtures/ioda-asn.json';
import iodaCountry from '../fixtures/ioda-country.json';
import hijacks from '../fixtures/radar-hijacks.json';
import leaks from '../fixtures/radar-leaks.json';
import outages from '../fixtures/radar-outages.json';

vi.mock('#lib/server/report.js', () => ({ report: vi.fn(async () => {}) }));

const NOW = Number(iodaCountry.requestParameters.until) * 1000;
const radar: Record<string, unknown> = {
  '/radar/annotations/outages': outages,
  '/radar/bgp/leaks/events': leaks,
  '/radar/bgp/hijacks/events': hijacks
};

type Reply = () => Response | Promise<Response>;

function serve(overrides: Record<string, Reply> = {}) {
  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = new URL(String(input));
    const override = Object.entries(overrides).find(([path]) => url.href.includes(path));
    if (override) return override[1]();
    if (url.pathname.endsWith('/outages/events')) {
      return Response.json(
        url.searchParams.get('entityType') === 'country' ? iodaCountry : iodaAsn
      );
    }
    const body = Object.entries(radar).find(([path]) => url.pathname.endsWith(path))?.[1];
    return body ? Response.json(body) : new Response('nope', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const byId = (incidents: Incident[], id: string) =>
  incidents.find((incident) => incident.id === id);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(report).mockClear();
});

describe('gatherIncidents', () => {
  it('leaves Radar alone without a token', async () => {
    const fetchMock = serve();
    const incidents = await gatherIncidents(undefined, NOW);
    const hosts = fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname);
    expect(hosts).not.toContain('api.cloudflare.com');
    expect(incidents.length).toBeGreaterThan(0);
    expect(incidents.every((incident) => incident.source === 'IODA')).toBe(true);
  });

  it('sends the token to Radar and nowhere else', async () => {
    const fetchMock = serve();
    await gatherIncidents('secret', NOW);
    for (const [url, init] of fetchMock.mock.calls) {
      const auth = (init?.headers as Record<string, string>).authorization;
      const toRadar = new URL(String(url)).hostname === 'api.cloudflare.com';
      expect(auth).toBe(toRadar ? 'Bearer secret' : undefined);
    }
  });

  it('turns Radar outage annotations into incidents', async () => {
    serve();
    const incidents = await gatherIncidents('secret', NOW);
    expect(byId(incidents, 'radar-outage-1739')).toMatchObject({
      kind: 'outage',
      title: 'Outage at Digicel Haiti',
      start: '2026-10-27T17:15:00.000Z',
      end: '2026-10-28T15:30:00.000Z',
      asns: [27653],
      countries: ['HT'],
      url: expect.stringMatching(/^https:\/\/x\.com\//)
    });
    expect(byId(incidents, 'radar-outage-1739')?.detail).toMatch(/Route Nationale 1/);
    expect(byId(incidents, 'radar-outage-1737')).toMatchObject({
      title: 'Outage in Bangladesh',
      asns: [],
      countries: ['BD']
    });
    expect(byId(incidents, 'radar-outage-1734')).toMatchObject({
      title: 'Outage in Sevastopol City, Ukraine and Crimea, Ukraine',
      countries: ['UA']
    });
  });

  it('keeps only major leaks, folding the same leak into one', async () => {
    serve();
    const found = (await gatherIncidents('secret', NOW)).filter((i) => i.kind === 'leak');
    expect(found.map((leak) => leak.title).sort()).toEqual([
      'AS268624 leaked routes between AS12956 and AS22356',
      'AS268624 leaked routes between AS2914 and AS22356',
      'AS57304 leaked routes between AS9002 and AS1299'
    ]);
    expect(byId(found, 'radar-leak-654197')).toEqual({
      id: 'radar-leak-654197',
      kind: 'leak',
      source: 'Cloudflare Radar',
      title: 'AS57304 leaked routes between AS9002 and AS1299',
      detail: '8,529 prefixes from 2,046 networks, seen from 50 vantage points',
      start: '2026-10-26T09:15:55.000Z',
      end: undefined,
      asns: [57304, 9002, 1299],
      countries: ['GB', 'SE', 'RU'],
      prefixes: 8529,
      url: 'https://radar.cloudflare.com/routing/as57304'
    });
  });

  it('keeps hijacks seen widely enough to trust', async () => {
    serve();
    const found = (await gatherIncidents('secret', NOW)).filter((i) => i.kind === 'hijack');
    expect(found.map((hijack) => hijack.asns[0]).sort()).toEqual([131284, 270463]);
    expect(found.find((h) => h.asns[0] === 270463)).toMatchObject({
      title: 'AS270463 announced prefixes belonging to AS28103 and 2 others',
      detail: '201 prefixes, seen from 49 vantage points. RPKI marks the new origin as invalid',
      end: '2026-10-29T04:45:02.551Z',
      prefixes: 201
    });
    expect(found.find((h) => h.asns[0] === 131284)).toMatchObject({
      title: 'AS131284 announced prefixes belonging to AS137975',
      end: undefined,
      countries: ['AF']
    });
  });

  it('takes the worst few IODA outages per kind and skips the blips', async () => {
    serve();
    const incidents = await gatherIncidents(undefined, NOW);
    const countries = incidents.filter((i) => i.id.startsWith('ioda-country-'));
    const networks = incidents.filter((i) => i.id.startsWith('ioda-asn-'));
    expect(countries.map((i) => i.countries[0]).sort()).toEqual(
      ['AX', 'CN', 'GY', 'JE', 'LT', 'MN', 'MP', 'NF'].sort()
    );
    expect(networks).toHaveLength(8);
    expect(byId(networks, 'ioda-asn-8075')).toBeUndefined();
    expect(byId(networks, 'ioda-asn-11694')?.title).toBe('Possible outage at AS11694');
    expect(byId(networks, 'ioda-asn-1848')?.title).toBe('Possible outage at AS1848');
    expect(byId(networks, 'ioda-asn-23922')).toMatchObject({
      title: 'Possible outage at AS23922 (BHI-AU)',
      detail: 'Fewer of its routes than usual are visible in BGP',
      asns: [23922],
      end: undefined,
      url: 'https://ioda.inetintel.cc.gatech.edu/asn/23922'
    });
    expect(byId(networks, 'ioda-asn-27686')).toMatchObject({
      start: '2026-10-29T22:00:00.000Z',
      end: '2026-10-30T03:25:00.000Z'
    });
    expect(byId(countries, 'ioda-country-NF')).toMatchObject({
      title: 'Possible outage in Norfolk Island',
      detail: 'Less traffic than usual is reaching Google',
      end: undefined
    });
    expect(byId(countries, 'ioda-country-LT')?.end).toBe('2026-10-30T13:30:00.000Z');
  });

  it('drops outages shorter than a quarter of an hour', async () => {
    const pair = iodaAsn.data.filter((e) => ['asn/1848', 'asn/8075'].includes(e.location));
    serve({ 'entityType=asn': () => Response.json({ ...iodaAsn, data: pair }) });
    const networks = (await gatherIncidents(undefined, NOW)).filter((i) => i.asns.length);
    expect(networks.map((i) => i.id)).toEqual(['ioda-asn-1848']);
  });

  it('carries on when a source fails, and reports it', async () => {
    serve({
      '/bgp/leaks/events': () => new Response('down', { status: 500 }),
      'entityType=asn': () => Promise.reject(new DOMException('slow', 'TimeoutError'))
    });
    const incidents = await gatherIncidents('secret', NOW);
    const kinds = new Set(incidents.map((i) => i.id.split('-').slice(0, 2).join('-')));
    expect([...kinds].sort()).toEqual(['ioda-country', 'radar-hijack', 'radar-outage']);
    const reported = vi.mocked(report).mock.calls.map(([error]) => String(error));
    expect(reported).toHaveLength(2);
    expect(reported).toEqual(
      expect.arrayContaining([expect.stringMatching(/500/), expect.stringMatching(/TimeoutError/)])
    );
  });

  it('puts the newest first', async () => {
    serve();
    const starts = (await gatherIncidents('secret', NOW)).map((i) => Date.parse(i.start));
    expect(starts).toEqual([...starts].sort((a, b) => b - a));
  });
});
