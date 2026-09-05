import { describe, expect, it, vi } from 'vitest';
import { AnalyticsCollector } from '../analytics';
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
    const collector = new AnalyticsCollector(resolveConfig({ apiKey: 'key', enabled: false }), transport);
    expect(collector.capturePageview()).toBe('');
    expect(send).not.toHaveBeenCalled();
    expect(cookie.get('tracekit_visitor_id')).toBeUndefined();
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
