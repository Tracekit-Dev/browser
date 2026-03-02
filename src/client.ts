/**
 * TraceKit Browser SDK - BrowserClient Orchestrator
 * @package @tracekit/browser
 *
 * Central singleton that wires together scope, transport, dedup,
 * and OTLP conversion into a cohesive error capture pipeline.
 *
 * Flow: captureException/captureMessage -> enabled/sampleRate checks ->
 * build BrowserEvent -> dedup check -> beforeSend hook -> eventToOTLP ->
 * transport.send
 */

import type {
  ResolvedConfig,
  BrowserEvent,
  SeverityLevel,
  UserContext,
  Breadcrumb,
} from './types';
import { Scope } from './scope';
import { BrowserTransport } from './transport';
import { Deduplicator } from './dedup';
import { eventToOTLP } from './otlp';
import { collectDebugIds, getDebugIdForFile } from './debug-id';
import { instrumentGlobalErrors } from './integrations/global-error';
import { instrumentConsole } from './integrations/console';
import { instrumentFetch } from './integrations/fetch';
import { instrumentXHR } from './integrations/xhr';
import { instrumentDOM } from './integrations/dom';
import { instrumentNavigation } from './integrations/navigation';

export class BrowserClient {
  private config: ResolvedConfig;
  private scope: Scope;
  private transport: BrowserTransport;
  private dedup: Deduplicator;
  private installed: boolean = false;
  private teardownFns: (() => void)[] = [];

  constructor(config: ResolvedConfig) {
    this.config = config;
    this.scope = new Scope(config.maxBreadcrumbs, config.beforeSend);
    this.transport = new BrowserTransport(config);
    this.dedup = new Deduplicator();
  }

  /**
   * Install the client: set up transport unload handlers, collect debug IDs.
   * Must be called after construction.
   */
  install(): void {
    if (this.installed) {
      return;
    }

    this.transport.setupUnloadHandlers();
    collectDebugIds();

    // Install integrations in order:
    // 1. Global error first (captures errors from other integrations installing)
    // 2. Console (breadcrumbs for SDK logging)
    // 3. Fetch/XHR (HTTP instrumentation)
    // 4. DOM/Navigation (UI breadcrumbs)
    const { integrations } = this.config;

    if (integrations.globalError) {
      this.teardownFns.push(instrumentGlobalErrors(this));
    }
    if (integrations.console) {
      this.teardownFns.push(instrumentConsole(this));
    }
    if (integrations.fetch) {
      this.teardownFns.push(instrumentFetch(this));
    }
    if (integrations.xhr) {
      this.teardownFns.push(instrumentXHR(this));
    }
    if (integrations.dom) {
      this.teardownFns.push(instrumentDOM(this));
    }
    if (integrations.navigation) {
      this.teardownFns.push(instrumentNavigation(this));
    }

    // Install external addon integrations
    for (const addon of this.config.addons) {
      try {
        addon.install(this);
        if (addon.teardown) {
          this.teardownFns.push(() => addon.teardown!());
        }
      } catch (err) {
        if (this.config.debug) {
          console.error(`[TraceKit] Failed to install addon "${addon.name}":`, err);
        }
      }
    }

    this.installed = true;

    if (this.config.debug) {
      console.log('[TraceKit] Browser SDK initialized');
    }
  }

  /**
   * Capture an Error object, convert it to an OTLP payload, and send it.
   *
   * Returns the generated event ID (spanId), or an empty string if the
   * event was dropped (disabled, sampled out, deduplicated, or filtered).
   */
  captureException(
    error: Error,
    context?: Record<string, unknown> & { handled?: boolean },
  ): string {
    if (!this.config.enabled) {
      return '';
    }

    // Sample rate check
    if (Math.random() >= this.config.sampleRate) {
      return '';
    }

    // Build BrowserEvent from Error
    const event: BrowserEvent = {
      type: error.name || 'Error',
      message: error.message,
      stackTrace: error.stack,
      frames: this.parseStackFrames(error.stack),
      level: 'error',
      timestamp: Date.now(),
      handled: context?.handled ?? true,
    };

    // Look up debug ID from first stack frame's filename
    if (event.frames && event.frames.length > 0) {
      const firstFrame = event.frames[0];
      if (firstFrame.filename) {
        event.debugId = getDebugIdForFile(firstFrame.filename);
      }
    }

    // Dedup check
    if (this.dedup.isDuplicate(event)) {
      return '';
    }

    // beforeSend hook
    const processed = this.scope.applyBeforeSend(event);
    if (processed === null) {
      return '';
    }

    // Apply context extras temporarily
    if (context) {
      const { handled, ...extras } = context;
      for (const [key, value] of Object.entries(extras)) {
        this.scope.setExtra(key, value);
      }
    }

    // Convert to OTLP
    const otlpPayload = eventToOTLP(processed, this.scope, this.config);

    // Extract spanId as the event ID
    const eventId =
      otlpPayload.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.spanId ?? '';

    // Send via transport (fire and forget)
    this.transport.send(otlpPayload).catch(() => {
      // Silently ignore -- SDK should never crash the app
    });

    // Remove temporary context extras
    if (context) {
      const { handled, ...extras } = context;
      for (const key of Object.keys(extras)) {
        // Clear by setting to undefined -- scope stores as Record
        this.scope.setExtra(key, undefined as unknown);
      }
    }

    return eventId;
  }

