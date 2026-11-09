import { describe, expect, it } from 'vitest'
import { z as z3 } from 'zod/v3'
import { z } from 'zod/v4'
import { silkweave } from '../lib/silkweave.js'
import { assertZodV4Schemas, isClassicZodSchema, unwrap } from './zod.js'

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

describe('classic zod v3 schema guard', () => {
  it('tells classic v3 schemas from v4 ones', () => {
    expect(isClassicZodSchema(z3.object({ a: z3.string() }))).toBe(true)
    expect(isClassicZodSchema(z.object({ a: z.string() }))).toBe(false)
    expect(isClassicZodSchema(undefined)).toBe(false)
  })

  it('names the action and field and points at zod/v4', () => {
    expect(() => assertZodV4Schemas({ name: 'hello', input: z3.object({}) })).toThrow(
      /Action 'hello' input is a classic zod v3 schema.*zod\/v4/
    )
    expect(() => assertZodV4Schemas({ name: 'hello', input: z.object({}), output: z3.object({}) })).toThrow(
      /Action 'hello' output/
    )
    expect(() => assertZodV4Schemas({ name: 'hello', input: z.object({}), output: z.object({}) })).not.toThrow()
  })

  it('rejects start() before any adapter starts', async () => {
    let started = false
    const app = silkweave({ name: 'x', description: 'x', version: '0', lint: false })
      .adapter((_options, context) => ({
        context,
        start: async () => {
          started = true
        },
        stop: async () => {}
      }))
      .action({ name: 'hello', description: 'Say hello', input: z3.object({}), run: async () => ({}) } as never)
    await expect(app.start()).rejects.toThrow(/classic zod v3 schema/)
    expect(started).toBe(false)
  })
})
