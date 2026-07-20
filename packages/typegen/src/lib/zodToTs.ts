/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod/v4'

// Emits TypeScript type expressions as plain strings - no dependency on the
// `typescript` compiler API. typegen only ever produced `.d.ts` *text*; it never
// type-checked, so the AST factory + printer were pure overhead that forced a
// `typescript` peer dependency onto every consumer at server boot.

const INDENT = '  '
const pad = (level: number) => INDENT.repeat(level)

export function zodToTs(schema: z.ZodTypeAny, level = 0): string {
  const def = (schema as any)._zod.def
  const handler = typeHandlers[def.type as string]
  return handler ? handler(def, level) : 'unknown'
}

type TypeHandler = (def: any, level: number) => string

const keyword = (name: string) => () => name

const typeHandlers: Record<string, TypeHandler> = {
  string: keyword('string'),
  number: keyword('number'),
  nan: keyword('number'),
  bigint: keyword('bigint'),
  boolean: keyword('boolean'),
  undefined: keyword('undefined'),
  void: keyword('void'),
  any: keyword('any'),
  unknown: keyword('unknown'),
  never: keyword('never'),
  symbol: keyword('symbol'),
  date: keyword('Date'),
  null: keyword('null'),
  file: keyword('File'),

  literal: (def) => (def.values as unknown[]).map(literalToTs).join(' | '),

  enum: (def) => Object.values(def.entries).map(literalToTs).join(' | '),

  array: (def, level) => {
    const inner = zodToTs(def.element, level)
    return needsParensAsElement(def.element) ? `(${inner})[]` : `${inner}[]`
  },

  object: (def, level) => {
    const members = objectMemberLines(def, level)
    return members.length ? `{\n${members.join('\n')}\n${pad(level)}}` : '{}'
  },

  record: (def, level) =>
    // `Record<K, V>` rather than `{ [key: K]: V }` - an index signature whose
    // key type is a string-literal union (z.record(z.enum([...]), V)) is invalid
    // TS (TS1337), whereas Record accepts any keyof-compatible key type.
    `Record<${zodToTs(def.keyType, level)}, ${zodToTs(def.valueType, level)}>`,

  tuple: (def, level) => `[${(def.items as z.ZodTypeAny[]).map((i) => zodToTs(i, level)).join(', ')}]`,
  union: (def, level) => (def.options as z.ZodTypeAny[]).map((o) => zodToTs(o, level)).join(' | '),
  intersection: (def, level) => `${zodToTs(def.left, level)} & ${zodToTs(def.right, level)}`,

  optional: (def, level) => `${zodToTs(def.innerType, level)} | undefined`,
  nullable: (def, level) => `${zodToTs(def.innerType, level)} | null`,

  default: (def, level) => zodToTs(def.innerType, level),
  prefault: (def, level) => zodToTs(def.innerType, level),
  catch: (def, level) => zodToTs(def.innerType, level),
  lazy: (def, level) => zodToTs(def.getter(), level),
  pipe: (def, level) => zodToTs(def.out, level),

  readonly: (def, level) => {
    const inner = zodToTs(def.innerType, level)
    const innerType = def.innerType._zod.def.type
    return innerType === 'array' || innerType === 'tuple' ? `readonly ${inner}` : inner
  },

  set: (def, level) => `Set<${zodToTs(def.valueType, level)}>`,
  map: (def, level) => `Map<${zodToTs(def.keyType, level)}, ${zodToTs(def.valueType, level)}>`,
  promise: (def, level) => `Promise<${zodToTs(def.innerType, level)}>`
}

/**
 * The TypeScript literal of core's `SerializedResource` - the JSON wire shape
 * of a `binary()` action output on JSON transports (tRPC). Emitted inline so
 * generated `.d.ts` files stay dependency-free.
 */
export function serializedResourceType(level = 0): string {
  const p = pad(level + 1)
  const members = ['kind: \'resource\'', 'mimeType: string', 'name?: string', 'description?: string', 'text?: string', 'base64?: string']
  return `{\n${members.map((member) => `${p}${member}`).join('\n')}\n${pad(level)}}`
}

/**
 * Member lines for an object schema, indented one level deeper than `level`,
 * or `null` when the schema is not a Zod object (caller falls back to an index
 * signature). Shared by the `object` type handler and `generateDts`'s interface
 * emitter so both produce identical member formatting.
 */
export function objectMembers(schema: z.ZodTypeAny, level = 0): string[] | null {
  const def = (schema as any)._zod.def
  return def.type === 'object' ? objectMemberLines(def, level) : null
}

function objectMemberLines(def: any, level: number): string[] {
  const lines = Object.entries(def.shape as Record<string, z.ZodTypeAny>).map(([key, member]) => {
    const optional = (member as any)._zod.optout
    return `${pad(level + 1)}${identifierOrString(key)}${optional ? '?' : ''}: ${zodToTs(member, level + 1)}`
  })

  if (def.catchall) {
    lines.push(`${pad(level + 1)}[key: string]: ${zodToTs(def.catchall, level + 1)}`)
  }

  return lines
}

// Whether a type needs wrapping in parens when used as an array element - i.e.
// it renders as a top-level union or intersection (`A | B`, `A & B`), where
// `A | B[]` would otherwise bind the `[]` to `B` alone. Transparent wrappers
// (default/catch/pipe/...) are unwrapped to their effective type.
function needsParensAsElement(schema: z.ZodTypeAny): boolean {
  const def = (schema as any)._zod.def
  switch (def.type) {
    case 'union': return (def.options as unknown[]).length > 1
    case 'intersection':
    case 'optional':
    case 'nullable': return true
    case 'literal': return (def.values as unknown[]).length > 1
    case 'enum': return Object.keys(def.entries).length > 1
    case 'default':
    case 'prefault':
    case 'catch':
    case 'readonly': return needsParensAsElement(def.innerType)
    case 'pipe': return needsParensAsElement(def.out)
    case 'lazy': return needsParensAsElement(def.getter())
    default: return false
  }
}

const identifierRE = /^[$A-Z_a-z][\w$]*$/

function identifierOrString(name: string): string {
  return identifierRE.test(name) ? name : literalToTs(name)
}

function literalToTs(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`
    case 'number':
    case 'boolean':
      return String(value)
    case 'bigint':
      return `${value}n`
    default:
      return 'null'
  }
}
