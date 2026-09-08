import type { BrowserPresencePayload, ResolvedConfig } from './types';
import { SDK_VERSION } from './otlp';

export const MAX_PRESENCE_BODY_BYTES = 16_384;

const bytes = (value: string): number => new TextEncoder().encode(value).byteLength;
const validText = (value: unknown, max: number): value is string => typeof value === 'string' && bytes(value) <= max && !/[\u0000-\u001f\u007f]/.test(value);

export class BrowserPresenceTransport {
  private destroyed = false;
  constructor(private readonly config: ResolvedConfig) {}

  async send(payload: BrowserPresencePayload): Promise<boolean> {
    if (!this.config.enabled || this.destroyed || !this.valid(payload)) return false;
    try {
      const body = JSON.stringify({
        service_name: payload.service_name,
        visitor_id: payload.visitor_id,
        session_id: payload.session_id,
        tab_id: payload.tab_id,
        sequence: payload.sequence,
        visibility: payload.visibility,
        page_path: payload.page_path,
        ...(payload.landing_source !== undefined ? { landing_source: payload.landing_source } : {}),
        ...(payload.landing_referrer !== undefined ? { landing_referrer: payload.landing_referrer } : {}),
      });
      if (bytes(body) > MAX_PRESENCE_BODY_BYTES) return false;
      const response = await fetch(`${this.config.endpoint.replace(/\/$/, '')}/v1/analytics/browser/presence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': this.config.apiKey, 'X-SDK': '@tracekit/browser', 'X-SDK-Version': SDK_VERSION },
        body,
        keepalive: payload.visibility === 'hidden',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  destroy(): void { this.destroyed = true; }

  private valid(payload: BrowserPresencePayload): boolean {
    if (!validText(payload.service_name, 255) || !validText(payload.visitor_id, 255) || !validText(payload.session_id, 255) || !validText(payload.tab_id, 255) || !validText(payload.page_path, 2048)) return false;
    if (!Number.isSafeInteger(payload.sequence) || payload.sequence < 0 || !['visible', 'hidden'].includes(payload.visibility)) return false;
    if (payload.landing_source !== undefined && !validText(payload.landing_source, 255)) return false;
    if (payload.landing_referrer !== undefined && payload.landing_referrer !== '' && !validText(payload.landing_referrer, 2048)) return false;
    return true;
  }
}
