/**
 * TraceKit Browser SDK - Type Definitions
 * @package @tracekit/browser
 */

// ============================================================================
// Severity & Stack Frame
// ============================================================================

export type SeverityLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

export interface StackFrame {
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
}

// ============================================================================
// Breadcrumb
// ============================================================================

export interface Breadcrumb {
  type: string;
  category: string;
  message?: string;
  level: SeverityLevel;
  timestamp: number;
  data?: Record<string, unknown>;
}

// ============================================================================
// User Context
// ============================================================================

export interface UserContext {
  id?: string;
  email?: string;
  username?: string;
}

// ============================================================================
// Browser Event (Internal Representation)
// ============================================================================

export interface BrowserEvent {
  type: string;
  message: string;
  stackTrace?: string;
  frames?: StackFrame[];
  debugId?: string;
  level: SeverityLevel;
  timestamp: number;
  handled: boolean;
}

// ============================================================================
// Integration Interface (Addon Support)
// ============================================================================

/**
 * Integration interface for external addon packages (e.g. @tracekit/replay).
 * Uses `any` for client parameter to avoid circular dependency.
 */
export interface Integration {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  install(client: any): void;
  teardown?(): void;
}

// ============================================================================
// Configuration
// ============================================================================

export interface TracekitBrowserConfig {
  /** Required: Your TraceKit API key */
  apiKey: string;

  /** Release/version identifier (maps to service.version) */
  release?: string;

  /** Environment name (default: 'production') */
  environment?: string;

  /** Sample rate 0.0-1.0 (default: 1.0) */
  sampleRate?: number;

  /** Enable/disable SDK (default: true) */
  enabled?: boolean;

  /** Debug mode - logs SDK internals to console (default: false) */
  debug?: boolean;

  /** Service name (default: 'browser-app') */
  serviceName?: string;

  /** Maximum breadcrumbs to keep (default: 100) */
  maxBreadcrumbs?: number;

  /** TraceKit endpoint URL (default: 'https://app.tracekit.dev') */
  endpoint?: string;

  /** URLs to inject traceparent header on (default: [] = same-origin only) */
  tracePropagationTargets?: (string | RegExp)[];

  /** Hook to modify or drop events before sending */
  beforeSend?: (event: BrowserEvent) => BrowserEvent | null;

  /** External addon integrations (e.g. @tracekit/replay) */
  addons?: Integration[];

  /** Integration toggle flags */
  integrations?: {
    globalError?: boolean;
    console?: boolean;
    fetch?: boolean;
    xhr?: boolean;
    dom?: boolean;
    navigation?: boolean;
  };
}

/** Fully resolved config with all defaults applied */
export interface ResolvedConfig {
  apiKey: string;
  release: string | undefined;
  environment: string;
  sampleRate: number;
  enabled: boolean;
  debug: boolean;
  serviceName: string;
  maxBreadcrumbs: number;
  endpoint: string;
  tracePropagationTargets: (string | RegExp)[];
  beforeSend: ((event: BrowserEvent) => BrowserEvent | null) | null;
  addons: Integration[];
  integrations: {
    globalError: boolean;
    console: boolean;
    fetch: boolean;
    xhr: boolean;
    dom: boolean;
    navigation: boolean;
  };
}

// ============================================================================
// OTLP JSON Types
// ============================================================================

export interface OTLPAttributeValue {
  stringValue?: string;
  intValue?: string;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: {
    values: OTLPAttributeValue[];
  };
}

export interface OTLPAttribute {
  key: string;
  value: OTLPAttributeValue;
}

export interface OTLPEvent {
  name: string;
  timeUnixNano: string;
  attributes: OTLPAttribute[];
}

export interface OTLPSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OTLPAttribute[];
  events: OTLPEvent[];
  status: { code: number };
}

export interface OTLPScopeSpan {
  scope?: {
    name: string;
    version: string;
  };
  spans: OTLPSpan[];
}

export interface OTLPResourceSpan {
  resource: {
    attributes: OTLPAttribute[];
  };
  scopeSpans: OTLPScopeSpan[];
}

export interface OTLPPayload {
  resourceSpans: OTLPResourceSpan[];
}
