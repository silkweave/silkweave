import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { unwrap } from './zod.js'

describe('unwrap', () => {
  it('returns the base type and empty metadata for a bare schema', () => {
    const [base, meta] = unwrap(z.string())
    expect(base).toBeInstanceOf(z.ZodString)
    expect(meta).toEqual({})
  })

  it('flags optional/nullable/readonly and peels to the base', () => {
    expect(unwrap(z.string().optional())[1]).toEqual({ isOptional: true })
    expect(unwrap(z.string().nullable())[1]).toEqual({ isNullable: true })
    expect(unwrap(z.string().readonly())[1]).toEqual({ isReadOnly: true })
  })

  it('captures a static default value', () => {
    const [base, meta] = unwrap(z.number().default(7))
    expect(base).toBeInstanceOf(z.ZodNumber)
    expect(meta.defaultValue).toBe(7)
  })

  it('evaluates a function default', () => {
    const [, meta] = unwrap(z.number().default(() => 42))
    expect(meta.defaultValue).toBe(42)
  })

  it('unwraps nested wrappers (default + optional) down to the primitive', () => {
    const [base, meta] = unwrap(z.number().default(3).optional())
    expect(base).toBeInstanceOf(z.ZodNumber)
    expect(meta.isOptional).toBe(true)
    expect(meta.defaultValue).toBe(3)
  })

  it('records both nullable and optional when combined', () => {
    const [base, meta] = unwrap(z.string().nullable().optional())
    expect(base).toBeInstanceOf(z.ZodString)
    expect(meta.isOptional).toBe(true)
    expect(meta.isNullable).toBe(true)
  })
})
