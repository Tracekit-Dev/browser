import { describe, expect, it, vi } from 'vitest';
import { AnalyticsCollector, defaultAnalyticsCookies } from '../analytics';
import { BrowserAnalyticsTransport } from '../analytics-transport';
import { resolveConfig } from '../config';
import type { AnalyticsCookieAdapter } from '../analytics';

function cookies(): AnalyticsCookieAdapter {
  const values = new Map<string, string>();
  return { get: (name) => values.get(name), set: (name, value) => values.set(name, value) };
}

describe('browser analytics', () => {
  it('does not create identifiers or send when disabled', () => {
    const cookie = cookies();
    const send = vi.fn();
    const transport = { send } as unknown as BrowserAnalyticsTransport;
    const collector = new AnalyticsCollector(resolveConfig({ apiKey: 'key', enabled: false }), transport, { cookies: cookie });
    expect(collector.capturePageview()).toBe('');
    expect(send).not.toHaveBeenCalled();
    expect(cookie.get('tracekit_visitor_id')).toBeUndefined();
  });

  it('keeps identities active and starts a new session after inactivity', () => {
    const cookie = cookies();
    let now = 1_000_000;
    let current = new URL('https://example.test/landing?utm_campaign=first');
    const events: Array<{ visitor_id: string; session_id: string; utm_campaign: string }> = [];
    const collector = new AnalyticsCollector(resolveConfig({ apiKey: 'key' }), { send: vi.fn((event) => { events.push(event); return Promise.resolve(true); }) } as never, {
      cookies: cookie,
      now: () => now,
      location: () => current as unknown as Location,
      document: () => ({ title: '', referrer: '' } as unknown as Document),
    });
    collector.capturePageview();
    const first = events[0];
    now += 29 * 60 * 1000;
    current = new URL('https://example.test/active');
    collector.capturePageview();
    expect(events[1].visitor_id).toBe(first.visitor_id);
    expect(events[1].session_id).toBe(first.session_id);
    now += 30 * 60 * 1000;
    current = new URL('https://example.test/new');
    collector.capturePageview();
    expect(events[2].visitor_id).toBe(first.visitor_id);
    expect(events[2].session_id).not.toBe(first.session_id);
    expect(events[2].utm_campaign).toBe('');
  });

  it('rejects a modified attribution cookie and creates a clean snapshot', () => {
    const cookie = cookies();
    let current = new URL('https://example.test/landing?utm_source=clean');
    const collector = new AnalyticsCollector(resolveConfig({ apiKey: 'key' }), { send: vi.fn(() => Promise.resolve(true)) } as never, {
      cookies: cookie,
      location: () => current as unknown as Location,
      document: () => ({ title: '', referrer: 'https://safe.example/ref' } as unknown as Document),
    });
    collector.capturePageview();
    const session = cookie.get('tracekit_session_id')!;
    cookie.set('tracekit_session_attribution', encodeURIComponent(JSON.stringify({ sessionId: session, pageUrl: 'https://example.test/landing', referrer: 'https://referrer.test/path?token=secret#fragment', utm_source: 'unsafe', utm_medium: '', utm_campaign: '', utm_term: '', utm_content: '' })), 1800);
    current = new URL('https://example.test/next');
    const send = vi.fn(() => Promise.resolve(true));
    const restored = new AnalyticsCollector(resolveConfig({ apiKey: 'key' }), { send } as never, {
      cookies: cookie,
      location: () => current as unknown as Location,
      document: () => ({ title: '', referrer: 'https://safe.example/ref' } as unknown as Document),
    });
    restored.capturePageview();
    const restoredEvent = (send.mock.calls as unknown as Array<Array<{ referrer: string }>>)[0][0];
    expect(restoredEvent.referrer).toBe('https://safe.example/ref');
  });

  it('accepts nested arrays and never throws for unsupported goal values', () => {
    const send = vi.fn(() => Promise.resolve(true));
    const collector = new AnalyticsCollector(resolveConfig({ apiKey: 'key' }), { send } as never, {
      location: () => new URL('https://example.test/') as unknown as Location,
      document: () => ({ title: '', referrer: '' } as unknown as Document),
    });
    expect(() => collector.track('array_goal', { values: [{ nested: ['ok', 1, null] }] })).not.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
    expect(() => collector.track('bigint_goal', { value: BigInt(1) })).not.toThrow();
    expect(collector.track('bigint_goal', { value: BigInt(1) })).toBe('');
  });

  it('uses memory-only identity when cookies fail', () => {
    const failingCookies: AnalyticsCookieAdapter = { get: () => { throw new Error('blocked'); }, set: () => { throw new Error('blocked'); } };
    let current = new URL('https://example.test/one');
    const events: Array<{ visitor_id: string; session_id: string }> = [];
    const collector = new AnalyticsCollector(resolveConfig({ apiKey: 'key' }), { send: vi.fn((event) => { events.push(event); return Promise.resolve(true); }) } as never, {
      cookies: failingCookies,
      location: () => current as unknown as Location,
      document: () => ({ title: '', referrer: '' } as unknown as Document),
    });
    collector.capturePageview();
    current = new URL('https://example.test/two');
    collector.capturePageview();
    expect(events[1].visitor_id).toBe(events[0].visitor_id);
    expect(events[1].session_id).toBe(events[0].session_id);
  });

  it('writes the required first-party cookie attributes', () => {
    const adapter = defaultAnalyticsCookies();
    const setter = vi.spyOn(document, 'cookie', 'set');
    adapter.set('tracekit_session_id', 'session', 1800);
    expect(setter).toHaveBeenCalledWith(expect.stringContaining('Path=/'));
    expect(setter).toHaveBeenCalledWith(expect.stringContaining('Max-Age=1800'));
    expect(setter).toHaveBeenCalledWith(expect.stringContaining('SameSite=Lax'));
    setter.mockRestore();
  });

  it('keeps first-touch attribution and removes query and fragment values', () => {
    const cookie = cookies();
    let current = new URL('https://example.test/landing?utm_source=newsletter&token=secret#hero');
    const sent: unknown[] = [];
    const transport = { send: vi.fn((event) => { sent.push(event); return Promise.resolve(true); }) } as unknown as BrowserAnalyticsTransport;
    const collector = new AnalyticsCollector(resolveConfig({ apiKey: 'key' }), transport, {
      cookies: cookie,
      location: () => current as unknown as Location,
      document: () => ({ title: 'Landing', referrer: 'https://search.test/?q=secret' } as unknown as Document),
    });
    expect(collector.capturePageview()).toHaveLength(32);
    current = new URL('https://example.test/next?utm_source=other');
    expect(collector.capturePageview()).toHaveLength(32);
    const second = sent[1] as { page_url: string; utm_source: string; referrer: string };
    expect(second.page_url).toBe('https://example.test/next');
    expect(second.utm_source).toBe('newsletter');
    expect(second.referrer).toBe('https://search.test/');
  });

  it('sends one event with header authentication', async () => {
    const request = vi.fn(() => Promise.resolve(new Response('', { status: 202 })));
    vi.stubGlobal('fetch', request);
    const config = resolveConfig({ apiKey: 'secret-key', endpoint: 'https://tracekit.test' });
    await new BrowserAnalyticsTransport(config).send({
      service_name: 'app', event_id: '1'.repeat(32), event_name: '$pageview', event_time: new Date().toISOString(),
      visitor_id: '2'.repeat(32), session_id: '3'.repeat(32), properties: {}, page_url: 'https://example.test/', page_path: '/',
      page_title: '', referrer: '', utm_source: '', utm_medium: '', utm_campaign: '', utm_term: '', utm_content: '',
    });
    expect(request).toHaveBeenCalledWith('https://tracekit.test/v1/analytics/browser/events', expect.objectContaining({
      headers: expect.objectContaining({ 'X-API-Key': 'secret-key' }),
    }));
    expect(String((request.mock.calls as unknown as unknown[][])[0][0])).not.toContain('secret-key');
  });
});
