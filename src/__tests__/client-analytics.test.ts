import { describe, expect, it } from 'vitest';
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
});
