import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserClient } from '../client';
import { resolveConfig } from '../config';

type FakeMessageListener = (event: MessageEvent) => void;

class FakeBroadcastChannel {
  static readonly instances: FakeBroadcastChannel[] = [];
  readonly name: string;
  private readonly listeners = new Set<FakeMessageListener>();
  closed = false;

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') this.listeners.add(listener as FakeMessageListener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message') this.listeners.delete(listener as FakeMessageListener);
  }

  postMessage(data: unknown): void {
    for (const channel of FakeBroadcastChannel.instances) {
      if (channel === this || channel.closed || channel.name !== this.name) continue;
      for (const listener of channel.listeners) listener(new MessageEvent('message', { data }));
    }
  }

  close(): void { this.closed = true; }
}

const presenceCalls = (fetchMock: ReturnType<typeof vi.fn>): Array<{ visibility: string; sequence: number; tab_id: string }> =>
  (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)
    .filter(([url]) => url.endsWith('/v1/analytics/browser/presence'))
    .map(([, init]) => JSON.parse(init.body as string) as { visibility: string; sequence: number; tab_id: string });

const setupFetch = () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 202 })));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  FakeBroadcastChannel.instances.length = 0;
});

describe('browser presence lifecycle', () => {
  it('sends visible presence after install and hidden presence once on pagehide', async () => {
    vi.useFakeTimers();
    const fetchMock = setupFetch();
    const client = new BrowserClient(resolveConfig({ apiKey: 'public', endpoint: 'https://tracekit.test' }));
    client.install();
    await vi.advanceTimersByTimeAsync(50);
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    await vi.advanceTimersByTimeAsync(1);
    const calls = presenceCalls(fetchMock);
    expect(calls.some((call) => call.visibility === 'visible')).toBe(true);
    expect(calls.filter((call) => call.visibility === 'hidden')).toHaveLength(1);
    client.destroy();
  });

  it('restores visible presence after visibility changes and pageshow', async () => {
    vi.useFakeTimers();
    const fetchMock = setupFetch();
    const client = new BrowserClient(resolveConfig({ apiKey: 'public', endpoint: 'https://tracekit.test' }));
    client.install();
    await vi.advanceTimersByTimeAsync(60);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
    await vi.advanceTimersByTimeAsync(1);
    const calls = presenceCalls(fetchMock);
    expect(calls.filter((call) => call.visibility === 'hidden')).toHaveLength(2);
    expect(calls.filter((call) => call.visibility === 'visible').length).toBeGreaterThanOrEqual(3);
    client.destroy();
  });

  it.each([
    { random: 0, delay: 27_000 },
    { random: 1, delay: 33_000 },
  ])('schedules the next visible event at the $delay millisecond jitter boundary', async ({ random, delay }) => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(random);
    const fetchMock = setupFetch();
    const client = new BrowserClient(resolveConfig({ apiKey: 'public', endpoint: 'https://tracekit.test' }));
    client.install();
    await vi.advanceTimersByTimeAsync(50);
    const before = presenceCalls(fetchMock).length;
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(presenceCalls(fetchMock)).toHaveLength(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(presenceCalls(fetchMock).length).toBeGreaterThan(before);
    client.destroy();
  });

  it('persists sequence before a failed presence send', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url: string) => url.endsWith('/presence') ? new Promise<Response>(() => {}) : Promise.resolve(new Response('', { status: 202 })));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BrowserClient(resolveConfig({ apiKey: 'public', endpoint: 'https://tracekit.test' }));
    client.install();
    await vi.advanceTimersByTimeAsync(60);
    expect(JSON.parse(sessionStorage.getItem('tracekit_presence_tab') ?? '{}').sequence).toBe(1);
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    await vi.advanceTimersByTimeAsync(1);
    expect(JSON.parse(sessionStorage.getItem('tracekit_presence_tab') ?? '{}').sequence).toBe(2);
    client.destroy();
  });

  it.each([
    ['empty', ''],
    ['oversized', 'a'.repeat(33)],
    ['uppercase', 'A'.repeat(32)],
    ['hyphenated', '00000000-0000-0000-0000-000000000000'],
    ['unsafe characters', '../presence-tab-unsafe........'],
  ])('replaces a %s stored tab identifier with a fresh exact-format identifier', async (_label, tabId) => {
    vi.useFakeTimers();
    sessionStorage.setItem('tracekit_presence_tab', JSON.stringify({ tab_id: tabId, sequence: 4 }));
    const generated = '01234567-89ab-cdef-0123-456789abcdef';
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(generated);
    const fetchMock = setupFetch();
    const client = new BrowserClient(resolveConfig({ apiKey: 'public', endpoint: 'https://tracekit.test' }));
    client.install();
    await vi.advanceTimersByTimeAsync(50);
    const stored = JSON.parse(sessionStorage.getItem('tracekit_presence_tab') ?? '{}') as { tab_id: string; sequence: number };
    expect(stored.tab_id).toBe(generated.replace(/-/g, ''));
    expect(stored.tab_id).toMatch(/^[0-9a-f]{32}$/);
    expect(stored.sequence).toBe(1);
    expect(presenceCalls(fetchMock)[0]?.tab_id).toBe(stored.tab_id);
    client.destroy();
  });

  it('replaces a stored record with an unsafe sequence before sending', async () => {
    vi.useFakeTimers();
    sessionStorage.setItem('tracekit_presence_tab', JSON.stringify({ tab_id: 'a'.repeat(32), sequence: Number.MAX_SAFE_INTEGER }));
    const generated = 'fedcba98-7654-3210-fedc-ba9876543210';
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(generated);
    const fetchMock = setupFetch();
    const client = new BrowserClient(resolveConfig({ apiKey: 'public', endpoint: 'https://tracekit.test' }));
    client.install();
    await vi.advanceTimersByTimeAsync(50);
    const stored = JSON.parse(sessionStorage.getItem('tracekit_presence_tab') ?? '{}') as { tab_id: string; sequence: number };
    expect(stored.tab_id).toBe(generated.replace(/-/g, ''));
    expect(stored.sequence).toBe(1);
    expect(presenceCalls(fetchMock)[0]?.sequence).toBe(1);
    client.destroy();
  });

  it('keeps an ownership listener after a cloned tab collision regenerates its tab', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const fetchMock = setupFetch();
    const first = new BrowserClient(resolveConfig({ apiKey: 'public', endpoint: 'https://tracekit.test' }));
    first.install();
    await vi.advanceTimersByTimeAsync(60);
    const originalTab = JSON.parse(sessionStorage.getItem('tracekit_presence_tab') ?? '{}').tab_id;
    const second = new BrowserClient(resolveConfig({ apiKey: 'public', endpoint: 'https://tracekit.test' }));
    second.install();
    await vi.advanceTimersByTimeAsync(60);
    const replacementTab = JSON.parse(sessionStorage.getItem('tracekit_presence_tab') ?? '{}').tab_id;
    expect(replacementTab).not.toBe(originalTab);
    expect(FakeBroadcastChannel.instances).toHaveLength(3);
    expect(FakeBroadcastChannel.instances[0].closed).toBe(false);
    expect(FakeBroadcastChannel.instances[1].closed).toBe(true);
    expect(FakeBroadcastChannel.instances[2].closed).toBe(false);
    const before = fetchMock.mock.calls.length;
    FakeBroadcastChannel.instances[0].postMessage({ type: 'claim', tab_id: originalTab });
    FakeBroadcastChannel.instances[2].postMessage({ type: 'claim', tab_id: replacementTab });
    expect(fetchMock.mock.calls.length).toBe(before);
    first.destroy();
    second.destroy();
  });

  it('removes lifecycle listeners, timers, and ownership channels on teardown', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const fetchMock = setupFetch();
    const client = new BrowserClient(resolveConfig({ apiKey: 'public', endpoint: 'https://tracekit.test' }));
    client.install();
    await vi.advanceTimersByTimeAsync(60);
    client.destroy();
    const before = presenceCalls(fetchMock).length;
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(33_000);
    expect(presenceCalls(fetchMock)).toHaveLength(before);
    expect(FakeBroadcastChannel.instances.every((channel) => channel.closed)).toBe(true);
  });
});
