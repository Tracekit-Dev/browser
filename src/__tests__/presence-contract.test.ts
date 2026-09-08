import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserPresenceTransport, MAX_PRESENCE_BODY_BYTES } from '../presence-transport';
import { resolveConfig } from '../config';
import type { BrowserPresencePayload } from '../types';

const payload = (): BrowserPresencePayload => ({ service_name: 'site', visitor_id: 'a'.repeat(32), session_id: 'b'.repeat(32), tab_id: 'c'.repeat(32), sequence: 1, visibility: 'visible', page_path: '/', landing_source: '', landing_referrer: '' });

afterEach(() => { vi.unstubAllGlobals(); });

describe('browser presence contract', () => {
  it('sends empty optional attribution fields and only allowlisted fields', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 202 })));
    vi.stubGlobal('fetch', fetchMock);
    await new BrowserPresenceTransport(resolveConfig({ apiKey: 'public', endpoint: 'https://tracekit.test' })).send({ ...payload(), diagnostic: 'drop me' } as BrowserPresencePayload & { diagnostic: string });
    const call = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0];
    const body = JSON.parse(call[1].body as string);
    expect(body).toEqual({ ...payload() });
    expect(call[0]).toBe('https://tracekit.test/v1/analytics/browser/presence');
  });

  it('does not send invalid values or leak transport errors', async () => {
    const fetchMock = vi.fn(() => { throw new Error('network'); });
    vi.stubGlobal('fetch', fetchMock);
    const transport = new BrowserPresenceTransport(resolveConfig({ apiKey: 'public' }));
    expect(await transport.send({ ...payload(), sequence: -1 })).toBe(false);
    expect(await transport.send(payload())).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts exact UTF-8 field limits and rejects one byte over', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 202 })));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new BrowserPresenceTransport(resolveConfig({ apiKey: 'public' }));
    const exact = { ...payload(), service_name: '€'.repeat(85), page_path: 'x'.repeat(2048) };
    expect(await transport.send(exact)).toBe(true);
    expect(await transport.send({ ...exact, page_path: `${exact.page_path}x` })).toBe(false);
    const optionalExact = { ...payload(), landing_source: '€'.repeat(85), landing_referrer: 'x'.repeat(2048) };
    expect(await transport.send(optionalExact)).toBe(true);
    expect(await transport.send({ ...optionalExact, landing_source: `${optionalExact.landing_source}€` })).toBe(false);
    expect(await transport.send({ ...optionalExact, landing_referrer: `${optionalExact.landing_referrer}x` })).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new TextEncoder().encode(JSON.stringify({
      service_name: exact.service_name,
      visitor_id: exact.visitor_id,
      session_id: exact.session_id,
      tab_id: exact.tab_id,
      sequence: exact.sequence,
      visibility: exact.visibility,
      page_path: exact.page_path,
      landing_source: exact.landing_source,
      landing_referrer: exact.landing_referrer,
    })).byteLength).toBeLessThan(MAX_PRESENCE_BODY_BYTES);
  });

  it('rejects empty required fields but allows empty optional attribution', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 202 })));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new BrowserPresenceTransport(resolveConfig({ apiKey: 'public' }));
    expect(await transport.send(payload())).toBe(true);
    for (const field of ['service_name', 'visitor_id', 'session_id', 'tab_id', 'page_path'] as const) {
      expect(await transport.send({ ...payload(), [field]: '' })).toBe(false);
    }
    expect(await transport.send({ ...payload(), landing_source: '', landing_referrer: '' })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
