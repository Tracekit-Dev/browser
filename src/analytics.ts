import { generateTraceId } from './id';
import type { AnalyticsIdentitySnapshot, BrowserAnalyticsEvent, RecentTraceContext, ResolvedConfig } from './types';
import { BrowserAnalyticsTransport, MAX_ANALYTICS_BODY_BYTES } from './analytics-transport';

export const ANALYTICS_SESSION_MAX_AGE_MS = 30 * 60 * 1000;
const VISITOR_MAX_AGE = 365 * 24 * 60 * 60;
const SESSION_COOKIE = 'tracekit_session_id';
const VISITOR_COOKIE = 'tracekit_visitor_id';
const ACTIVITY_COOKIE = 'tracekit_session_activity';
const ATTRIBUTION_COOKIE = 'tracekit_session_attribution';

export interface AnalyticsCookieAdapter {
  get(name: string): string | undefined;
  set(name: string, value: string, maxAge: number): void;
}

export interface AnalyticsCollectorOptions {
  now?: () => number;
  cookies?: AnalyticsCookieAdapter;
  location?: () => Location | undefined;
  document?: () => Document | undefined;
}

interface Attribution {
  sessionId: string;
  pageUrl: string;
  referrer: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
}

export function defaultAnalyticsCookies(): AnalyticsCookieAdapter {
  return {
    get(name) {
      if (typeof document === 'undefined') return undefined;
      const prefix = `${name}=`;
      const found = document.cookie.split('; ').find((item) => item.startsWith(prefix));
      return found ? decodeURIComponent(found.slice(prefix.length)) : undefined;
    },
    set(name, value, maxAge) {
      if (typeof document === 'undefined') return;
      const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
    },
  };
}

const cleanString = (value: unknown, maxBytes: number): string => {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return '';
  const trimmed = value.trim();
  return new TextEncoder().encode(trimmed).byteLength <= maxBytes ? trimmed : '';
};

const validHex = (value: unknown, length: number): value is string =>
  typeof value === 'string' && new RegExp(`^(?!0{${length}})[0-9a-f]{${length}}$`).test(value);

function validProperties(value: unknown, depth = 1, keys = { count: 0 }, seen = new Set<object>()): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return validPropertyValue(value, depth, keys, seen);
}

function validPropertyValue(value: unknown, depth: number, keys: { count: number }, seen: Set<object>): boolean {
  if (depth > 5) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return typeof value !== 'string' || new TextEncoder().encode(value).byteLength <= 1024;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') return false;
  if (typeof value !== 'object' || seen.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) {
      if (!validPropertyValue(child, depth + 1, keys, seen)) {
        seen.delete(value);
        return false;
      }
    }
  } else {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      keys.count += 1;
      if (keys.count > 50 || key.length < 1 || new TextEncoder().encode(key).byteLength > 64 || !validPropertyValue(child, depth + 1, keys, seen)) {
        seen.delete(value);
        return false;
      }
    }
  }
  seen.delete(value);
  return true;
}

function sanitizeURL(raw: string, base?: string): string {
  if (!raw) return '';
  try {
    const parsed = new URL(raw, base);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    const sanitized = `${parsed.origin}${parsed.pathname || '/'}`;
    return new TextEncoder().encode(sanitized).byteLength <= 2048 ? sanitized : '';
  } catch {
    return '';
  }
}

function parseAttribution(raw: string, referrer: string, sessionId: string): Attribution {
  let parsed: URL | undefined;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = undefined;
  }
  const value = (key: string): string => cleanString(parsed?.searchParams.get(key) ?? '', 255);
  return {
    sessionId,
    pageUrl: sanitizeURL(raw),
    referrer: sanitizeURL(referrer, parsed?.origin),
    utm_source: value('utm_source'),
    utm_medium: value('utm_medium'),
    utm_campaign: value('utm_campaign'),
    utm_term: value('utm_term'),
    utm_content: value('utm_content'),
  };
}

