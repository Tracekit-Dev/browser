/**
 * TraceKit Browser SDK - OTLP Conversion
 * @package @tracekit/browser
 *
 * Converts internal BrowserEvent objects to OTLP JSON format
 * for the server's POST /v1/traces endpoint.
 *
 * Each error is modeled as a span with an exception event,
 * matching the React Native SDK pattern and the server's
 * OTLP handler expectations.
 */

import type {
  BrowserEvent,
  ResolvedConfig,
  OTLPPayload,
  OTLPAttribute,
  OTLPAttributeValue,
} from './types';
import type { Scope } from './scope';
import { generateTraceId, generateSpanId } from './id';

/** SDK version constant */
export const SDK_VERSION = '1.0.0';

/**
 * Convert a BrowserEvent to an OTLP JSON payload.
 *
 * The payload contains one resourceSpan with one scopeSpan
 * containing one span. The span has an 'exception' event
 * with the error details.
 */
export function eventToOTLP(
  event: BrowserEvent,
  scope: Scope,
  config: ResolvedConfig,
): OTLPPayload {
  const traceId = generateTraceId();
  const spanId = generateSpanId();
  const nowNano = String(Date.now() * 1_000_000);

  // Build resource attributes
  const resourceAttrs: Record<string, unknown> = {
    'service.name': config.serviceName,
    'service.version': config.release,
    'deployment.environment': config.environment,
    'telemetry.sdk.name': '@tracekit/browser',
    'telemetry.sdk.version': SDK_VERSION,
    'telemetry.sdk.language': 'javascript',
    'browser.user_agent':
      typeof navigator !== 'undefined' ? navigator.userAgent : '',
  };

  // Build span attributes
  const user = scope.getUser();
  const tags = scope.getTags();
  const extras = scope.getExtras();

  const spanAttrs: Record<string, unknown> = {
    'error': true,
    'error.type': event.type,
    'error.message': event.message,
    'tracekit.debug_id': event.debugId || '',
    'tracekit.user.id': user?.id,
    'tracekit.user.email': user?.email,
    'tracekit.breadcrumbs': JSON.stringify(scope.getBreadcrumbs()),
    // Spread tags directly
    ...tags,
  };

  // Spread extras with `extra.` prefix
  for (const [key, value] of Object.entries(extras)) {
    spanAttrs[`extra.${key}`] = typeof value === 'string' ? value : JSON.stringify(value);
  }

  // Build exception event attributes
  const exceptionAttrs: Record<string, unknown> = {
    'exception.type': event.type,
    'exception.message': event.message,
    'exception.stacktrace': event.stackTrace || '',
    'tracekit.debug_id': event.debugId || '',
  };

  return {
    resourceSpans: [
      {
        resource: {
          attributes: toOTLPAttributes(resourceAttrs),
        },
        scopeSpans: [
          {
            scope: {
              name: '@tracekit/browser',
              version: SDK_VERSION,
            },
            spans: [
              {
                traceId,
                spanId,
                name: `Exception: ${event.type}`,
                kind: 1, // INTERNAL
                startTimeUnixNano: nowNano,
                endTimeUnixNano: nowNano,
                attributes: toOTLPAttributes(spanAttrs),
                events: [
                  {
                    name: 'exception',
                    timeUnixNano: nowNano,
                    attributes: toOTLPAttributes(exceptionAttrs),
                  },
                ],
                status: { code: 2 }, // ERROR
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Convert a record of key-value pairs to OTLP attribute array format.
 * Skips entries with undefined or null values.
 */
export function toOTLPAttributes(
  record: Record<string, unknown>,
): OTLPAttribute[] {
  const attributes: OTLPAttribute[] = [];

  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null) {
      continue;
    }

    attributes.push({
      key,
      value: toOTLPAttributeValue(value),
    });
  }

  return attributes;
}

/**
 * Convert a single value to the OTLP attribute value format.
 */
function toOTLPAttributeValue(value: unknown): OTLPAttributeValue {
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (typeof value === 'boolean') {
    return { boolValue: value };
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { intValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((v) => toOTLPAttributeValue(v)),
      },
    };
  }

  // Fallback: convert to string
  return { stringValue: String(value) };
}
