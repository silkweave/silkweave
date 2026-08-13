import { z } from 'zod/v4'
import { classValidatorMetas } from './classValidator.js'

/** `@nestjs/swagger` reflect-metadata keys. Read directly so swagger stays an optional peer. */
const API_MODEL_PROPERTIES = 'swagger/apiModelProperties'
const API_MODEL_PROPERTIES_ARRAY = 'swagger/apiModelPropertiesArray'

/**
 * A transport-neutral description of a single input field. Every metadata
 * source (swagger decorators, class-validator, an OpenAPI document, TypeScript
 * `design:type`) is mapped to this shape, the shapes are merged by precedence,
 * and the result is converted to Zod once. Keeping a single intermediate keeps
 * the per-source mappers small and the Zod construction in one place.
 */
export interface FieldDesc {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'unknown'
  required?: boolean
  /** Field accepts `null` (`@ApiProperty({ nullable: true })` / OpenAPI `nullable`). */
  nullable?: boolean
  description?: string
  enum?: (string | number)[]
  items?: FieldDesc
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  format?: string
  default?: unknown
}

/** Strip `undefined` values so a later source never clobbers an earlier one with a hole. */
function defined<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v
    }
  }
  return out as Partial<T>
}

/** Merge `over` onto `base` - defined keys of `over` win. */
export function mergeField(base: FieldDesc, over: FieldDesc): FieldDesc {
  return { ...base, ...defined(over) }
}

function enumToZod(values: (string | number)[]): z.ZodType {
  const strings = values.filter((v): v is string => typeof v === 'string')
  if (strings.length === values.length && strings.length > 0) {
    return z.enum(strings as [string, ...string[]])
  }
  const literals = values.map((v) => z.literal(v))
  if (literals.length === 0) {
    return z.unknown()
  }
  if (literals.length === 1) {
    return literals[0]
  }
  return z.union(literals as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]])
}

function baseToZod(d: FieldDesc): z.ZodType {
  switch (d.type) {
    case 'string': {
      let s = z.string()
      if (d.minLength != null) {
        s = s.min(d.minLength)
      }
      if (d.maxLength != null) {
        s = s.max(d.maxLength)
      }
      return s
    }
    case 'integer':
    case 'number': {
      let n = z.number()
      if (d.type === 'integer') {
        n = n.int()
      }
      if (d.min != null) {
        n = n.min(d.min)
      }
      if (d.max != null) {
        n = n.max(d.max)
      }
      return n
    }
    case 'boolean':
      return z.boolean()
    case 'array':
      return z.array(d.items ? fieldToZod({ ...d.items, required: true }) : z.unknown())
    case 'object':
      return z.record(z.string(), z.unknown())
    default:
      return z.unknown()
  }
}

/** Convert a merged {@link FieldDesc} to a Zod schema. */
export function fieldToZod(d: FieldDesc): z.ZodType {
  let schema = d.enum?.length ? enumToZod(d.enum) : baseToZod(d)
  if (d.description) {
    schema = schema.describe(d.description)
  }
  if (d.nullable) {
    schema = schema.nullable()
  }
  if (d.default !== undefined) {
    schema = (schema as any).default(d.default)
  } else if (d.required === false) {
    schema = schema.optional()
  }
  return schema
}

// --- per-source mappers ---------------------------------------------------

/** Normalise a TS-enum object or an array literal to a flat value list. */
export function normalizeEnum(value: unknown): (string | number)[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
  }
  if (value && typeof value === 'object') {
    return Object.values(value).filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
  }
  return undefined
}

/** Map a swagger/`design:type` type token (constructor, `[Type]`, or string) to a base type. */
export function typeTokenToBase(type: unknown): FieldDesc['type'] | undefined {
  if (type == null) {
    return undefined
  }
  if (type === String) {
    return 'string'
  }
  if (type === Number) {
    return 'number'
  }
  if (type === Boolean) {
    return 'boolean'
  }
  if (type === Array) {
    return 'array'
  }
  if (type === Date) {
    return 'string'
  }
  if (Array.isArray(type)) {
    return 'array'
  }
  if (typeof type === 'string') {
    const t = type.toLowerCase()
    if (t === 'string' || t === 'number' || t === 'integer' || t === 'boolean' || t === 'array' || t === 'object') {
      return t
    }
  }
  return undefined
}

