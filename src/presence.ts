import type { BrowserClient } from './client';
import { BrowserPresenceTransport } from './presence-transport';
import type { BrowserPresencePayload } from './types';

const STORAGE_KEY = 'tracekit_presence_tab';
const CHANNEL_NAME = 'tracekit_presence_tabs';
const HANDSHAKE_MS = 50;

type TabRecord = { tab_id: string; sequence: number };

const randomId = (): string => {
  try { return crypto.randomUUID().replace(/-/g, ''); } catch { return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 32); }
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
    if (this.destroyed || !this.tab) return;
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
    const delay = 27_000 + Math.floor(Math.random() * 6_001);
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
      if (typeof parsed.tab_id === 'string' && typeof sequence === 'number' && Number.isSafeInteger(sequence) && sequence >= 0) stored = { tab_id: parsed.tab_id, sequence };
    } catch { stored = undefined; }
    if (typeof BroadcastChannel === 'undefined') { const next = fresh(); this.saveTab(next); return next; }
    const candidate = stored ?? fresh();
    let collision = false;
    try {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      const handler = (event: MessageEvent) => {
        if (event.data?.tab_id !== candidate.tab_id) return;
        if (event.data?.type === 'claim') this.channel?.postMessage({ type: 'owner', tab_id: candidate.tab_id });
        if (event.data?.type === 'owner') collision = true;
      };
      this.channel.addEventListener('message', handler);
      this.channel.postMessage({ type: 'claim', tab_id: candidate.tab_id });
      await new Promise<void>((resolve) => setTimeout(resolve, HANDSHAKE_MS));
      if (collision) { this.channel.close(); this.channel = undefined; return this.claimFresh(); }
    } catch { this.channel?.close(); this.channel = undefined; return this.claimFresh(); }
    this.saveTab(candidate);
    return candidate;
  }

  private claimFresh(): TabRecord {
    const next = { tab_id: randomId(), sequence: 0 };
    this.saveTab(next);
    return next;
  }

  private saveTab(value: TabRecord): void { try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* blocked storage */ } }
}
