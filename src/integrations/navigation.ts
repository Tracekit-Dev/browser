/**
 * TraceKit Browser SDK - Navigation Integration
 * @package @tracekit/browser
 *
 * Captures navigation breadcrumbs by monkey-patching history.pushState
 * and history.replaceState, and listening for popstate and hashchange
 * events. Tracks from/to URL pairs for SPA route transitions.
 */

import type { BrowserClient } from '../client';

/**
 * Install navigation breadcrumb capture.
 *
 * Patches History API methods and listens for popstate/hashchange
 * to capture all SPA navigation events as breadcrumbs.
 *
 * @returns Teardown function that restores original methods and removes listeners.
 */
export function instrumentNavigation(client: BrowserClient): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  let lastUrl = window.location.href;

  // Save original History API methods
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;

  /**
   * Add a navigation breadcrumb with from/to URLs.
   */
  function addNavigationBreadcrumb(from: string, to: string): void {
    client.getScope().addBreadcrumb({
      type: 'navigation',
      category: 'navigation',
      message: `${from} -> ${to}`,
      level: 'info',
      data: { from, to },
    });
  }

  // Patch history.pushState
  history.pushState = function (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    const from = lastUrl;
    origPushState.apply(this, [data, unused, url]);
    const to = window.location.href;
    lastUrl = to;
    addNavigationBreadcrumb(from, to);
  };

  // Patch history.replaceState
  history.replaceState = function (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ): void {
    const from = lastUrl;
    origReplaceState.apply(this, [data, unused, url]);
    const to = window.location.href;
    lastUrl = to;
    addNavigationBreadcrumb(from, to);
  };

  // Listen for popstate (browser back/forward)
  const popstateHandler = (): void => {
    const from = lastUrl;
    const to = window.location.href;
    lastUrl = to;
    addNavigationBreadcrumb(from, to);
  };

  // Listen for hashchange
  const hashchangeHandler = (event: HashChangeEvent): void => {
    const from = event.oldURL;
    const to = event.newURL;
    lastUrl = to;
    addNavigationBreadcrumb(from, to);
  };

  window.addEventListener('popstate', popstateHandler);
  window.addEventListener('hashchange', hashchangeHandler);

  // Teardown: restore original methods and remove listeners
  return () => {
    history.pushState = origPushState;
    history.replaceState = origReplaceState;
    window.removeEventListener('popstate', popstateHandler);
    window.removeEventListener('hashchange', hashchangeHandler);
  };
}
