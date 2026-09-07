# @tracekit/browser

TraceKit Browser SDK for error capture, distributed tracing, and browser analytics.

## Installation

```bash
npm install @tracekit/browser
```

## Quick start

```javascript
import { init } from '@tracekit/browser';

init({
  apiKey: 'ctxio_pub_...',
  serviceName: 'your-service-name',
});
```

`init()` records the first `$pageview`. SPA navigation records later pageviews.
The default endpoint is `https://app.tracekit.dev`.

## Analytics goals

Use a namespace import when you record a custom goal.

```ts
import * as tracekit from '@tracekit/browser';

tracekit.init({
  apiKey: 'ctxio_pub_...',
  serviceName: 'your-service-name',
});

const eventId = tracekit.track('signup_completed', {
  plan: 'starter',
});
```

Goal names match `[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}`. Names that start with `$` are reserved.
Properties accept JSON-safe values, up to 50 keys, five levels, and 1,024-byte strings.
The analytics request body limit is 65,536 bytes.
The returned 32-character event ID means only that local validation succeeded.
It cannot report a later queue drop or server delivery.

## Identity and privacy

The SDK stores host-only `tracekit_visitor_id` and `tracekit_session_id` cookies.
Visitor cookies last 365 days. Sessions expire after 30 minutes without activity.
The SDK does not expose a public visitor or session identity getter.

Do not send credentials, email addresses, payment data, or personal data in analytics properties.
Use the existing privacy and consent controls to disable collection when required.

## Delivery behavior

Analytics events use batches of up to 20 events after a 100ms delay.
The in-memory queue stores up to 100 events and drops the newest overflow event.
The transport makes four total attempts and caps each retry delay at 2,000ms.

## Error capture

```ts
import { captureException, init } from '@tracekit/browser';

init({
  apiKey: 'ctxio_pub_...',
  serviceName: 'your-service-name',
});

try {
  riskyOperation();
} catch (error) {
  captureException(error as Error);
}
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | Required | Public project key from TraceKit |
| `serviceName` | `string` | `'browser-app'` | Active TraceKit service name |
| `environment` | `string` | `'production'` | Environment name for filtering events |
| `release` | `string` | `undefined` | Release version for tracking regressions |
| `sampleRate` | `number` | `1.0` | Sample rate for error events (0.0 to 1.0) |
| `tracesSampleRate` | `number` | `1.0` | Sample rate for distributed traces (0.0 to 1.0) |

## Documentation

Complete analytics setup and revenue guidance: https://www.tracekit.dev/docs/analytics

Complete Browser SDK documentation: https://app.tracekit.dev/docs/frontend/browser-sdk

## License

MIT
