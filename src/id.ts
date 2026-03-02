/**
 * TraceKit Browser SDK - ID Generation
 * @package @tracekit/browser
 *
 * Generates W3C Trace Context compliant IDs:
 * - Trace ID: 32 lowercase hex chars (128 bits)
 * - Span ID: 16 lowercase hex chars (64 bits)
 *
 * Uses crypto.randomUUID() when available, falls back to
 * crypto.getRandomValues(). Targets ES2020+ browsers -- no polyfills.
 */

/**
 * Generate a 32-character lowercase hex trace ID (128 bits).
 * Attempts crypto.randomUUID() first (removes dashes), falls back
 * to crypto.getRandomValues().
 */
export function generateTraceId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '');
    }
  } catch {
    // Fall through to getRandomValues
  }

  return randomHex(16);
}

/**
 * Generate a 16-character lowercase hex span ID (64 bits).
 */
export function generateSpanId(): string {
  return randomHex(8);
}

/**
 * Generate a random hex string from N random bytes.
 */
function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