  /**
   * Capture a plain text message as an event.
   *
   * Returns the generated event ID, or empty string if dropped.
   */
  captureMessage(message: string, level?: SeverityLevel): string {
    if (!this.config.enabled) {
      return '';
    }

    // Sample rate check
    if (Math.random() >= this.config.sampleRate) {
      return '';
    }

    // Build BrowserEvent
    const event: BrowserEvent = {
      type: 'Message',
      message,
      level: level || 'info',
      timestamp: Date.now(),
      handled: true,
    };

    // Dedup check
    if (this.dedup.isDuplicate(event)) {
      return '';
    }

    // beforeSend hook
    const processed = this.scope.applyBeforeSend(event);
    if (processed === null) {
      return '';
    }

    // Convert to OTLP
    const otlpPayload = eventToOTLP(processed, this.scope, this.config);

    // Extract spanId as the event ID
    const eventId =
      otlpPayload.resourceSpans[0]?.scopeSpans[0]?.spans[0]?.spanId ?? '';

    // Send via transport (fire and forget)
    this.transport.send(otlpPayload).catch(() => {
      // Silently ignore
    });

    return eventId;
  }

  /**
   * Set or clear the current user context.
   */
  setUser(user: UserContext | null): void {
    this.scope.setUser(user);
  }

  /**
   * Set a tag key-value pair (attached to all events).
   */
  setTag(key: string, value: string): void {
    this.scope.setTag(key, value);
  }

  /**
   * Set an extra key-value pair (attached to all events).
   */
  setExtra(key: string, value: unknown): void {
    this.scope.setExtra(key, value);
  }

  /**
   * Add a breadcrumb to the scope's rolling buffer.
   */
  addBreadcrumb(crumb: Omit<Breadcrumb, 'timestamp'>): void {
    this.scope.addBreadcrumb(crumb);
  }

  /**
   * Check if a URL should have the traceparent header injected.
   *
   * If tracePropagationTargets is empty, checks same-origin.
   * If targets are provided, checks if URL matches any string (startsWith) or RegExp.
   */
  shouldInjectTraceparent(url: string): boolean {
    const targets = this.config.tracePropagationTargets;

    if (targets.length === 0) {
      // Same-origin check
      if (typeof window === 'undefined' || !window.location) {
        return false;
      }
      try {
        const parsedUrl = new URL(url, window.location.origin);
        return parsedUrl.origin === window.location.origin;
      } catch {
        return false;
      }
    }

    return targets.some((target) => {
      if (typeof target === 'string') {
        return url.startsWith(target);
      }
      if (target instanceof RegExp) {
        return target.test(url);
      }
      return false;
    });
  }

  /**
   * Get the scope instance (for integrations to add breadcrumbs).
   */
  getScope(): Scope {
    return this.scope;
  }

  /**
   * Get the resolved configuration.
   */
  getConfig(): ResolvedConfig {
    return this.config;
  }

  /**
   * Register a teardown function (called on destroy).
   */
  addTeardown(fn: () => void): void {
    this.teardownFns.push(fn);
  }

  /**
   * Destroy the client: run teardown functions, destroy transport, clear scope.
   */
  destroy(): void {
    for (const fn of this.teardownFns) {
      try {
        fn();
      } catch {
        // Ignore teardown errors
      }
    }
    this.teardownFns = [];
    this.transport.destroy();
    this.scope.clear();
    this.installed = false;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  /**
   * Parse stack frames from an Error.stack string.
   *
   * Supports two common formats:
   * - V8/Chrome: "    at functionName (filename:line:col)"
   * - Firefox/Safari: "functionName@filename:line:col"
   */
  private parseStackFrames(
    stack: string | undefined,
  ): import('./types').StackFrame[] | undefined {
    if (!stack) {
      return undefined;
    }

    const frames: import('./types').StackFrame[] = [];
    const lines = stack.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // V8 format: "at functionName (filename:line:col)"
      // Also handles: "at filename:line:col" (anonymous)
      const v8Match = trimmed.match(
        /^at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/,
      );
      if (v8Match) {
        frames.push({
          function: v8Match[1] || '<anonymous>',
          filename: v8Match[2],
          lineno: parseInt(v8Match[3], 10),
          colno: parseInt(v8Match[4], 10),
        });
        continue;
      }

      // Firefox/Safari format: "functionName@filename:line:col"
      const ffMatch = trimmed.match(/^(.+?)@(.+?):(\d+):(\d+)$/);
      if (ffMatch) {
        frames.push({
          function: ffMatch[1] || '<anonymous>',
          filename: ffMatch[2],
          lineno: parseInt(ffMatch[3], 10),
          colno: parseInt(ffMatch[4], 10),
        });
        continue;
      }
    }

    return frames.length > 0 ? frames : undefined;
  }
}
