/**
 * TraceKit Browser SDK - XHR Integration
 * @package @tracekit/browser
 *
 * Monkey-patches XMLHttpRequest.prototype.open and .send to:
 * 1. Add HTTP breadcrumbs (method, URL, status, duration)
 * 2. Inject W3C traceparent header for distributed tracing
 *
 * Traceparent is only injected for same-origin requests (default)
 * or requests matching configured tracePropagationTargets.
 * Requests to the TraceKit endpoint are skipped to avoid recursion.
 */

import type { BrowserClient } from '../client';
import { generateTraceId, generateSpanId } from '../id';

// Expando properties for storing method/url on XHR instances
interface TracekitXHR extends XMLHttpRequest {
  __tracekit_method?: string;
  __tracekit_url?: string;
}

/**
 * Install XHR instrumentation for breadcrumbs and traceparent injection.
 *
 * @returns Teardown function that restores original XHR prototype methods.
 */
export function instrumentXHR(client: BrowserClient): () => void {
  if (typeof XMLHttpRequest === 'undefined') {
    return () => {};
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const config = client.getConfig();

  // Patch open to capture method and URL
  XMLHttpRequest.prototype.open = function (
    this: TracekitXHR,
    method: string,
    url: string | URL,
    ...args: unknown[]
  ): void {
    this.__tracekit_method = method;
    this.__tracekit_url = typeof url === 'string' ? url : url.href;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (origOpen as any).apply(this, [method, url, ...args]);
  };

  // Patch send to inject traceparent and capture breadcrumbs
  XMLHttpRequest.prototype.send = function (
    this: TracekitXHR,
    body?: Document | XMLHttpRequestBodyInit | null,
  ): void {
    const method = this.__tracekit_method || 'GET';
    const url = this.__tracekit_url || '';

    // Skip instrumentation for TraceKit's own endpoint (avoid recursion)
    if (url.startsWith(config.endpoint)) {
      return origSend.apply(this, [body]);
    }

    const startTime = Date.now();
    let traceparentValue: string | undefined;

    // Traceparent injection
    if (client.shouldInjectTraceparent(url)) {
      const traceId = generateTraceId();
      const spanId = generateSpanId();
      const traceparent = `00-${traceId}-${spanId}-01`;
      traceparentValue = traceparent;
      try {
        this.setRequestHeader('traceparent', traceparent);
      } catch {
        // setRequestHeader can throw if state is not OPENED -- silently ignore
      }
    }

    // Save and chain existing onreadystatechange
    const existingHandler = this.onreadystatechange;

    this.onreadystatechange = function (
      this: XMLHttpRequest,
      ev: Event,
    ): void {
      if (this.readyState === 4) {
        const statusOk = this.status >= 200 && this.status < 400;
        client.getScope().addBreadcrumb({
          type: 'http',
          category: 'xhr',
          message: `${method} ${url}`,
          level: statusOk ? 'info' : 'warning',
          data: {
            method,
            url,
            status_code: this.status,
            duration: Date.now() - startTime,
            traceparent: traceparentValue,
          },
        });
      }

      // Call the existing handler if any
      if (existingHandler) {
        existingHandler.call(this, ev);
      }
    };

    // Capture network errors
    const existingOnerror = this.onerror;
    this.onerror = function (
      this: XMLHttpRequest,
      ev: ProgressEvent,
    ): void {
      client.getScope().addBreadcrumb({
        type: 'http',
        category: 'xhr',
        message: `${method} ${url}`,
        level: 'error',
        data: {
          method,
          url,
          error: 'Network error',
          duration: Date.now() - startTime,
          traceparent: traceparentValue,
        },
      });

      if (existingOnerror) {
        existingOnerror.call(this, ev);
      }
    };

    return origSend.apply(this, [body]);
  };

  // Teardown: restore original prototype methods
  return () => {
    XMLHttpRequest.prototype.open = origOpen;
    XMLHttpRequest.prototype.send = origSend;
  };
}
