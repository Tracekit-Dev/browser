import { describe, expect, it } from 'vitest';
import { AnalyticsCollector } from '../analytics';
import { resolveConfig } from '../config';

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
});
