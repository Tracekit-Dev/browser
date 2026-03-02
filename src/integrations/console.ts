/**
 * TraceKit Browser SDK - Console Integration
 * @package @tracekit/browser
 *
 * Monkey-patches console.log/info/warn/error/debug to capture
 * breadcrumbs for all console output. Uses a re-entrancy guard
 * to prevent infinite loops when the SDK itself logs to console.
 */

import type { BrowserClient } from '../client';
import type { SeverityLevel } from '../types';

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

const LEVEL_MAP: Record<ConsoleLevel, SeverityLevel> = {
  error: 'error',
  warn: 'warning',
  info: 'info',
  log: 'info',
  debug: 'debug',
};

const CONSOLE_LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

/**
 * Install console breadcrumb capture for all console levels.
 *
 * CRITICAL: The re-entrancy guard (`isRecording`) prevents infinite loops
 * when the SDK itself logs to console (e.g., debug messages, warnings).
 *
 * @returns Teardown function that restores all original console methods.
 */
export function instrumentConsole(client: BrowserClient): () => void {
  // Save original references before patching
  const originals: Record<ConsoleLevel, (...args: unknown[]) => void> = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  let isRecording = false;

  for (const level of CONSOLE_LEVELS) {
    console[level] = function (...args: unknown[]): void {
      // Re-entrancy guard: skip breadcrumb capture if we're already
      // inside a breadcrumb recording (avoids infinite loop)
      if (!isRecording) {
        isRecording = true;
        try {
          const message = args
            .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
            .join(' ')
            .slice(0, 1000);

          client.getScope().addBreadcrumb({
            type: 'console',
            category: `console.${level}`,
            message,
            level: LEVEL_MAP[level],
            data: { logger: 'console' },
          });
        } finally {
          isRecording = false;
        }
      }

      // Always call the original method
      originals[level].apply(console, args);
    };
  }

  // Teardown: restore all original console methods
  return () => {
    for (const level of CONSOLE_LEVELS) {
      console[level] = originals[level];
    }
  };
}
