import type { BrowserClient } from './client';
import { BrowserPresenceTransport } from './presence-transport';
import type { BrowserPresencePayload } from './types';

const STORAGE_KEY = 'tracekit_presence_tab';
const CHANNEL_NAME = 'tracekit_presence_tabs';
const HANDSHAKE_MS = 50;
const TAB_ID_PATTERN = /^[0-9a-f]{32}$/;

type TabRecord = { tab_id: string; sequence: number };

const randomId = (): string => {
  const browserCrypto = typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto;
  try {
    const uuid = browserCrypto?.randomUUID().replace(/-/g, '').toLowerCase();
    if (uuid && TAB_ID_PATTERN.test(uuid)) return uuid;
  } catch { /* Use the byte and Math.random fallbacks below. */ }
  try {
    if (browserCrypto?.getRandomValues) {
      const values = browserCrypto.getRandomValues(new Uint8Array(16));
      return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* Use the Math.random fallback below. */ }
  let fallback = '';
  while (fallback.length < 32) {
    const random = Math.max(0, Math.min(0.9999999999999999, Math.random()));
    fallback += Math.floor(random * 0x1_0000_0000).toString(16).padStart(8, '0');
  }
  return fallback.slice(0, 32);
};

export class BrowserPresence {
  private readonly transport: BrowserPresenceTransport;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private channel: BroadcastChannel | undefined;
  private tab: TabRecord | undefined;
  private teardown: (() => void) | undefined;
  private hiddenSent = false;
  private destroyed = false;

  constructor(private readonly client: BrowserClient) { this.transport = new BrowserPresenceTransport(client.getConfig()); }

  install(): void {
    if (this.destroyed || !this.client.getConfig().enabled || this.teardown || typeof window === 'undefined' || typeof document === 'undefined') return;
    void this.initialize();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.teardown?.();
    this.teardown = undefined;
    this.channel?.close();
    this.channel = undefined;
    this.transport.destroy();
  }

  private async initialize(): Promise<void> {
    this.tab = await this.claimTab();
    if (this.destroyed || !this.tab) {
      this.closeChannel();
      return;
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') this.hide();
      else this.show();
    };
    const onPageHide = () => this.hide();
    const onPageShow = () => this.show();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    this.teardown = () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
    if (document.visibilityState === 'hidden') this.hide(); else this.show();
  }

  onNavigation(): void { if (!this.destroyed && document.visibilityState !== 'hidden') void this.send('visible'); }

  private show(): void {
    if (this.hiddenSent) this.hiddenSent = false;
    void this.send('visible');
    this.schedule();
  }

  private hide(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.hiddenSent) return;
    this.hiddenSent = true;
    void this.send('hidden');
  }

  private schedule(): void {
    if (this.destroyed || document.visibilityState === 'hidden') return;
    if (this.timer) clearTimeout(this.timer);
    const random = Math.max(0, Math.min(1, Math.random()));
    const delay = 27_000 + Math.min(6_000, Math.floor(random * 6_001));
    this.timer = setTimeout(() => { this.timer = undefined; if (document.visibilityState !== 'hidden') { void this.send('visible'); this.schedule(); } }, delay);
  }

  private async send(visibility: 'visible' | 'hidden'): Promise<void> {
    if (!this.tab || this.destroyed) return;
    const snapshot = this.client.getAnalyticsIdentitySnapshot();
    if (!snapshot) return;
    this.tab.sequence += 1;
    this.saveTab(this.tab);
    const payload: BrowserPresencePayload = { ...snapshot, tab_id: this.tab.tab_id, sequence: this.tab.sequence, visibility };
    await this.transport.send(payload);
  }

  private async claimTab(): Promise<TabRecord> {
    const fresh = (): TabRecord => ({ tab_id: randomId(), sequence: 0 });
    let stored: TabRecord | undefined;
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<TabRecord>;
      const sequence = parsed.sequence;
      if (typeof parsed.tab_id === 'string' && TAB_ID_PATTERN.test(parsed.tab_id) && typeof sequence === 'number' && Number.isSafeInteger(sequence) && sequence >= 0 && sequence < Number.MAX_SAFE_INTEGER) stored = { tab_id: parsed.tab_id, sequence };
    } catch { stored = undefined; }
    if (typeof BroadcastChannel === 'undefined') { const next = fresh(); this.saveTab(next); return next; }
    const candidate = stored ?? fresh();
    let collision = false;
    try {
      const channel = this.openOwnershipChannel(candidate, () => { collision = true; });
      channel.postMessage({ type: 'claim', tab_id: candidate.tab_id });
      await new Promise<void>((resolve) => setTimeout(resolve, HANDSHAKE_MS));
      if (this.destroyed) {
        this.closeChannel();
        return candidate;
      }
      if (collision) {
        this.closeChannel();
        return this.claimFresh();
      }
    } catch {
      this.closeChannel();
      return this.claimFresh();
    }
    this.saveTab(candidate);
    return candidate;
  }

  private openOwnershipChannel(candidate: TabRecord, onCollision: () => void): BroadcastChannel {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel = channel;
    const handler = (event: MessageEvent) => {
      if (event.data?.tab_id !== candidate.tab_id) return;
      if (event.data?.type === 'claim') channel.postMessage({ type: 'owner', tab_id: candidate.tab_id });
      if (event.data?.type === 'owner') onCollision();
    };
    channel.addEventListener('message', handler);
    return channel;
  }

  private claimFresh(): TabRecord {
    const next = { tab_id: randomId(), sequence: 0 };
    try {
      const channel = this.openOwnershipChannel(next, () => { /* A fresh random ID is the ownership boundary. */ });
      channel.postMessage({ type: 'claim', tab_id: next.tab_id });
    } catch {
      this.closeChannel();
    }
    this.saveTab(next);
    return next;
  }

  private closeChannel(): void {
    const channel = this.channel;
    this.channel = undefined;
    channel?.close();
  }

  private saveTab(value: TabRecord): void { try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* blocked storage */ } }
}
