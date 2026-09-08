import { describe, expect, it, vi } from 'vitest';
import { BrowserPresenceTransport } from '../presence-transport';
import { resolveConfig } from '../config';
import type { BrowserPresencePayload } from '../types';

const payload = (): BrowserPresencePayload => ({ service_name: 'site', visitor_id: 'a'.repeat(32), session_id: 'b'.repeat(32), tab_id: 'c'.repeat(32), sequence: 1, visibility: 'visible', page_path: '/', landing_source: '', landing_referrer: '' });

describe('browser presence contract', () => {
  it('sends empty optional attribution fields and only allowlisted fields', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 202 })));
    vi.stubGlobal('fetch', fetchMock);
    await new BrowserPresenceTransport(resolveConfig({ apiKey: 'public', endpoint: 'https://tracekit.test' })).send({ ...payload(), diagnostic: 'drop me' } as BrowserPresencePayload & { diagnostic: string });
    const call = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0];
    const body = JSON.parse(call[1].body as string);
    expect(body).toEqual({ ...payload() });
    expect(call[0]).toBe('https://tracekit.test/v1/analytics/browser/presence');
    vi.unstubAllGlobals();
  });

  it('does not send invalid values or leak transport errors', async () => {
    const fetchMock = vi.fn(() => { throw new Error('network'); });
    vi.stubGlobal('fetch', fetchMock);
    const transport = new BrowserPresenceTransport(resolveConfig({ apiKey: 'public' }));
    expect(await transport.send({ ...payload(), sequence: -1 })).toBe(false);
    expect(await transport.send(payload())).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
