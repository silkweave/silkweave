import { describe, expect, it } from 'vitest'
import {
  apiPropertyToField,
  classValidatorToField,
  designTypeToField,
  fieldToZod,
  mergeField,
  normalizeEnum,
  openapiSchemaToField,
  swaggerParamToField,
  typeTokenToBase,
  unreflectedFields,
  type FieldDesc
} from './schema.js'

describe('mergeField', () => {
  it('lets defined keys of over win, without clobbering base with undefined', () => {
    expect(mergeField({ type: 'string', required: true }, { required: false })).toEqual({
      type: 'string',
      required: false
    })
    expect(mergeField({ type: 'string', min: 1 }, { type: undefined, max: 5 })).toEqual({
      type: 'string',
      min: 1,
      max: 5
    })
  })
})

describe('fieldToZod', () => {
  it('builds a constrained string', () => {
    const s = fieldToZod({ type: 'string', minLength: 2, maxLength: 4 })
    expect(s.safeParse('abc').success).toBe(true)
    expect(s.safeParse('a').success).toBe(false)
    expect(s.safeParse('abcde').success).toBe(false)
  })

  it('builds a bounded integer that rejects floats', () => {
    const n = fieldToZod({ type: 'integer', min: 1, max: 10 })
    expect(n.safeParse(5).success).toBe(true)
    expect(n.safeParse(5.5).success).toBe(false)
    expect(n.safeParse(0).success).toBe(false)
    expect(n.safeParse(11).success).toBe(false)
  })

  it('builds boolean, array-of-items, and object(record)', () => {
    expect(fieldToZod({ type: 'boolean' }).safeParse(true).success).toBe(true)
    const arr = fieldToZod({ type: 'array', items: { type: 'string' } })
    expect(arr.safeParse(['a', 'b']).success).toBe(true)
    expect(arr.safeParse([1]).success).toBe(false)
    expect(fieldToZod({ type: 'object' }).safeParse({ any: 1 }).success).toBe(true)
  })

  it('treats enum as the type, string-enum or mixed-literal union', () => {
    const e = fieldToZod({ type: 'string', enum: ['a', 'b'] })
    expect(e.safeParse('a').success).toBe(true)
    expect(e.safeParse('c').success).toBe(false)
    const mixed = fieldToZod({ enum: [1, 'a'] })
    expect(mixed.safeParse(1).success).toBe(true)
    expect(mixed.safeParse('a').success).toBe(true)
    expect(mixed.safeParse(2).success).toBe(false)
  })

  it('applies nullable, optional, and default', () => {
    expect(fieldToZod({ type: 'string', nullable: true }).safeParse(null).success).toBe(true)
    expect(fieldToZod({ type: 'string', required: false }).safeParse(undefined).success).toBe(true)
    const withDefault = fieldToZod({ type: 'number', default: 7 })
    expect(withDefault.safeParse(undefined)).toMatchObject({ success: true, data: 7 })
  })

  it('prefers a default over plain optional when both could apply', () => {
    const f = fieldToZod({ type: 'number', required: false, default: 3 })
    expect(f.safeParse(undefined)).toMatchObject({ success: true, data: 3 })
  })
})

describe('typeTokenToBase', () => {
  it('maps constructors, arrays, and type strings', () => {
    expect(typeTokenToBase(String)).toBe('string')
    expect(typeTokenToBase(Number)).toBe('number')
    expect(typeTokenToBase(Boolean)).toBe('boolean')
    expect(typeTokenToBase(Array)).toBe('array')
    expect(typeTokenToBase(Date)).toBe('string')
    expect(typeTokenToBase([String])).toBe('array')
    expect(typeTokenToBase('integer')).toBe('integer')
  })

  it('returns undefined for unknown tokens', () => {
    expect(typeTokenToBase(undefined)).toBeUndefined()
    expect(typeTokenToBase({})).toBeUndefined()
    expect(typeTokenToBase('mystery')).toBeUndefined()
  })
})

describe('normalizeEnum', () => {
  it('flattens arrays and string-enum objects, filtering non-scalars', () => {
    expect(normalizeEnum(['a', 'b'])).toEqual(['a', 'b'])
    expect(normalizeEnum(['a', 1, true])).toEqual(['a', 1])
    expect(normalizeEnum({ A: 'a', B: 'b' })).toEqual(['a', 'b'])
  })

  it('returns undefined for scalars and nullish', () => {
    expect(normalizeEnum('x')).toBeUndefined()
    expect(normalizeEnum(null)).toBeUndefined()
  })
})

