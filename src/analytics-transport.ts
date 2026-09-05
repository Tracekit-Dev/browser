import type { BrowserAnalyticsEvent, ResolvedConfig } from './types';
import { SDK_VERSION } from './otlp';

export const MAX_ANALYTICS_BODY_BYTES = 65_536;

/** Sends one immutable browser analytics event. Batch and retry belong to Phase 175. */
export class BrowserAnalyticsTransport {
  private readonly config: ResolvedConfig;

  constructor(config: ResolvedConfig) {
    this.config = config;
  }

  async send(event: BrowserAnalyticsEvent): Promise<boolean> {
    if (!this.config.enabled) return false;
    let body: string;
    try {
      body = JSON.stringify(event);
    } catch {
      return false;
    }
    const bytes = new TextEncoder().encode(body).byteLength;
    if (bytes > MAX_ANALYTICS_BODY_BYTES) return false;
    try {
      const response = await fetch(`${this.config.endpoint.replace(/\/$/, '')}/v1/analytics/browser/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
          'X-SDK': '@tracekit/browser',
          'X-SDK-Version': SDK_VERSION,
        },
        body,
        keepalive: true,
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
