import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsCollector } from '../analytics';
import { resolveConfig } from '../config';
import { instrumentNavigation } from '../integrations/navigation';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('navigation analytics', () => {
  it('deduplicates the same raw URL', () => {
    const location = new URL('https://example.test/home');
    const collector = new AnalyticsCollector(resolveConfig({ apiKey: 'key' }), { send: () => Promise.resolve(true) } as never, {
      location: () => location as unknown as Location,
      document: () => ({ title: '', referrer: '' } as unknown as Document),
    });
    expect(collector.capturePageview()).toHaveLength(32);
    expect(collector.capturePageview()).toBe('');
  });

  it('captures changed SPA history URLs once and restores hooks', () => {
    const capturePageview = vi.fn();
    const client = { capturePageview, getScope: () => ({ addBreadcrumb: vi.fn() }) } as never;
    const originalPush = window.history.pushState;
    const teardown = instrumentNavigation(client);
    window.history.pushState({}, '', '/push');
    window.history.replaceState({}, '', '/replace');
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: 'https://example.test/replace', newURL: 'https://example.test/replace#one' }));
    expect(capturePageview).toHaveBeenCalledTimes(4);
    teardown();
    expect(window.history.pushState).toBe(originalPush);
  });

  it('keeps presence navigation active when navigation integration is disabled', () => {
    const onNavigate = vi.fn();
    const capturePageview = vi.fn();
    const client = { capturePageview, getScope: () => ({ addBreadcrumb: vi.fn() }) } as never;
    const teardown = instrumentNavigation(client, onNavigate, false);
    window.history.pushState({}, '', '/presence-only');
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(capturePageview).not.toHaveBeenCalled();
    teardown();
  });
});
