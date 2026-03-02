/**
 * TraceKit Browser SDK - DOM Click Integration
 * @package @tracekit/browser
 *
 * Captures click events as breadcrumbs, recording the target element's
 * tag name, ID, class, and text content. Uses capture phase to see
 * all clicks even if stopPropagation is called. Includes debounce
 * to avoid rapid-fire click breadcrumbs on the same element.
 */

import type { BrowserClient } from '../client';

/**
 * Install DOM click breadcrumb capture.
 *
 * Uses capture phase (`{ capture: true }`) to intercept all clicks
 * regardless of event propagation behavior in application code.
 *
 * @returns Teardown function that removes the click listener.
 */
export function instrumentDOM(client: BrowserClient): () => void {
  if (typeof document === 'undefined') {
    return () => {};
  }

  let lastTarget: EventTarget | null = null;
  let lastClickTime = 0;
  const DEBOUNCE_MS = 300;

  const clickHandler = (event: Event): void => {
    const target = event.target;
    if (!target || !(target instanceof Element)) {
      return;
    }

    // Debounce: skip if same element clicked within 300ms
    const now = Date.now();
    if (target === lastTarget && now - lastClickTime < DEBOUNCE_MS) {
      return;
    }
    lastTarget = target;
    lastClickTime = now;

    // Extract element info
    const tagName = target.tagName.toLowerCase();
    const id = target.id || undefined;
    const className =
      typeof target.className === 'string' && target.className
        ? target.className.slice(0, 100)
        : undefined;
    const textContent =
      target.textContent ? target.textContent.trim().slice(0, 50) : undefined;

    // Build message: tag#id.class "text"
    let message = tagName;
    if (id) {
      message += `#${id}`;
    }
    if (className) {
      // Use first class name for the message
      const firstClass = className.split(' ')[0];
      if (firstClass) {
        message += `.${firstClass}`;
      }
    }
    if (textContent) {
      message += ` "${textContent}"`;
    }

    const data: Record<string, unknown> = { tagName };
    if (id) data.id = id;
    if (className) data.className = className;

    client.getScope().addBreadcrumb({
      type: 'ui',
      category: 'ui.click',
      message,
      level: 'info',
      data,
    });
  };

  document.addEventListener('click', clickHandler, { capture: true });

  // Teardown: remove click listener
  return () => {
    document.removeEventListener('click', clickHandler, { capture: true });
  };
}
