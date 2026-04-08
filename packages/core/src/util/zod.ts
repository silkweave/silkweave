/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'

export interface UnwrapResult {
  defaultValue?: any
  isOptional?: boolean
  isNullable?: boolean
  isReadOnly?: boolean
}

export function unwrap(
  type: z.ZodTypeAny,
  result: UnwrapResult = {}
): [z.ZodTypeAny, UnwrapResult] {
  if (type instanceof z.ZodOptional) {
    result.isOptional = true
    return unwrap(type.unwrap() as z.ZodTypeAny, result)
  } else if (type instanceof z.ZodNullable) {
    result.isNullable = true
    return unwrap(type.unwrap() as z.ZodTypeAny, result)
  } else if (type instanceof z.ZodReadonly) {
    result.isReadOnly = true
    return unwrap(type.unwrap() as z.ZodTypeAny, result)
  } else if (type instanceof z.ZodDefault) {
    result.defaultValue = typeof type.def.defaultValue === 'function'
      ? type.def.defaultValue()
      : type.def.defaultValue
    return unwrap(type.unwrap() as z.ZodTypeAny, result)
  } else {
    return [type, result]
  }
}
