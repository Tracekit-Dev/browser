/**
 * TraceKit Browser SDK - Error Deduplication
 * @package @tracekit/browser
 *
 * Suppresses duplicate errors within a configurable time window.
 * Fingerprints errors by type + message + top 3 stack frames.
 * Periodically prunes stale entries when the map grows large.
 */

import type { BrowserEvent } from './types';

/** Maximum map size before triggering pruning on each check. */
const PRUNE_THRESHOLD = 100;

export class Deduplicator {
  private seen: Map<string, number> = new Map();
  private windowMs: number;

  constructor(windowMs: number = 5000) {
    this.windowMs = windowMs;
  }

  /**
   * Check if this event is a duplicate of a recently seen event.
   * Returns true if the same fingerprint was seen within the time window.
   * Otherwise, records the event and returns false.
   */
  isDuplicate(event: BrowserEvent): boolean {
    const now = Date.now();

    // Prune stale entries if map is getting large
    if (this.seen.size > PRUNE_THRESHOLD) {
      this.prune(now);
    }

    const fingerprint = this.computeFingerprint(event);
    const lastSeen = this.seen.get(fingerprint);

    if (lastSeen !== undefined && (now - lastSeen) < this.windowMs) {
      return true;
    }

    this.seen.set(fingerprint, now);
    return false;
  }

  /**
   * Clear all tracked fingerprints.
   */
  clear(): void {
    this.seen.clear();
  }

  /**
   * Compute a fingerprint from event type, message, and top 3 stack frames.
   */
  private computeFingerprint(event: BrowserEvent): string {
    const parts: string[] = [event.type, event.message];

    if (event.stackTrace) {
      // Extract top 3 lines from the stack trace string
      const lines = event.stackTrace
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, 3);
      parts.push(...lines);
    }

    return parts.join('\x00');
  }

  /**
   * Remove entries older than the dedup window.
   */
  private prune(now: number): void {
    for (const [fingerprint, timestamp] of this.seen) {
      if (now - timestamp >= this.windowMs) {
        this.seen.delete(fingerprint);
      }
    }
  }
}
