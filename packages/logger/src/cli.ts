import { log } from '@clack/prompts'
import { Logger } from './types.js'

export function createCLILogger(): Logger {
  const toString = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value)
  return {
    error: (data) => { log.error(toString(data)) },
    debug: (data) => { log.message(toString(data)) },
    info: (data) => { log.info(toString(data)) },
    notice: (data) => { log.message(toString(data)) },
    warning: (data) => { log.warn(toString(data)) },
    critical: (data) => { log.error(toString(data)) },
    alert: (data) => { log.error(toString(data)) },
    emergency: (data) => { log.error(toString(data)) },
    progress: ({ progress, total, message }) => {
      log.info(toString({ progress, total, message }))
    }
  }
}
