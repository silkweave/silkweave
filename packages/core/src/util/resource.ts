/* eslint-disable @typescript-eslint/no-explicit-any */
import z from 'zod/v4'

// Symbol.for (not a private Symbol) so two copies of @silkweave/core in one
// process - e.g. a hoisted install plus a bundled copy - still recognize each
// other's resources.
const RESOURCE_BRAND = Symbol.for('silkweave.resource')
const BINARY_SCHEMA_BRAND = Symbol.for('silkweave.binarySchema')

/**
 * A binary or text artifact returned from an action - the adapter-agnostic
 * "resource" value. Adapters deliver it per transport: REST sends raw bytes
 * with `Content-Type`, MCP maps it to `image`/`audio`/embedded-resource content
 * blocks, tRPC serializes it to a JSON envelope (`SerializedResource`), and the
 * CLI writes bytes to stdout or a file. Create one with `resource()`, or return
 * a Web-Standard `File`/`Blob`/`Uint8Array` directly and let the adapter
 * normalize it via `toActionResource()`.
 */
export interface ActionResource {
  [RESOURCE_BRAND]: true
  /** Raw bytes, or the literal text for text-based payloads. */
  data: Uint8Array | string
  /** IANA media type, e.g. `image/png`, `application/json`, `text/markdown`. */
  mimeType: string
  /** File name hint (REST `Content-Disposition`, CLI output file, MCP resource URI). */
  name?: string
  /**
   * Human-readable description of the artifact. Over MCP this ships as a
   * leading `text` content block so the model knows what the resource is
   * without decoding it.
   */
  description?: string
}

/** Values adapters accept as a resource result without an explicit `resource()` wrapper. */
export type ResourceLike = ActionResource | Blob | Uint8Array | ArrayBuffer

export interface ResourceOptions {
  mimeType: string
  name?: string
  description?: string
}

/**
 * Wrap raw data as an `ActionResource`. `data` may be bytes
 * (`Uint8Array`/`ArrayBuffer`) or a string for text-based media types.
 *
 * ```ts
 * return resource(pngBytes, {
 *   mimeType: 'image/png',
 *   name: 'screenshot.png',
 *   description: `Screenshot of ${url}`
 * })
 * ```
 */
export function resource(data: Uint8Array | ArrayBuffer | string, options: ResourceOptions): ActionResource {
  return {
    [RESOURCE_BRAND]: true,
    data: data instanceof ArrayBuffer ? new Uint8Array(data) : data,
    ...options
  }
}

export function isActionResource(value: unknown): value is ActionResource {
  return typeof value === 'object' && value !== null && (value as any)[RESOURCE_BRAND] === true
}

/** Synchronous "could this result be a resource?" check (no Blob reads). */
export function isResourceLike(value: unknown): value is ResourceLike {
  return isActionResource(value)
    || value instanceof Uint8Array
    || value instanceof ArrayBuffer
    || (typeof Blob !== 'undefined' && value instanceof Blob)
}

/**
 * Normalize an action result to an `ActionResource`, or `undefined` when the
 * value is not resource-like (adapters then take their normal JSON path).
 * Accepts an `ActionResource`, a Web-Standard `File`/`Blob` (name/type read
 * from the object), or bare `Uint8Array`/`ArrayBuffer` bytes. `defaults`
 * (typically `binarySchemaMeta(action.output)`) fill in whatever the value
 * itself does not carry; the last-resort mime type is
 * `application/octet-stream`. Async because reading a Blob is async.
 */
export async function toActionResource(
  value: unknown,
  defaults: BinarySchemaMeta = {}
): Promise<ActionResource | undefined> {
  if (isActionResource(value)) { return value }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    const name = (typeof (value as File).name === 'string' ? (value as File).name : undefined) ?? defaults.name
    return resource(await value.arrayBuffer(), {
      mimeType: value.type || defaults.mimeType || 'application/octet-stream',
      ...(name ? { name } : {}),
      ...(defaults.description ? { description: defaults.description } : {})
    })
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return resource(value, {
      mimeType: defaults.mimeType ?? 'application/octet-stream',
      ...(defaults.name ? { name: defaults.name } : {}),
      ...(defaults.description ? { description: defaults.description } : {})
    })
  }
  return undefined
}

/**
 * Whether a media type is text-based - i.e. its payload is legible as UTF-8
 * text (`text/*`, JSON, XML/SVG, JavaScript, and the `+json`/`+xml` structured
 * syntax suffixes). Adapters use this to ship `text` instead of base64.
 */
export function isTextMimeType(mimeType: string): boolean {
  const type = mimeType.split(';')[0].trim().toLowerCase()
  return type.startsWith('text/')
    || type === 'application/json'
    || type === 'application/xml'
    || type === 'application/javascript'
    || type.endsWith('+json')
    || type.endsWith('+xml')
}

