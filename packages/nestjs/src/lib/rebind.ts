/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
import { PARAMTYPE } from './reflect/params.js'

/**
 * Instruction for reconstructing one positional handler argument from the flat
 * MCP tool input. Built at discovery time, consumed by {@link invokeRebound}.
 */
export type Binding =
  | { kind: 'value'; field: string; source: 'path' | 'query' | 'body'; metatype?: unknown; pipes?: unknown[] }
  | { kind: 'object'; source: 'query' | 'body'; fields: string[]; metatype?: unknown; pipes?: unknown[] }
  | { kind: 'params'; fields: string[] }
  | { kind: 'request' }
  | { kind: 'response' }
  | { kind: 'headers'; data?: string }
  | { kind: 'ip' }
  | { kind: 'host'; data?: string }
  | { kind: 'missing' }

interface RequestLike {
  headers?: Record<string, unknown>
  ip?: unknown
  hosts?: Record<string, unknown>
}

function newInstance(P: any): any | null {
  try { return new P() } catch { return null }
}

async function applyPipes(value: unknown, pipes: unknown[] | undefined, metatype: unknown, type: 'param' | 'query' | 'body', data: string | undefined): Promise<unknown> {
  if (!pipes || pipes.length === 0) { return value }
  let current = value
  for (const p of pipes) {
    const pipe = typeof p === 'function' ? newInstance(p) : p
    if (pipe && typeof (pipe).transform === 'function') {
      current = await (pipe).transform(current, { type, metatype, data })
    }
  }
  return current
}

/** Pick a subset of keys (skipping `undefined`) into a fresh object. */
function pickFields(input: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (const f of fields) {
    if (input[f] !== undefined) { obj[f] = input[f] }
  }
  return obj
}

/** Resolve a single positional argument from one binding. */
async function resolveArg(
  b: Binding,
  input: Record<string, unknown>,
  request: RequestLike | undefined,
  applyParamPipes: boolean
): Promise<unknown> {
  switch (b.kind) {
    case 'value': {
      const raw = input[b.field]
      const type = b.source === 'path' ? 'param' : b.source
      return applyParamPipes ? applyPipes(raw, b.pipes, b.metatype, type, b.field) : raw
    }
    case 'object': {
      const obj = pickFields(input, b.fields)
      return applyParamPipes ? applyPipes(obj, b.pipes, b.metatype, b.source, undefined) : obj
    }
    case 'params':
      return pickFields(input, b.fields)
    case 'headers':
      return b.data ? request?.headers?.[b.data.toLowerCase()] : (request?.headers ?? {})
    case 'request':
      return request ?? { headers: {} }
    case 'ip':
      return request?.ip
    case 'host':
      return b.data ? request?.hosts?.[b.data] : request?.hosts
    default:
      return undefined
  }
}

/**
 * Reconstruct the controller method's positional arguments from the validated
 * tool `input` (and the request stand-in for `@Req`/`@Headers`/...), then call
 * it. `applyParamPipes` controls whether parameter-bound pipes run.
 */
export async function invokeRebound(
  method: (...args: any[]) => any,
  instance: object,
  input: Record<string, unknown>,
  bindings: Binding[],
  request: RequestLike | undefined,
  applyParamPipes: boolean
): Promise<unknown> {
  const args: unknown[] = []
  for (let i = 0; i < bindings.length; i += 1) {
    args[i] = await resolveArg(bindings[i], input, request, applyParamPipes)
  }
  return await method.apply(instance, args)
}

/** Map a non-input parameter slot (`@Req`/`@Headers`/`@Ip`/...) to its runtime binding. */
export function specialBinding(paramtype: number, data: string | undefined): Binding | null {
  switch (paramtype) {
    case PARAMTYPE.REQUEST: return { kind: 'request' }
    case PARAMTYPE.RESPONSE:
    case PARAMTYPE.NEXT: return { kind: 'response' }
    case PARAMTYPE.HEADERS: return { kind: 'headers', data }
    case PARAMTYPE.IP: return { kind: 'ip' }
    case PARAMTYPE.HOST: return { kind: 'host', data }
    case PARAMTYPE.SESSION:
    case PARAMTYPE.FILE:
    case PARAMTYPE.FILES:
    case PARAMTYPE.RAW_BODY: return { kind: 'missing' }
    default: return null
  }
}
