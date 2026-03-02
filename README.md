# @tracekit/browser

TraceKit Browser SDK for error capture, breadcrumbs, and distributed tracing in browser applications.

## Installation

```bash
npm install @tracekit/browser
```

## Quick Start

```javascript
import { init, captureException } from '@tracekit/browser';

init({
  dsn: 'https://your-project-dsn@tracekit.dev/1',
});

try {
  riskyOperation();
} catch (err) {
  captureException(err);
}
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dsn` | `string` | Required | Your project DSN from TraceKit dashboard |
| `environment` | `string` | `'production'` | Environment name for filtering events |
| `release` | `string` | `undefined` | Release version for tracking regressions |
| `sampleRate` | `number` | `1.0` | Sample rate for error events (0.0 to 1.0) |
| `tracesSampleRate` | `number` | `1.0` | Sample rate for distributed traces (0.0 to 1.0) |

## Documentation

Full documentation: https://app.tracekit.dev/docs/frontend/browser-sdk

## License

MIT