/** The resource's payload as bytes (text encoded as UTF-8). */
export function resourceBytes(res: ActionResource): Uint8Array {
  return typeof res.data === 'string' ? new TextEncoder().encode(res.data) : res.data
}

/** The resource's payload as text (bytes decoded as UTF-8). */
export function resourceText(res: ActionResource): string {
  return typeof res.data === 'string' ? res.data : new TextDecoder().decode(res.data)
}

// Web-standard (Node 18+ and edge/Workers) bytes <-> base64, so no adapter
// needs Buffer for resource handling.
export function bytesToBase64(bytes: Uint8Array): string {
  let raw = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    raw += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(raw)
}

export function base64ToBytes(base64: string): Uint8Array {
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) { bytes[i] = raw.charCodeAt(i) }
  return bytes
}

/**
 * The JSON wire shape of a resource on JSON-only transports (tRPC, typegen
 * types). Text-based media types carry `text`; everything else carries
 * `base64`. Exactly one of the two is set.
 */
export interface SerializedResource {
  kind: 'resource'
  mimeType: string
  name?: string
  description?: string
  text?: string
  base64?: string
}

export function serializeResource(res: ActionResource): SerializedResource {
  return {
    kind: 'resource',
    mimeType: res.mimeType,
    ...(res.name ? { name: res.name } : {}),
    ...(res.description ? { description: res.description } : {}),
    ...(isTextMimeType(res.mimeType)
      ? { text: resourceText(res) }
      : { base64: bytesToBase64(resourceBytes(res)) })
  }
}

/** Decode a `SerializedResource` back to an `ActionResource` (client-side helper). */
export function deserializeResource(serialized: SerializedResource): ActionResource {
  const { mimeType, name, description } = serialized
  return resource(serialized.text ?? base64ToBytes(serialized.base64 ?? ''), {
    mimeType,
    ...(name ? { name } : {}),
    ...(description ? { description } : {})
  })
}

/** Static metadata a `binary()` output schema carries for adapters to read. */
export interface BinarySchemaMeta {
  /** Default media type when the returned value carries none (bare bytes). */
  mimeType?: string
  /** Default file name when the returned value carries none. */
  name?: string
  /** Default description merged into normalized results. */
  description?: string
}

/**
 * The schema type `binary()` returns. Structurally a Zod schema over
 * `ResourceLike` values (so `output: binary(...)` slots into the existing
 * `Action.output` position), plus the silkweave metadata brand.
 */
export type BinarySchema = z.ZodType<ActionResource | Blob | Uint8Array | ArrayBuffer>
  & { shape: Record<string, z.ZodTypeAny> }
  & { [BINARY_SCHEMA_BRAND]: BinarySchemaMeta }

/**
 * Declare an action's output as a binary/text resource:
 *
 * ```ts
 * createAction({
 *   name: 'screenshot',
 *   input: z.object({ url: z.string() }),
 *   output: binary({ mimeType: 'image/png' }),
 *   run: async ({ url }) => resource(await capture(url), {
 *     mimeType: 'image/png',
 *     name: 'screenshot.png',
 *     description: `Screenshot of ${url}`
 *   })
 * })
 * ```
 *
 * The `run` may return an `ActionResource` (via `resource()`), a Web-Standard
 * `File`/`Blob`, or bare `Uint8Array`/`ArrayBuffer` bytes (then `mimeType`
 * here is the declared default). Adapters detect the schema via
 * `isBinarySchema()` and switch to binary delivery; `disposition:
 * 'structured'` is incompatible (there is no JSON outputSchema contract) and
 * rejected at registration.
 */
export function binary(meta: BinarySchemaMeta = {}): BinarySchema {
  const schema = z.custom<ActionResource | Blob | Uint8Array | ArrayBuffer>(
    (value) => isResourceLike(value),
    'Expected a resource(), File/Blob, Uint8Array, or ArrayBuffer result'
  )
  // `Action.output` structurally requires a `shape`; a binary output has no
  // object members, so an empty shape keeps the constraint satisfied while
  // `isBinarySchema()` lets consumers (typegen, tRPC, OpenAPI) special-case it
  // before ever iterating members.
  return Object.assign(schema as any, { shape: {}, [BINARY_SCHEMA_BRAND]: meta }) as BinarySchema
}

export function isBinarySchema(schema: unknown): schema is BinarySchema {
  return typeof schema === 'object' && schema !== null && (schema as any)[BINARY_SCHEMA_BRAND] !== undefined
}

/** The `binary()` metadata of an action's output schema, or `{}` when not binary. */
export function binarySchemaMeta(schema: unknown): BinarySchemaMeta {
  return isBinarySchema(schema) ? (schema as any)[BINARY_SCHEMA_BRAND] as BinarySchemaMeta : {}
}
