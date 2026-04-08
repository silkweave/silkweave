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
