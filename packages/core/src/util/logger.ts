export interface MessageOptions {
  message: string
}

export interface ProgressOptions {
  progress: number
  total?: number
  message?: string
}

const LogLevels = ['error', 'debug', 'info', 'notice', 'warning', 'critical', 'alert', 'emergency'] as const

export type LogLevel = typeof LogLevels[number]

export type LogFn = (data: unknown) => void

export interface Logger extends Record<LogLevel, LogFn> {
  progress: (options: ProgressOptions) => void
}

export { LogLevels }

// Severity ordering (lowest number = most verbose) used to gate writes by the
// configured `level` threshold. Mirrors syslog-style precedence so a `level` of
// e.g. `'warning'` suppresses `info`/`notice`/`debug`.
const LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  notice: 30,
  warning: 40,
  error: 50,
  critical: 60,
  alert: 70,
  emergency: 80
}

export interface CreateLoggerOptions {
  name?: string
  /** Minimum severity to write to `stream`. Defaults to `'debug'` (everything). */
  level?: LogLevel
  /**
   * Destination stream for structured log lines, or `false` to discard them.
   * Defaults to `process.stdout`. The `onLog` callback always fires regardless
   * of this setting - the stream is just the diagnostic sink.
   */
  stream?: NodeJS.WritableStream | false
  onLog?: (level: LogLevel, data: unknown) => void
  onProgress?: (options: ProgressOptions) => void
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const { name, level = 'debug', stream, onLog, onProgress } = options

  const target = stream === false ? undefined : stream ?? process.stdout
  const threshold = LEVEL_SEVERITY[level] ?? LEVEL_SEVERITY.debug

  const write = (logLevel: LogLevel, data: unknown) => {
    if (target && LEVEL_SEVERITY[logLevel] >= threshold) {
      const line = typeof data === 'object' && data !== null
        ? { level: logLevel, time: Date.now(), name, ...data }
        : { level: logLevel, time: Date.now(), name, msg: data }
      target.write(`${JSON.stringify(line)}\n`)
    }
  }

  const logLevels = Object.fromEntries(LogLevels.map((logLevel) => {
    return [logLevel, (data: unknown) => {
      write(logLevel, data)
      onLog?.(logLevel, data)
    }]
  })) as Record<LogLevel, LogFn>

  return {
    ...logLevels,
    progress: (progressOptions) => {
      if (onProgress) {
        onProgress(progressOptions)
      } else {
        write('info', { ...progressOptions })
      }
    }
  }
}

export function buildLogLevels(fn: (level: LogLevel, data: unknown) => void): Record<LogLevel, LogFn> {
  return Object.fromEntries(LogLevels.map((level) => [level, (data: unknown) => { fn(level, data) }])) as Record<LogLevel, LogFn>
}

// Maps each syslog level onto a `console` method for a human-readable terminal
// logger. Used by the `cli` adapter and the MCP `cliProxy` client - a
// zero-dependency replacement for a terminal-UI logging library.
const CONSOLE_LEVEL_MAP: Record<LogLevel, 'log' | 'info' | 'warn' | 'error'> = {
  debug: 'log',
  info: 'info',
  notice: 'info',
  warning: 'warn',
  error: 'error',
  critical: 'error',
  alert: 'error',
  emergency: 'error'
}

/**
 * Human-readable `console`-backed logger for terminal contexts. Strings are
 * written verbatim; objects are JSON-stringified. Zero dependencies.
 */
export function createConsoleLogger(): Logger {
  const toString = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value)
  return {
    ...buildLogLevels((level, data) => {
      console[CONSOLE_LEVEL_MAP[level]](toString(data))
    }),
    progress: ({ progress, total, message }) => {
      console.info(toString({ progress, total, message }))
    }
  }
}
