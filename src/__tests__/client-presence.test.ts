import { describe, expect, it, vi } from 'vitest';
import { BrowserClient } from '../client';
import { resolveConfig } from '../config';

describe('client presence gating', () => {
  it('creates no presence side effects when disabled', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const storage = vi.spyOn(window.sessionStorage, 'setItem');
    const client = new BrowserClient(resolveConfig({ apiKey: 'public', enabled: false }));
    client.install();
    expect(storage).not.toHaveBeenCalled();
    expect(add.mock.calls.some(([name]) => name === 'pageshow' || name === 'visibilitychange')).toBe(false);
    client.destroy();
    add.mockRestore(); storage.mockRestore();
  });
});
