import { describe, expect, it, vi } from 'vitest';
import { BrowserClient } from '../client';
import { resolveConfig } from '../config';

describe('client analytics lifecycle', () => {
  it('returns an empty goal identifier when disabled', () => {
    const client = new BrowserClient(resolveConfig({ apiKey: 'key', enabled: false }));
    expect(client.track('signup')).toBe('');
  });

  it('rejects reserved custom goal names', () => {
    const client = new BrowserClient(resolveConfig({ apiKey: 'key' }));
    expect(client.track('$secret')).toBe('');
  });

  it('keeps diagnostics for five minutes and drops expired context', () => {
    const client = new BrowserClient(resolveConfig({ apiKey: 'key' }));
    const scope = client.getScope();
    scope.setRecentTraceContext('a'.repeat(32), 'b'.repeat(16), 1000);
    expect(scope.getRecentTraceContext(300000, 301000)?.traceId).toBe('a'.repeat(32));
    expect(scope.getRecentTraceContext(300000, 301001)).toBeNull();
    scope.clear();
    expect(scope.getRecentTraceContext(300000, 1000)).toBeNull();
  });

  it('flushes queued analytics during client destroy', async () => {
    let releaseFirst: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => {
      if (fetchMock.mock.calls.length === 1) return new Promise<Response>((resolve) => { releaseFirst = resolve; });
      return Promise.resolve(new Response('', { status: 202 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new BrowserClient(resolveConfig({ apiKey: 'key', endpoint: 'https://tracekit.test' }));
    for (let index = 0; index < 45; index += 1) client.track(`signup-${index}`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    client.destroy();
    releaseFirst?.(new Response('', { status: 202 }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    const ids = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>).flatMap((call) => {
      const payload = JSON.parse(call[1].body as string) as { events?: Array<{ event_id: string }>; event_id?: string };
      return payload.events?.map((item) => item.event_id) ?? [payload.event_id];
    });
    expect(ids).toHaveLength(45);
    expect(new Set(ids).size).toBe(45);
    vi.unstubAllGlobals();
  });

  it('removes analytics lifecycle listeners during client destroy', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const client = new BrowserClient(resolveConfig({ apiKey: 'key' }));
    client.destroy();
    client.destroy();
    expect(add).toHaveBeenCalledWith('pagehide', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('pagehide', expect.any(Function));
    add.mockRestore(); remove.mockRestore();
  });
});
