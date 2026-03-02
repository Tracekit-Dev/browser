/**
 * TraceKit Browser SDK - Global Error Integration
 * @package @tracekit/browser
 *
 * Captures uncaught JavaScript errors via window.addEventListener('error')
 * and unhandled promise rejections via 'unhandledrejection'.
 * Sends captured errors to the BrowserClient as OTLP spans.
 *
 * Cross-origin "Script error." events without stack traces are detected
 * and dropped (these occur when scripts loaded without CORS headers throw).
 */

import type { BrowserClient } from '../client';

/**
 * Install global error and unhandled rejection handlers.
 *
 * @returns Teardown function that removes all installed listeners.
 */
export function instrumentGlobalErrors(client: BrowserClient): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const config = client.getConfig();

  const errorHandler = (event: ErrorEvent): void => {
    // Cross-origin script errors without CORS produce "Script error."
    // with no useful stack info. Drop them.
    if (event.message === 'Script error.' && !event.error) {
      if (config.debug) {
        console.debug(
          '[TraceKit] Ignoring cross-origin "Script error." (no CORS headers on script)',
        );
      }
      return;
    }

    // Extract or construct the Error object
    let error: Error;
    if (event.error instanceof Error) {
      error = event.error;
    } else {
      error = new Error(event.message || 'Unknown error');
    }

    // Mark as unhandled (uncaught)
    client.captureException(error, { handled: false });

    // Do NOT call event.preventDefault() -- allow other error handlers to fire
  };

  const rejectionHandler = (event: PromiseRejectionEvent): void => {
    const reason = event.reason;

    if (reason instanceof Error) {
      client.captureException(reason, { handled: false });
    } else if (typeof reason === 'string') {
      client.captureMessage(reason, 'error');
    } else {
      client.captureMessage(String(reason), 'error');
    }
  };

  window.addEventListener('error', errorHandler);
  window.addEventListener('unhandledrejection', rejectionHandler);

  // Teardown: remove both listeners
  return () => {
    window.removeEventListener('error', errorHandler);
    window.removeEventListener('unhandledrejection', rejectionHandler);
  };
}
