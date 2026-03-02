/**
 * TraceKit Browser SDK
 * @package @tracekit/browser
 *
 * Public API entry point. Provides a Sentry-familiar function-based API
 * backed by a module-level BrowserClient singleton.
 *
 * Usage:
 *   import { init, captureException, captureMessage } from '@tracekit/browser';
 *   init({ apiKey: 'your-key' });
 *   captureException(new Error('Something went wrong'));
 */

import type {
  TracekitBrowserConfig,
  SeverityLevel,
  UserContext,
} from './types';
import { resolveConfig } from './config';
import { BrowserClient } from './client';

// ============================================================================
// Module-level singleton
// ============================================================================

let client: BrowserClient | null = null;

// ============================================================================
// Public API Functions
// ============================================================================

/**
 * Initialize the TraceKit Browser SDK.
 *
 * Creates a BrowserClient singleton and installs it (sets up unload handlers,
 * collects debug IDs). If called again, the previous client is destroyed first.
 */
export function init(config: TracekitBrowserConfig): void {
  if (client) {
    console.warn(
      '[TraceKit] SDK already initialized. Destroying previous instance.',
    );
    client.destroy();
    client = null;
  }

  const resolved = resolveConfig(config);
  client = new BrowserClient(resolved);
  client.install();
}

/**
 * Capture an Error and send it to TraceKit.
 *
 * @returns The generated event ID, or empty string if dropped or not initialized.
 */
export function captureException(
  error: Error,
  context?: Record<string, unknown>,
): string {
  if (!client) {
    console.warn(
      '[TraceKit] SDK not initialized. Call init() before captureException().',
    );
    return '';
  }
  return client.captureException(error, context);
}

/**
 * Capture a plain text message and send it to TraceKit.
 *
 * @returns The generated event ID, or empty string if dropped or not initialized.
 */
export function captureMessage(
  message: string,
  level?: SeverityLevel,
): string {
  if (!client) {
    console.warn(
      '[TraceKit] SDK not initialized. Call init() before captureMessage().',
    );
    return '';
  }
  return client.captureMessage(message, level);
}

/**
 * Set or clear the current user context.
 * User context is attached to all subsequent events.
 */
export function setUser(user: UserContext | null): void {
  if (!client) {
    console.warn(
      '[TraceKit] SDK not initialized. Call init() before setUser().',
    );
    return;
  }
  client.setUser(user);
}

/**
 * Set a tag key-value pair.
 * Tags are attached to all subsequent events.
 */
export function setTag(key: string, value: string): void {
  if (!client) {
    console.warn(
      '[TraceKit] SDK not initialized. Call init() before setTag().',
    );
    return;
  }
  client.setTag(key, value);
}

/**
 * Set an extra key-value pair.
 * Extras are attached to all subsequent events.
 */
export function setExtra(key: string, value: unknown): void {
  if (!client) {
    console.warn(
      '[TraceKit] SDK not initialized. Call init() before setExtra().',
    );
    return;
  }
  client.setExtra(key, value);
}

/**
 * Add a breadcrumb to the rolling buffer.
 * Breadcrumbs are attached to all subsequent events.
 */
export function addBreadcrumb(crumb: {
  category: string;
  message?: string;
  data?: Record<string, unknown>;
  level?: SeverityLevel;
}): void {
  if (!client) {
    console.warn(
      '[TraceKit] SDK not initialized. Call init() before addBreadcrumb().',
    );
    return;
  }
  client.addBreadcrumb({
    type: crumb.level ? 'user' : 'user',
    category: crumb.category,
    message: crumb.message,
    data: crumb.data,
    level: crumb.level || 'info',
  });
}

/**
 * Get the current BrowserClient instance for advanced usage.
 * Returns null if the SDK has not been initialized.
 */
export function getClient(): BrowserClient | null {
  return client;
}

// ============================================================================
// Re-exports: Types and key internals for advanced consumers
// ============================================================================

export type {
  TracekitBrowserConfig,
  BrowserEvent,
  Breadcrumb,
  UserContext,
  SeverityLevel,
  StackFrame,
  ResolvedConfig,
  OTLPPayload,
  Integration,
} from './types';

export { BrowserClient } from './client';
export { BrowserTransport } from './transport';
export { OfflineBuffer } from './offline';
export { Scope } from './scope';
export { Deduplicator } from './dedup';
export { eventToOTLP, SDK_VERSION } from './otlp';
export { collectDebugIds, getDebugIdForFile } from './debug-id';
export { generateTraceId, generateSpanId } from './id';
export { resolveConfig } from './config';
