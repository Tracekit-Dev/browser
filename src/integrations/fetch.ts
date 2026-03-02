/**
 * TraceKit Browser SDK - Fetch Integration
 * @package @tracekit/browser
 *
 * Monkey-patches window.fetch to:
 * 1. Add HTTP breadcrumbs (method, URL, status, duration)
 * 2. Inject W3C traceparent header for distributed tracing
 *
 * Traceparent is only injected for same-origin requests (default)
 * or requests matching configured tracePropagationTargets.
 * Requests to the TraceKit endpoint are skipped to avoid recursion.
 */

import type { BrowserClient } from '../client';
import { generateTraceId, generateSpanId } from '../id';

/**
 * Install fetch instrumentation for breadcrumbs and traceparent injection.
 *
 * @returns Teardown function that restores the original fetch.
 */
export function instrumentFetch(client: BrowserClient): () => void {
  if (
    typeof window === 'undefined' ||
    typeof window.fetch === 'undefined'
  ) {
    return () => {};
  }

  const originalFetch = window.fetch;
  const config = client.getConfig();

  window.fetch = function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    // Extract URL string from various input types
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else if (input instanceof Request) {
      url = input.url;
    } else {
      url = String(input);
    }

    // Extract HTTP method
    const method =
      init?.method ||
      (input instanceof Request ? input.method : 'GET');

    // Skip instrumentation for TraceKit's own endpoint (avoid recursion)
    if (url.startsWith(config.endpoint)) {
      return originalFetch.call(window, input, init);
    }

    const startTime = Date.now();

    // Traceparent injection
    let modifiedInput: RequestInfo | URL = input;
    let modifiedInit: RequestInit | undefined = init;
    let traceparentValue: string | undefined;

    if (client.shouldInjectTraceparent(url)) {
      const traceId = generateTraceId();
      const spanId = generateSpanId();
      const traceparent = `00-${traceId}-${spanId}-01`;
      traceparentValue = traceparent;

      // Build headers, preserving existing ones
      const existingHeaders = new Headers(
        init?.headers || (input instanceof Request ? input.headers : undefined),
      );

      // Only inject if not already present
      if (!existingHeaders.has('traceparent')) {
        existingHeaders.set('traceparent', traceparent);

        if (input instanceof Request) {
          // Clone Request with updated headers
          modifiedInput = new Request(input, { headers: existingHeaders });
          modifiedInit = init;
        } else {
          // Update init with new headers
          modifiedInit = { ...init, headers: existingHeaders };
        }
      }
    }

    return originalFetch
      .call(window, modifiedInput, modifiedInit)
      .then((response: Response) => {
        // Success breadcrumb
        client.getScope().addBreadcrumb({
          type: 'http',
          category: 'fetch',
          message: `${method} ${url}`,
          level: response.ok ? 'info' : 'warning',
          data: {
            method,
            url,
            status_code: response.status,
            duration: Date.now() - startTime,
            traceparent: traceparentValue,
          },
        });
        return response;
      })
      .catch((error: Error) => {
        // Network error breadcrumb
        client.getScope().addBreadcrumb({
          type: 'http',
          category: 'fetch',
          message: `${method} ${url}`,
          level: 'error',
          data: {
            method,
            url,
            error: error.message,
            duration: Date.now() - startTime,
            traceparent: traceparentValue,
          },
        });
        throw error;
      });
  };

  // Teardown: restore original fetch
  return () => {
    window.fetch = originalFetch;
  };
}
