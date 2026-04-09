# @silkweave/logger

Logging utilities for [Silkweave](https://github.com/silkweave/silkweave). Provides a unified `Logger` interface with multiple backends - pino for stream logging, clack for terminal UI, and callback hooks for MCP notifications.

## Install

```bash
pnpm add @silkweave/logger
```

## What's Inside

- **`Logger`** interface - 8 severity levels (`debug` through `emergency`) plus `progress()`
- **`createLogger()`** - Factory that creates a Logger backed by pino, with optional `onLog` and `onProgress` callbacks
- **`createCLILogger()`** - Logger that outputs via `@clack/prompts` for beautiful terminal UI
- **`buildLogLevels()`** - Build a log-level record from a single callback function

## Usage

```typescript
import { createLogger } from '@silkweave/logger'

const logger = createLogger({
  stream: process.stderr,
  onLog: (level, data) => {
    // Hook into log events (e.g., send MCP notifications)
  },
  onProgress: ({ progress, total, message }) => {
    // Hook into progress events
  }
})

logger.info('Starting operation')
logger.progress({ progress: 5, total: 10, message: 'Halfway there' })
```

## Logger Interface

```typescript
interface Logger {
  debug: (data: unknown) => void
  info: (data: unknown) => void
  notice: (data: unknown) => void
  warning: (data: unknown) => void
  error: (data: unknown) => void
  critical: (data: unknown) => void
  alert: (data: unknown) => void
  emergency: (data: unknown) => void
  progress: (options: ProgressOptions) => void
}

interface ProgressOptions {
  progress: number
  total?: number
  message?: string
}
```

## See Also

- [Silkweave README](https://github.com/silkweave/silkweave) - Full documentation
- [`@silkweave/core`](https://www.npmjs.com/package/@silkweave/core) - Core library
