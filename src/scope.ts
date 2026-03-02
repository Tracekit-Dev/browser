/**
 * TraceKit Browser SDK - Scope Management
 * @package @tracekit/browser
 *
 * Stores user context, tags, extras, and breadcrumbs that are
 * attached to every outgoing event. Breadcrumbs are kept in a
 * rolling buffer (oldest dropped when capacity exceeded).
 */

import type { UserContext, Breadcrumb, BrowserEvent } from './types';

export class Scope {
  private user: UserContext | null = null;
  private tags: Record<string, string> = {};
  private extras: Record<string, unknown> = {};
  private breadcrumbs: Breadcrumb[] = [];
  private maxBreadcrumbs: number;
  private beforeSend: ((event: BrowserEvent) => BrowserEvent | null) | null;
  private breadcrumbListener: ((crumb: Breadcrumb) => void) | null = null;

  constructor(
    maxBreadcrumbs: number = 100,
    beforeSend?: ((event: BrowserEvent) => BrowserEvent | null) | null,
  ) {
    this.maxBreadcrumbs = maxBreadcrumbs;
    this.beforeSend = beforeSend ?? null;
  }

  /**
   * Set or clear the current user context.
   */
  setUser(user: UserContext | null): void {
    this.user = user;
  }

  /**
   * Get a copy of the current user context.
   */
  getUser(): UserContext | null {
    return this.user ? { ...this.user } : null;
  }

  /**
   * Set a tag key-value pair (attached to all events).
   */
  setTag(key: string, value: string): void {
    this.tags[key] = value;
  }

  /**
   * Get a copy of all tags.
   */
  getTags(): Record<string, string> {
    return { ...this.tags };
  }

  /**
   * Set an extra key-value pair (attached to all events).
   */
  setExtra(key: string, value: unknown): void {
    this.extras[key] = value;
  }

  /**
   * Get a copy of all extras.
   */
  getExtras(): Record<string, unknown> {
    return { ...this.extras };
  }

  /**
   * Register a listener that is called for every breadcrumb added.
   * Used by @tracekit/replay to bridge breadcrumbs into rrweb custom events.
   */
  onBreadcrumb(listener: (crumb: Breadcrumb) => void): void {
    this.breadcrumbListener = listener;
  }

  /**
   * Add a breadcrumb to the rolling buffer.
   * Automatically adds a timestamp. If the buffer exceeds
   * maxBreadcrumbs, the oldest entry is dropped.
   */
  addBreadcrumb(crumb: Omit<Breadcrumb, 'timestamp'>): void {
    const breadcrumb: Breadcrumb = {
      ...crumb,
      timestamp: Date.now(),
    };

    this.breadcrumbs.push(breadcrumb);

    if (this.breadcrumbs.length > this.maxBreadcrumbs) {
      this.breadcrumbs.shift();
    }

    // Notify listener (e.g., replay integration for rrweb custom events)
    try {
      this.breadcrumbListener?.(breadcrumb);
    } catch {
      // Never crash the host app due to listener errors
    }
  }

  /**
   * Get a copy of all breadcrumbs.
   */
  getBreadcrumbs(): Breadcrumb[] {
    return [...this.breadcrumbs];
  }

  /**
   * Apply the beforeSend hook to an event.
   * If beforeSend returns null, the event is dropped.
   * If beforeSend throws, the event is returned unchanged
   * and a warning is logged to console.
   */
  applyBeforeSend(event: BrowserEvent): BrowserEvent | null {
    if (!this.beforeSend) {
      return event;
    }

    try {
      return this.beforeSend(event);
    } catch (err) {
      console.warn('[TraceKit] beforeSend threw an error, event will be sent unchanged:', err);
      return event;
    }
  }

  /**
   * Reset all scope data.
   */
  clear(): void {
    this.user = null;
    this.tags = {};
    this.extras = {};
    this.breadcrumbs = [];
  }
}
