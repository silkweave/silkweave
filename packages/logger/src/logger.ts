import pino from 'pino'
import { Logger, LogFn, LogLevel, LogLevels, ProgressOptions } from './types.js'

type PinoLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

const PINO_LEVEL_MAP: Record<LogLevel, PinoLevel> = {
  emergency: 'fatal',
  alert: 'fatal',
  critical: 'fatal',
  error: 'error',
  warning: 'warn',
  notice: 'info',
  info: 'info',
  debug: 'debug'
}

export interface CreateLoggerOptions {
  name?: string
  level?: string
  stream?: NodeJS.WritableStream | false
  onLog?: (level: LogLevel, data: unknown) => void
  onProgress?: (options: ProgressOptions) => void
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const { name, level = 'debug', stream, onLog, onProgress } = options

  const pinoOptions: pino.LoggerOptions = { name, level }
  const instance = stream === false
    ? pino(pinoOptions, pino.destination('/dev/null'))
    : stream
      ? pino(pinoOptions, stream)
      : pino(pinoOptions)

  const logLevels = Object.fromEntries(LogLevels.map((logLevel) => {
    const pinoLevel = PINO_LEVEL_MAP[logLevel]
    return [logLevel, (data: unknown) => {
      instance[pinoLevel](data)
      onLog?.(logLevel, data)
    }]
  })) as Record<LogLevel, LogFn>

  return {
    ...logLevels,
    progress: (progressOptions) => {
      if (onProgress) {
        onProgress(progressOptions)
      } else {
        instance.info({ ...progressOptions }, progressOptions.message)
      }
    }
  }
}

export function buildLogLevels(fn: (level: LogLevel, data: unknown) => void): Record<LogLevel, LogFn> {
  return Object.fromEntries(LogLevels.map((level) => [level, (data: unknown) => { fn(level, data) }])) as Record<LogLevel, LogFn>
}