function isValidAttribution(value: unknown, sessionId: string): value is Attribution {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Attribution>;
  if (!validHex(candidate.sessionId, 32) || candidate.sessionId !== sessionId) return false;
  if (typeof candidate.pageUrl !== 'string' || sanitizeURL(candidate.pageUrl) !== candidate.pageUrl) return false;
  if (typeof candidate.referrer !== 'string' || (candidate.referrer !== '' && sanitizeURL(candidate.referrer) !== candidate.referrer)) return false;
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const) {
    if (typeof candidate[key] !== 'string' || cleanString(candidate[key], 255) !== candidate[key]) return false;
  }
  return true;
}

export class AnalyticsCollector {
  private readonly config: ResolvedConfig;
  private readonly transport: BrowserAnalyticsTransport;
  private readonly now: () => number;
  private readonly cookies: AnalyticsCookieAdapter;
  private readonly getLocation: () => Location | undefined;
  private readonly getDocument: () => Document | undefined;
  private visitorId = '';
  private sessionId = '';
  private attribution: Attribution | null = null;
  private lastPageviewURL = '';
  private memoryActivity = 0;

  private newIdentifier(): string {
    let identifier = generateTraceId();
    while (/^0+$/.test(identifier)) identifier = generateTraceId();
    return identifier;
  }

  constructor(config: ResolvedConfig, transport = new BrowserAnalyticsTransport(config), options: AnalyticsCollectorOptions = {}) {
    this.config = config;
    this.transport = transport;
    this.now = options.now ?? (() => Date.now());
    this.cookies = options.cookies ?? defaultAnalyticsCookies();
    this.getLocation = options.location ?? (() => (typeof window === 'undefined' ? undefined : window.location));
    this.getDocument = options.document ?? (() => (typeof document === 'undefined' ? undefined : document));
  }

  destroy(): void { this.transport.destroy(); }

  capturePageview(context?: { userId?: string; releaseId?: string; trace?: RecentTraceContext; replayId?: string }): string {
    if (!this.config.enabled || typeof this.getLocation() === 'undefined') return '';
    const raw = this.getLocation()!.href;
    if (raw === this.lastPageviewURL) return '';
    this.lastPageviewURL = raw;
    return this.capture('$pageview', {}, context);
  }

  getIdentitySnapshot(): AnalyticsIdentitySnapshot | undefined {
    if (!this.config.enabled) return undefined;
    try {
      const location = this.getLocation();
      if (!location) return undefined;
      const { visitorId, sessionId, attribution } = this.ensureIdentity(location);
      const serviceName = cleanString(this.config.serviceName, 255);
      const pagePath = cleanString(location.pathname || '/', 2048) || '/';
      if (!serviceName || !validHex(visitorId, 32) || !validHex(sessionId, 32)) return undefined;
      return {
        service_name: serviceName,
        visitor_id: visitorId,
        session_id: sessionId,
        page_path: pagePath,
        landing_source: attribution.utm_source,
        landing_referrer: attribution.referrer,
      };
    } catch {
      return undefined;
    }
  }

  track(name: string, properties: Record<string, unknown> = {}, context?: { userId?: string; releaseId?: string; trace?: RecentTraceContext; replayId?: string }): string {
    try {
      if (!this.config.enabled || typeof name !== 'string' || name.startsWith('$') || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(name) || !validProperties(properties)) return '';
      return this.capture(name, properties, context);
    } catch {
      return '';
    }
  }

