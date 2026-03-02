/**
 * TraceKit Browser SDK - Configuration
 * @package @tracekit/browser
 */

import type { TracekitBrowserConfig, ResolvedConfig } from './types';

const DEFAULT_INTEGRATIONS = {
  globalError: true,
  console: true,
  fetch: true,
  xhr: true,
  dom: true,
  navigation: true,
} as const;

/**
 * Resolve user-provided config with defaults.
 * Validates required fields and value ranges.
 */
export function resolveConfig(config: TracekitBrowserConfig): ResolvedConfig {
  if (!config.apiKey || typeof config.apiKey !== 'string' || config.apiKey.trim() === '') {
    throw new Error('TraceKit: apiKey is required and must be a non-empty string');
  }

  const sampleRate = config.sampleRate ?? 1.0;
  if (typeof sampleRate !== 'number' || sampleRate < 0 || sampleRate > 1) {
    throw new Error('TraceKit: sampleRate must be a number between 0 and 1');
  }

  const userIntegrations = config.integrations ?? {};

  return {
    apiKey: config.apiKey,
    release: config.release,
    environment: config.environment ?? 'production',
    sampleRate,
    enabled: config.enabled ?? true,
    debug: config.debug ?? false,
    serviceName: config.serviceName ?? 'browser-app',
    maxBreadcrumbs: config.maxBreadcrumbs ?? 100,
    endpoint: config.endpoint ?? 'https://app.tracekit.dev',
    tracePropagationTargets: config.tracePropagationTargets ?? [],
    beforeSend: config.beforeSend ?? null,
    addons: config.addons ?? [],
    integrations: {
      globalError: userIntegrations.globalError ?? DEFAULT_INTEGRATIONS.globalError,
      console: userIntegrations.console ?? DEFAULT_INTEGRATIONS.console,
      fetch: userIntegrations.fetch ?? DEFAULT_INTEGRATIONS.fetch,
      xhr: userIntegrations.xhr ?? DEFAULT_INTEGRATIONS.xhr,
      dom: userIntegrations.dom ?? DEFAULT_INTEGRATIONS.dom,
      navigation: userIntegrations.navigation ?? DEFAULT_INTEGRATIONS.navigation,
    },
  };
}
