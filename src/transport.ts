/**
 * TraceKit Browser SDK - Transport Layer
 * @package @tracekit/browser
 *
 * Handles HTTP delivery of OTLP JSON payloads to the TraceKit server.
 * Features:
 * - Fetch-based POST to /v1/traces with correct headers
 * - Exponential backoff retry (1s, 2s, 4s, 8s, 16s) on 5xx/429/network errors
 * - Token bucket rate limiter (30 events/min)
 * - Offline buffer with automatic flush on reconnection
 * - sendBeacon on page unload (visibilitychange + pagehide)
 *
 * SSR-safe: all DOM/window/document access is guarded.
 */

import type { ResolvedConfig, OTLPPayload } from './types';
import { SDK_VERSION } from './otlp';
import { OfflineBuffer } from './offline';

// ============================================================================
// Rate Limiter (Token Bucket)
// ============================================================================

/**
 * Simple token bucket rate limiter.
 * 30 tokens max, refills at 1 token per 2 seconds (= 30/min).
 */
class TokenBucketRateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillIntervalMs: number;
  private lastRefillTime: number;

  constructor(maxTokens: number = 30, refillIntervalMs: number = 2000) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillIntervalMs = refillIntervalMs;
    this.lastRefillTime = Date.now();
  }

  /**
   * Try to consume one token. Returns true if allowed, false if rate limited.
   */
  tryConsume(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    const tokensToAdd = Math.floor(elapsed / this.refillIntervalMs);

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefillTime = now;
    }
  }
}

// ============================================================================
// Browser Transport
// ============================================================================

/** Maximum number of retry attempts before dropping the event. */
const MAX_RETRY_ATTEMPTS = 5;

/** Maximum backoff duration in milliseconds (30s). */
const MAX_BACKOFF_MS = 30_000;

export class BrowserTransport {
  private config: ResolvedConfig;
  private offlineBuffer: OfflineBuffer;
  private rateLimiter: TokenBucketRateLimiter;
  private pendingBeacon: string | null = null;

  private boundOnVisibilityChange: (() => void) | null = null;
  private boundOnPageHide: (() => void) | null = null;

  constructor(config: ResolvedConfig) {
    this.config = config;
    this.offlineBuffer = new OfflineBuffer();
    this.rateLimiter = new TokenBucketRateLimiter();

    // Wire up offline buffer's online callback to flush queued events
    this.offlineBuffer.setOnOnlineCallback(() => {
      this.flushOfflineBuffer();
    });
  }

  /**
   * Send an OTLP payload to the server.
   *
   * 1. Rate limiter check (silently drop if exceeded)
   * 2. Serialize to JSON
   * 3. If offline, queue in buffer
   * 4. Otherwise, send with retry
   */
  async send(payload: OTLPPayload): Promise<boolean> {
    // Check rate limiter
    if (!this.rateLimiter.tryConsume()) {
      return false;
    }

    const jsonString = JSON.stringify(payload);

    // Check offline status
    if (this.offlineBuffer.isOffline()) {
      this.offlineBuffer.add(jsonString);
      return true;
    }

    return this.sendWithRetry(jsonString);
  }

  /**
   * Set up visibilitychange and pagehide listeners for sendBeacon flush.
   * Does NOT use beforeunload (breaks bfcache per research).
   */
  setupUnloadHandlers(): void {
    if (typeof document !== 'undefined') {
      this.boundOnVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
          this.flushViaSendBeacon();
        }
      };
      document.addEventListener(
        'visibilitychange',
        this.boundOnVisibilityChange,
      );
    }

    if (typeof window !== 'undefined') {
      this.boundOnPageHide = () => {
        this.flushViaSendBeacon();
      };
      window.addEventListener('pagehide', this.boundOnPageHide);
    }
  }

  /**
   * Drain offline buffer and send each payload via sendWithRetry.
   * Called when the offline buffer's onOnline callback fires.
   */
  flushOfflineBuffer(): void {
    const items = this.offlineBuffer.drain();

    for (const body of items) {
      // Fire and forget -- don't block on retry
      this.sendWithRetry(body).catch(() => {
        // If retry fails, the event is dropped (already exhausted retries)
      });
    }
  }

  /**
   * Clean up all event listeners and the offline buffer.
   */
  destroy(): void {
    if (typeof document !== 'undefined' && this.boundOnVisibilityChange) {
      document.removeEventListener(
        'visibilitychange',
        this.boundOnVisibilityChange,
      );
    }

    if (typeof window !== 'undefined' && this.boundOnPageHide) {
      window.removeEventListener('pagehide', this.boundOnPageHide);
    }

    this.boundOnVisibilityChange = null;
    this.boundOnPageHide = null;
    this.offlineBuffer.destroy();
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  /**
   * Send a JSON body to /v1/traces with exponential backoff retry.
   *
   * Backoff schedule: 1s, 2s, 4s, 8s, 16s (capped at 30s).
   *
   * Retry on: 429, 5xx, network error (fetch throws).
   * Do NOT retry on: 4xx (except 429) -- client errors.
   * After max retries: drop the event.
   */
  private async sendWithRetry(
    body: string,
    attempt: number = 0,
  ): Promise<boolean> {
    if (attempt >= MAX_RETRY_ATTEMPTS) {
      return false;
    }

    const url = this.config.endpoint + '/v1/traces';

    try {
      const response = await fetch(url, {
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

      if (response.ok) {
        return true;
      }

      // 429 or 5xx: retry with backoff
      if (response.status === 429 || response.status >= 500) {
        const backoff = Math.min(
          1000 * Math.pow(2, attempt),
          MAX_BACKOFF_MS,
        );
        await this.sleep(backoff);
        return this.sendWithRetry(body, attempt + 1);
      }

      // 4xx (not 429): client error, do not retry
      return false;
    } catch {
      // Network error (fetch threw): queue in offline buffer
      this.offlineBuffer.add(body);
      return true;
    }
  }

  /**
   * Flush pending events via navigator.sendBeacon on page unload.
   *
   * sendBeacon cannot set custom headers, so the API key is passed
   * as a query parameter. The server must support this format.
   * Total payload is kept under 64KB per the sendBeacon spec.
   */
  private flushViaSendBeacon(): void {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') {
      return;
    }

    const url =
      this.config.endpoint +
      '/v1/traces?api_key=' +
      encodeURIComponent(this.config.apiKey);

    // Collect all pending items: offline buffer + any pending beacon payload
    const items = this.offlineBuffer.drain();
    if (this.pendingBeacon) {
      items.push(this.pendingBeacon);
      this.pendingBeacon = null;
    }

    // sendBeacon has a 64KB limit; send each item individually
    for (const body of items) {
      // Skip if over 64KB (sendBeacon will reject it anyway)
      if (body.length > 65_536) {
        continue;
      }

      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
    }
  }

  /**
   * Promise-based sleep for retry backoff.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