  private capture(eventName: string, properties: Record<string, unknown>, context?: { userId?: string; releaseId?: string; trace?: RecentTraceContext; replayId?: string }): string {
    if (!this.config.enabled) return '';
    const location = this.getLocation();
    if (!location) return '';
    const { visitorId, sessionId, attribution } = this.ensureIdentity(location);
    const doc = this.getDocument();
    const pageURL = sanitizeURL(location.href);
    const pagePath = cleanString(location.pathname || '/', 2048) || '/';
    const pageTitle = cleanString(doc?.title ?? '', 512);
    const serviceName = cleanString(this.config.serviceName, 255);
    if (!serviceName) return '';
    const event: BrowserAnalyticsEvent = {
      service_name: serviceName,
      event_id: this.newIdentifier(),
      event_name: eventName,
      event_time: new Date(this.now()).toISOString(),
      visitor_id: visitorId,
      session_id: sessionId,
      properties: { ...properties },
      page_url: pageURL.length <= 2048 ? pageURL : '',
      page_path: pagePath,
      page_title: pageTitle,
      referrer: attribution.referrer,
      utm_source: attribution.utm_source,
      utm_medium: attribution.utm_medium,
      utm_campaign: attribution.utm_campaign,
      utm_term: attribution.utm_term,
      utm_content: attribution.utm_content,
    };
    const optional: [keyof BrowserAnalyticsEvent, unknown][] = [
      ['user_id', cleanString(context?.userId, 255)],
      ['release_id', cleanString(context?.releaseId, 255)],
      ['replay_id', cleanString(context?.replayId, 255)],
      ['trace_id', validHex(context?.trace?.traceId, 32) ? context?.trace?.traceId : ''],
      ['span_id', validHex(context?.trace?.spanId, 16) ? context?.trace?.spanId : ''],
    ];
    for (const [key, value] of optional) if (value) (event as unknown as Record<string, unknown>)[key] = value;
    try {
      if (new TextEncoder().encode(JSON.stringify(event)).byteLength > MAX_ANALYTICS_BODY_BYTES) return '';
    } catch {
      return '';
    }
    void this.transport.send(Object.freeze(event));
    return event.event_id;
  }

  private ensureIdentity(location: Location): { visitorId: string; sessionId: string; attribution: Attribution } {
    let visitor = '';
    let session = '';
    let activity = 0;
    try {
      visitor = this.cookies.get(VISITOR_COOKIE) ?? '';
      session = this.cookies.get(SESSION_COOKIE) ?? '';
      activity = Number(this.cookies.get(ACTIVITY_COOKIE) ?? '0');
    } catch {
      visitor = this.visitorId;
      session = this.sessionId;
      activity = this.memoryActivity;
    }
    if (!visitor && this.visitorId) visitor = this.visitorId;
    if (!session && this.sessionId) session = this.sessionId;
    if (!activity && this.memoryActivity) activity = this.memoryActivity;
    if (!validHex(visitor, 32)) visitor = this.newIdentifier();
    const now = this.now();
    const sessionExpired = !validHex(session, 32) || !Number.isFinite(activity) || now - activity >= ANALYTICS_SESSION_MAX_AGE_MS;
    if (sessionExpired) session = this.newIdentifier();
    let attribution: Attribution | null = null;
    if (!sessionExpired && this.attribution?.sessionId === session) {
      attribution = this.attribution;
    } else {
      try {
        const saved = this.cookies.get(ATTRIBUTION_COOKIE);
        if (saved) {
          const parsed = JSON.parse(decodeURIComponent(saved)) as Attribution;
        if (isValidAttribution(parsed, session)) attribution = parsed;
        }
      } catch {
        attribution = null;
      }
    }
    if (!attribution) {
      attribution = parseAttribution(location.href, this.getDocument()?.referrer ?? '', session);
    }
    this.visitorId = visitor;
    this.sessionId = session;
    this.attribution = attribution;
    this.memoryActivity = now;
    try {
      this.cookies.set(VISITOR_COOKIE, visitor, VISITOR_MAX_AGE);
      this.cookies.set(SESSION_COOKIE, session, 1800);
      this.cookies.set(ACTIVITY_COOKIE, String(now), 1800);
      this.cookies.set(ATTRIBUTION_COOKIE, encodeURIComponent(JSON.stringify(attribution)), 1800);
    } catch {
      // Memory-only fallback for blocked cookies.
    }
    return { visitorId: visitor, sessionId: session, attribution };
  }
}