/** From the constructor TypeScript emits via `emitDecoratorMetadata`. */
export function designTypeToField(ctor: unknown): FieldDesc {
  const type = typeTokenToBase(ctor)
  const f: FieldDesc = {}
  if (type) {
    f.type = type
  }
  return f
}

/** From an `@ApiParam`/`@ApiQuery` entry stored under `swagger/apiParameters`. */
export function swaggerParamToField(p: Record<string, any>): FieldDesc {
  const f: FieldDesc = {}
  if (p['description']) {
    f.description = p['description']
  }
  if (typeof p['required'] === 'boolean') {
    f.required = p['required']
  }
  const type = typeTokenToBase(p['type'])
  if (type) {
    f.type = type
  }
  if (p['isArray']) {
    f.type = 'array'
  }
  const en = normalizeEnum(p['enum'])
  if (en) {
    f.enum = en
  }
  if (p['schema'] && typeof p['schema'] === 'object') {
    return mergeField(f, openapiSchemaToField(p['schema']))
  }
  return f
}

/** From an `@ApiProperty` options object stored under `swagger/apiModelProperties`. */
export function apiPropertyToField(o: Record<string, any>): FieldDesc {
  const f: FieldDesc = {}
  if (o['description']) {
    f.description = o['description']
  }
  if (typeof o['required'] === 'boolean') {
    f.required = o['required']
  }
  const type = typeTokenToBase(o['type'])
  if (type) {
    f.type = type
  }
  if (o['isArray']) {
    f.items = { type: type && type !== 'array' ? type : 'unknown' }
    f.type = 'array'
  }
  const en = normalizeEnum(o['enum'])
  if (en) {
    f.enum = en
  }
  if (o['minimum'] != null) {
    f.min = o['minimum']
  }
  if (o['maximum'] != null) {
    f.max = o['maximum']
  }
  if (o['minLength'] != null) {
    f.minLength = o['minLength']
  }
  if (o['maxLength'] != null) {
    f.maxLength = o['maxLength']
  }
  if (o['format']) {
    f.format = o['format']
  }
  if (o['nullable'] === true) {
    f.nullable = true
  }
  if (o['default'] !== undefined) {
    f.default = o['default']
  }
  return f
}

/** `class-validator` decorator type → field base type. */
const CV_TYPE: Record<string, FieldDesc['type']> = {
  isString: 'string',
  isInt: 'integer',
  isBoolean: 'boolean',
  isArray: 'array'
}

/** `class-validator` decorator type → numeric-constraint field key. */
const CV_NUMERIC: Record<string, 'min' | 'max' | 'minLength' | 'maxLength'> = {
  min: 'min',
  max: 'max',
  minLength: 'minLength',
  maxLength: 'maxLength'
}

/**
 * Fold one `class-validator` metadata entry into the field descriptor. Built-in
 * validators record their identity in `name` (`isString`, `minLength`, ...) with
 * `type: 'customValidation'`; `@IsOptional` uses `name: 'isOptional'`. We key off
 * `name`, falling back to `type`.
 */
function applyValidationMeta(f: FieldDesc, meta: { type?: string; name?: string; constraints?: unknown[] }): void {
  const key = meta.name ?? meta.type
  if (!key) {
    return
  }
  if (key in CV_TYPE) {
    f.type = CV_TYPE[key]
    return
  }
  const c0 = meta.constraints?.[0]
  if (key in CV_NUMERIC) {
    if (typeof c0 === 'number') {
      f[CV_NUMERIC[key]] = c0
    }
    return
  }
  if (key === 'isNumber') {
    if (!f.type) {
      f.type = 'number'
    }
    return
  }
  if (key === 'isEmail') {
    if (!f.type) {
      f.type = 'string'
    }
    f.format = 'email'
    return
  }
  if (key === 'isDate' || key === 'isDateString') {
    f.type = 'string'
    f.format = 'date-time'
    return
  }
  if (key === 'isEnum') {
    const e = normalizeEnum(c0)
    if (e) {
      f.enum = e
    }
    return
  }
  if (key === 'isOptional') {
    f.required = false
  }
}

