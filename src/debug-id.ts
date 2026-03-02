/**
 * TraceKit Browser SDK - Debug ID Lookup
 * @package @tracekit/browser
 *
 * Reads debug IDs from globalThis.__TRACEKIT_DEBUG_IDS__, which is
 * injected at build time by the @tracekit/vite-plugin or
 * @tracekit/webpack-plugin.
 *
 * The debug ID is a UUID that links a built JS file to its uploaded
 * source map, enabling automatic symbolication on the server.
 *
 * Gracefully handles: SSR (no globalThis), missing debug IDs,
 * inline scripts with no filename, and full URL filenames.
 */

/** Internal cache of filename -> debug ID mappings */
const debugIdCache = new Map<string, string>();

/**
 * Populate the internal cache from globalThis.__TRACEKIT_DEBUG_IDS__.
 * Call this at SDK init time.
 *
 * The global is a Record<string, string> mapping filename to UUID,
 * injected by build plugins.
 */
export function collectDebugIds(): void {
  try {
    const globalIds = getGlobalDebugIds();
    if (!globalIds || typeof globalIds !== 'object') {
      return;
    }

    for (const [filename, debugId] of Object.entries(globalIds)) {
      if (typeof debugId === 'string' && debugId.length > 0) {
        debugIdCache.set(filename, debugId);
        // Also cache by just the filename portion (last path segment)
        const basename = extractFilename(filename);
        if (basename !== filename) {
          debugIdCache.set(basename, debugId);
        }
      }
    }
  } catch {
    // Silently ignore -- debug IDs are best-effort
  }
}

/**
 * Look up the debug ID for a given filename.
 *
 * Checks the internal cache first, then falls back to reading
 * from globalThis.__TRACEKIT_DEBUG_IDS__ directly.
 *
 * Handles full URLs by extracting the filename portion for lookup.
 *
 * @returns The debug ID UUID string, or undefined if not found.
 */
export function getDebugIdForFile(filename: string): string | undefined {
  // Try exact match in cache
  const cached = debugIdCache.get(filename);
  if (cached) {
    return cached;
  }

  // Try basename match in cache
  const basename = extractFilename(filename);
  if (basename !== filename) {
    const cachedBasename = debugIdCache.get(basename);
    if (cachedBasename) {
      return cachedBasename;
    }
  }

  // Try direct lookup from global (in case collectDebugIds wasn't called
  // or the global was populated after init)
  try {
    const globalIds = getGlobalDebugIds();
    if (globalIds && typeof globalIds === 'object') {
      // Try exact match
      if (typeof globalIds[filename] === 'string') {
        return globalIds[filename];
      }
      // Try basename match
      if (basename !== filename && typeof globalIds[basename] === 'string') {
        return globalIds[basename];
      }
    }
  } catch {
    // Silently ignore
  }

  return undefined;
}

/**
 * Safely read the global debug IDs record.
 */
function getGlobalDebugIds(): Record<string, string> | undefined {
  try {
    return (globalThis as Record<string, unknown>).__TRACEKIT_DEBUG_IDS__ as
      | Record<string, string>
      | undefined;
  } catch {
    // globalThis may not be defined in some SSR contexts
    return undefined;
  }
}

/**
 * Extract just the filename from a full URL or path.
 * e.g., "https://example.com/assets/app-abc123.js" -> "app-abc123.js"
 */
function extractFilename(path: string): string {
  try {
    // Try parsing as URL first
    const url = new URL(path);
    const segments = url.pathname.split('/');
    return segments[segments.length - 1] || path;
  } catch {
    // Not a URL -- try as a path
    const segments = path.split('/');
    return segments[segments.length - 1] || path;
  }
}
