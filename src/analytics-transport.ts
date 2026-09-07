import type { BrowserAnalyticsBatch, BrowserAnalyticsEvent, ResolvedConfig } from './types';
import { SDK_VERSION } from './otlp';

export const MAX_ANALYTICS_BODY_BYTES = 65_536;

export class BrowserAnalyticsTransport {
  private readonly config: ResolvedConfig;
  private queue: Array<{ event: BrowserAnalyticsEvent; resolve: (ok: boolean) => void }> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = false;
  private destroyed = false;
  private activeRequest: Promise<void> | undefined;
  private readonly onPageHide = () => { void this.flush(); };
  private readonly onVisibility = () => { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') void this.flush(); };

  constructor(config: ResolvedConfig) {
    this.config = config;
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onPageHide);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }

  async send(event: BrowserAnalyticsEvent): Promise<boolean> {
    if (!this.config.enabled || this.destroyed) return Promise.resolve(false);
    let encoded: string;
    try { encoded = JSON.stringify(event); } catch { return Promise.resolve(false); }
    if (new TextEncoder().encode(encoded).byteLength > MAX_ANALYTICS_BODY_BYTES) return Promise.resolve(false);
    if (this.queue.length >= 100) return Promise.resolve(false);
    const result = new Promise<boolean>((resolve) => this.queue.push({ event, resolve }));
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 100);
    return result;
  }

  async flush(): Promise<void> {
    if (this.inFlight) {
      await this.activeRequest;
      return;
    }
    if (this.queue.length === 0) return;
    this.inFlight = true;
    const work = this.flushOneBatch();
    this.activeRequest = work;
    try {
      await work;
    } finally {
      if (this.activeRequest === work) this.activeRequest = undefined;
      this.inFlight = false;
    }
    if (this.queue.length && !this.destroyed) void this.flush();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    void this.drainAfterDestroy();
  }

  private async flushOneBatch(): Promise<void> {
    const candidate = this.queue.slice(0, Math.min(20, this.queue.length));
    const payload = this.makePayload(candidate);
    const batch = this.queue.splice(0, payload.sentCount);
    const ok = await this.requestWithRetry(payload.body);
    batch.forEach((item) => item.resolve(ok));
  }

  private async drainAfterDestroy(): Promise<void> {
    while (this.inFlight || this.queue.length > 0) await this.flush();
  }

  private makePayload(batch: Array<{ event: BrowserAnalyticsEvent }>): { body: string; sentCount: number } {
    const events = batch.map((item) => item.event);
    let count = events.length;
    while (count > 0) {
      const wrapped = JSON.stringify({ events: events.slice(0, count) } satisfies BrowserAnalyticsBatch);
      if (new TextEncoder().encode(wrapped).byteLength <= MAX_ANALYTICS_BODY_BYTES) return { body: wrapped, sentCount: count };
      count--;
    }
    return { body: JSON.stringify(events[0]), sentCount: 1 };
  }

  private async requestWithRetry(body: string): Promise<boolean> {
    let delay = 250;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const response = await fetch(`${this.config.endpoint.replace(/\/$/, '')}/v1/analytics/browser/events`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': this.config.apiKey, 'X-SDK': '@tracekit/browser', 'X-SDK-Version': SDK_VERSION },
          body, keepalive: true,
        });
        if (response.ok) return true;
        if (![408, 425, 429].includes(response.status) && (response.status < 500 || response.status > 599)) return false;
        if (attempt === 4) return false;
        const retryAfter = response.headers.get('Retry-After');
        let selected = delay;
        if (retryAfter) {
          const seconds = Number(retryAfter);
          const dateDelay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
          if (Number.isFinite(dateDelay)) selected = Math.max(selected, dateDelay);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(2000, Math.max(0, selected))));
        delay *= 2;
      } catch {
        if (attempt === 4) return false;
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(2000, delay)));
        delay *= 2;
      }
    }
    return false;
  }
}