/** From an array of `class-validator` validation-metadata entries for one property. */
export function classValidatorToField(
  metas: Array<{ type?: string; name?: string; constraints?: unknown[] }>
): FieldDesc {
  const f: FieldDesc = {}
  for (const meta of metas) {
    applyValidationMeta(f, meta)
  }
  return f
}

/** From an OpenAPI Schema Object (used by both the doc and `@ApiParam({ schema })`). */
export function openapiSchemaToField(schema: Record<string, any>): FieldDesc {
  const f: FieldDesc = {}
  const type = typeof schema['type'] === 'string' ? schema['type'].toLowerCase() : undefined
  if (
    type === 'string' ||
    type === 'number' ||
    type === 'integer' ||
    type === 'boolean' ||
    type === 'array' ||
    type === 'object'
  ) {
    f.type = type
  }
  if (schema['description']) {
    f.description = schema['description']
  }
  const en = normalizeEnum(schema['enum'])
  if (en) {
    f.enum = en
  }
  if (schema['minimum'] != null) {
    f.min = schema['minimum']
  }
  if (schema['maximum'] != null) {
    f.max = schema['maximum']
  }
  if (schema['minLength'] != null) {
    f.minLength = schema['minLength']
  }
  if (schema['maxLength'] != null) {
    f.maxLength = schema['maxLength']
  }
  if (schema['format']) {
    f.format = schema['format']
  }
  if (schema['nullable'] === true) {
    f.nullable = true
  }
  if (schema['default'] !== undefined) {
    f.default = schema['default']
  }
  if (schema['items'] && typeof schema['items'] === 'object') {
    f.items = openapiSchemaToField(schema['items'])
  }
  return f
}

/**
 * Reflect a whole-DTO class (`@Body() dto: CreateDto`) into per-property
 * {@link FieldDesc}s. Property names are the union of `@ApiProperty` and
 * `class-validator` decorated fields; each field merges `design:type` (base),
 * then `class-validator` constraints, then `@ApiProperty` (highest). Properties
 * default to required unless a source marks them optional.
 */
export function reflectDtoFields(dtoType: any): Record<string, FieldDesc> {
  const proto = dtoType?.prototype
  if (!proto) {
    return {}
  }
  const cvMetas = classValidatorMetas(dtoType)

  const names = new Set<string>()
  const swaggerArray = (Reflect.getMetadata(API_MODEL_PROPERTIES_ARRAY, proto) as string[] | undefined) ?? []
  for (const entry of swaggerArray) {
    names.add(entry.replace(/^:/, ''))
  }
  for (const name of Object.keys(cvMetas)) {
    names.add(name)
  }

  const out: Record<string, FieldDesc> = {}
  for (const name of names) {
    let f = designTypeToField(Reflect.getMetadata('design:type', proto, name))
    if (cvMetas[name]) {
      f = mergeField(f, classValidatorToField(cvMetas[name]))
    }
    const apiProp = Reflect.getMetadata(API_MODEL_PROPERTIES, proto, name) as Record<string, any> | undefined
    if (apiProp) {
      const fromApi = apiPropertyToField(apiProp)
      // `@ApiProperty` is required unless `required: false` is explicit.
      if (fromApi.required === undefined && apiProp['required'] === undefined) {
        fromApi.required = true
      }
      f = mergeField(f, fromApi)
    }
    if (f.required === undefined) {
      f.required = true
    }
    out[name] = f
  }
  return out
}

/**
 * Names of fields that could not be reflected into a concrete type - they will
 * become `z.unknown()` (or `z.array(z.unknown())`). This is how a nested DTO or a
 * `Dto[]` property silently degrades (reflection is one level deep), so the
 * adapters surface these as a build-time warning pointing at `@Trpc({ output })`
 * / `@Mcp({ input })`. Enum and `object` (record) fields are not degraded.
 */
export function unreflectedFields(fields: Record<string, FieldDesc>): string[] {
  const out: string[] = []
  for (const [name, f] of Object.entries(fields)) {
    if (f.enum?.length) {
      continue
    }
    if (!f.type || f.type === 'unknown') {
      out.push(name)
    } else if (f.type === 'array' && (!f.items?.type || f.items.type === 'unknown')) {
      out.push(name)
    }
  }
  return out
}
