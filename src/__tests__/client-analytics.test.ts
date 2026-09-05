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
});
