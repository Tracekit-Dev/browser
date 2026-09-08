import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserClient } from '../client';
import { resolveConfig } from '../config';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('browser presence lifecycle', () => {
  it('sends visible presence after install and hidden presence once on pagehide', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 202 })));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BrowserClient(resolveConfig({ apiKey: 'public', endpoint: 'https://tracekit.test' }));
    client.install();
    await vi.advanceTimersByTimeAsync(60);
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    await vi.advanceTimersByTimeAsync(1);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.some((call) => JSON.parse(call[1].body as string).visibility === 'visible')).toBe(true);
    expect(calls.filter((call) => JSON.parse(call[1].body as string).visibility === 'hidden')).toHaveLength(1);
    client.destroy();
  });

  it('uses a jittered chained timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 202 })));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BrowserClient(resolveConfig({ apiKey: 'public', endpoint: 'https://tracekit.test' }));
    client.install();
    await vi.advanceTimersByTimeAsync(60);
    const before = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    client.destroy();
  });
});
