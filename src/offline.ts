/**
 * TraceKit Browser SDK - Offline Buffer
 * @package @tracekit/browser
 *
 * In-memory queue for storing serialized OTLP JSON payloads when the
 * browser is offline. Listens for online/offline events and fires a
 * callback when connectivity resumes so the transport can flush.
 *
 * SSR-safe: all DOM/window access is guarded with typeof checks.
 */

export class OfflineBuffer {
  private queue: string[] = [];
  private maxSize: number;
  private online: boolean;
  private onOnlineCallback: (() => void) | null = null;

  private boundOnOnline: (() => void) | null = null;
  private boundOnOffline: (() => void) | null = null;

  constructor(maxSize: number = 30) {
    this.maxSize = maxSize;

    // SSR safety: default to online if navigator is not available
    this.online =
      typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
        ? navigator.onLine
        : true;

    this.setupListeners();
  }

  /**
   * Register a callback that fires when connectivity resumes.
   * Used by BrowserTransport to flush the offline buffer.
   */
  setOnOnlineCallback(cb: () => void): void {
    this.onOnlineCallback = cb;
  }

  /**
   * Returns true if the browser is currently offline.
   */
  isOffline(): boolean {
    return !this.online;
  }

  /**
   * Add a serialized payload to the queue.
   * If the queue is full, the oldest item is dropped (FIFO eviction).
   * Returns true (always succeeds).
   */
  add(payload: string): boolean {
    if (this.queue.length >= this.maxSize) {
      this.queue.shift();
    }
    this.queue.push(payload);
    return true;
  }

  /**
   * Return all queued payloads and clear the queue.
   */
  drain(): string[] {
    const items = this.queue.slice();
    this.queue = [];
    return items;
  }

  /**
   * Current number of queued payloads.
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Remove event listeners. Call when destroying the transport.
   */
  destroy(): void {
    if (typeof window !== 'undefined') {
      if (this.boundOnOnline) {
        window.removeEventListener('online', this.boundOnOnline);
      }
      if (this.boundOnOffline) {
        window.removeEventListener('offline', this.boundOnOffline);
      }
    }
    this.boundOnOnline = null;
    this.boundOnOffline = null;
    this.onOnlineCallback = null;
    this.queue = [];
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private setupListeners(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.boundOnOnline = () => {
      this.online = true;
      if (this.onOnlineCallback) {
        this.onOnlineCallback();
      }
    };

    this.boundOnOffline = () => {
      this.online = false;
    };

    window.addEventListener('online', this.boundOnOnline);
    window.addEventListener('offline', this.boundOnOffline);
  }
}
