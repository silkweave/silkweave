import { describe, expect, it, vi } from 'vitest'
import { buildLogLevels, createConsoleLogger, createLogger, LogLevels, type LogLevel } from './logger.js'

/** A WritableStream stand-in that records every line written. */
function captureStream(): { lines: string[]; stream: NodeJS.WritableStream } {
  const lines: string[] = []
  const stream = { write: (chunk: string): boolean => { lines.push(String(chunk)); return true } } as unknown as NodeJS.WritableStream
  return { lines, stream }
}

describe('createLogger', () => {
  it('writes a structured JSON line per call, merging object data', () => {
    const { lines, stream } = captureStream()
    createLogger({ stream, name: 'svc' }).info({ msg: 'hi', foo: 1 })
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0]) as Record<string, unknown>
    expect(entry).toMatchObject({ level: 'info', name: 'svc', msg: 'hi', foo: 1 })
    expect(typeof entry.time).toBe('number')
  })

  it('puts non-object data under msg', () => {
    const { lines, stream } = captureStream()
    createLogger({ stream }).info('plain message')
    expect(JSON.parse(lines[0])).toMatchObject({ level: 'info', msg: 'plain message' })
  })

  it('suppresses writes below the configured level threshold', () => {
    const { lines, stream } = captureStream()
    const log = createLogger({ stream, level: 'warning' })
    log.debug('quiet')
    log.info('quiet')
    expect(lines).toHaveLength(0)
    log.warning('loud')
    log.error('loud')
    expect(lines).toHaveLength(2)
  })

  it('discards stream output when stream is false but still fires onLog', () => {
    const seen: [LogLevel, unknown][] = []
    const log = createLogger({ stream: false, onLog: (level, data) => seen.push([level, data]) })
    log.info('x')
    expect(seen).toEqual([['info', 'x']])
  })

  it('fires onLog in addition to the stream write', () => {
    const { lines, stream } = captureStream()
    const seen: [LogLevel, unknown][] = []
    createLogger({ stream, onLog: (level, data) => seen.push([level, data]) }).error({ a: 1 })
    expect(lines).toHaveLength(1)
    expect(seen).toEqual([['error', { a: 1 }]])
  })

  it('writes progress as an info line when no onProgress is given', () => {
    const { lines, stream } = captureStream()
    createLogger({ stream }).progress({ progress: 1, total: 3, message: 'third' })
    expect(JSON.parse(lines[0])).toMatchObject({ level: 'info', progress: 1, total: 3, message: 'third' })
  })

  it('routes progress to onProgress and skips the stream when provided', () => {
    const { lines, stream } = captureStream()
    const seen: unknown[] = []
    createLogger({ stream, onProgress: (opts) => seen.push(opts) }).progress({ progress: 2, total: 4 })
    expect(seen).toEqual([{ progress: 2, total: 4 }])
    expect(lines).toHaveLength(0)
  })
})

describe('buildLogLevels', () => {
  it('builds a function for every log level, routing through the single callback', () => {
    const calls: [LogLevel, unknown][] = []
    const levels = buildLogLevels((level, data) => calls.push([level, data]))
    expect(Object.keys(levels).sort()).toEqual([...LogLevels].sort())
    levels.error('boom')
    levels.debug({ detail: true })
    expect(calls).toEqual([['error', 'boom'], ['debug', { detail: true }]])
  })
})

describe('createConsoleLogger', () => {
  it('maps each level onto the matching console method, stringifying objects', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logger = createConsoleLogger()
    logger.info('plain')
    logger.warning({ code: 1 })
    logger.critical('boom')
    expect(info).toHaveBeenCalledWith('plain')
    expect(warn).toHaveBeenCalledWith('{"code":1}')
    expect(error).toHaveBeenCalledWith('boom')
    info.mockRestore()
    warn.mockRestore()
    error.mockRestore()
  })
})