describe('designTypeToField', () => {
  it('maps a constructor to a base type, or empty when unmappable', () => {
    expect(designTypeToField(String)).toEqual({ type: 'string' })
    expect(designTypeToField(Object)).toEqual({})
  })
})

describe('classValidatorToField', () => {
  it('folds built-in validators into type/constraints/format/optional', () => {
    expect(classValidatorToField([{ name: 'isString' }])).toEqual({ type: 'string' })
    expect(classValidatorToField([{ name: 'isInt' }])).toEqual({ type: 'integer' })
    expect(classValidatorToField([{ name: 'minLength', constraints: [3] }])).toEqual({ minLength: 3 })
    expect(classValidatorToField([{ name: 'isEmail' }])).toEqual({ type: 'string', format: 'email' })
    expect(classValidatorToField([{ name: 'isOptional' }])).toEqual({ required: false })
    expect(classValidatorToField([{ name: 'isEnum', constraints: [{ A: 'a', B: 'b' }] }])).toEqual({ enum: ['a', 'b'] })
  })

  it('combines multiple entries for one property', () => {
    expect(
      classValidatorToField([{ name: 'isString' }, { name: 'minLength', constraints: [2] }, { name: 'isOptional' }])
    ).toEqual({ type: 'string', minLength: 2, required: false })
  })
})

describe('apiPropertyToField', () => {
  it('reads description/required/type and array items', () => {
    expect(apiPropertyToField({ description: 'd', required: false, type: String })).toEqual({
      description: 'd',
      required: false,
      type: 'string'
    })
    expect(apiPropertyToField({ type: String, isArray: true })).toEqual({ type: 'array', items: { type: 'string' } })
  })

  it('reads numeric/string constraints, format, nullable, default, enum', () => {
    expect(
      apiPropertyToField({
        minimum: 1,
        maximum: 9,
        minLength: 2,
        maxLength: 5,
        format: 'email',
        nullable: true,
        default: 'x'
      })
    ).toEqual({ min: 1, max: 9, minLength: 2, maxLength: 5, format: 'email', nullable: true, default: 'x' })
    expect(apiPropertyToField({ enum: ['a', 'b'] })).toEqual({ enum: ['a', 'b'] })
  })
})

describe('openapiSchemaToField', () => {
  it('reads a scalar schema with constraints and nullable', () => {
    expect(openapiSchemaToField({ type: 'string', minLength: 2, format: 'email', nullable: true })).toEqual({
      type: 'string',
      minLength: 2,
      format: 'email',
      nullable: true
    })
  })

  it('reads an array schema with nested items and a default', () => {
    expect(openapiSchemaToField({ type: 'array', items: { type: 'number' }, default: [] })).toEqual({
      type: 'array',
      items: { type: 'number' },
      default: []
    })
  })
})

describe('swaggerParamToField', () => {
  it('reads description/required/type and isArray', () => {
    expect(swaggerParamToField({ description: 'd', required: true, type: Number })).toEqual({
      description: 'd',
      required: true,
      type: 'number'
    })
    expect(swaggerParamToField({ isArray: true })).toEqual({ type: 'array' })
  })

  it('merges a nested schema object', () => {
    expect(swaggerParamToField({ schema: { type: 'string', minLength: 2 } })).toEqual({ type: 'string', minLength: 2 })
  })
})

describe('unreflectedFields', () => {
  it('flags only fields that degrade to unknown (incl. unknown-item arrays), keeping enum/object/typed', () => {
    const fields: Record<string, FieldDesc> = {
      typed: { type: 'string' },
      noType: {},
      unknown: { type: 'unknown' },
      goodArray: { type: 'array', items: { type: 'string' } },
      badArray: { type: 'array', items: { type: 'unknown' } },
      itemlessArray: { type: 'array' },
      enumUnknown: { type: 'unknown', enum: ['x'] },
      record: { type: 'object' }
    }
    expect(unreflectedFields(fields).sort()).toEqual(['badArray', 'itemlessArray', 'noType', 'unknown'])
  })
})
