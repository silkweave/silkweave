import { HEADERS_METADATA } from '@nestjs/common/constants.js'
import { resource, type BinarySchemaMeta } from '@silkweave/core'
import type { ResourceMetadata } from './metadata.js'

/** The `@Header('Content-Type', ...)` value declared on a controller method, if any. */
export function reflectContentType(method: (...args: unknown[]) => unknown): string | undefined {
  const headers = (Reflect.getMetadata(HEADERS_METADATA, method) as { name?: string; value?: unknown }[] | undefined) ?? []
  const contentType = headers.find((header) => header.name?.toLowerCase() === 'content-type')
  return typeof contentType?.value === 'string' ? contentType.value : undefined
}

/**
 * Resolve a decorated route's resource metadata (the `binary()` schema meta of
 * the synthesized action). An explicit `resource` option always declares the
 * route a resource, with a reflected `@Header('Content-Type')` filling in a
 * missing `mimeType`. Without the option, a non-JSON Content-Type header alone
 * flips the route to resource delivery - an existing REST screenshot endpoint
 * (`@Header('Content-Type', 'image/png')`) then behaves correctly over MCP with
 * a bare `@Mcp()`. A JSON Content-Type stays on the normal JSON result path.
 */
export function resolveResourceMeta(
  option: ResourceMetadata | undefined,
  method: (...args: unknown[]) => unknown
): BinarySchemaMeta | undefined {
  const headerMime = reflectContentType(method)
  if (option) {
    const mimeType = option.mimeType ?? headerMime
    return {
      ...(mimeType ? { mimeType } : {}),
      ...(option.name ? { name: option.name } : {}),
      ...(option.description ? { description: option.description } : {})
    }
  }
  if (headerMime && headerMime.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return { mimeType: headerMime }
  }
  return undefined
}

interface StreamableFileLike {
  getStream: () => AsyncIterable<Uint8Array>
  getHeaders: () => Record<string, unknown>
  options?: { type?: string; disposition?: string }
}

/** Duck-typed `StreamableFile` check - no value import of `@nestjs/common` needed. */
function isStreamableFile(value: unknown): value is StreamableFileLike {
  return typeof value === 'object' && value !== null
    && typeof (value as StreamableFileLike).getStream === 'function'
    && typeof (value as StreamableFileLike).getHeaders === 'function'
}

function filenameFromDisposition(disposition: string | undefined): string | undefined {
  return disposition?.match(/filename="?([^";]+)"?/)?.[1]
}

/**
 * Normalize a controller method's return value for the synthesized action:
 * a Nest `StreamableFile` is collected into bytes (adapters cannot consume
 * its Node stream) - when its own `type`/`disposition` options are set they
 * win as an explicit `resource()`, otherwise bare bytes are returned so the
 * route's declared resource defaults (mime type, name) apply downstream.
 * Everything else (plain results, `resource()`, `File`/`Blob`, buffers)
 * passes through for the adapters' own normalization.
 */
export async function normalizeControllerResult(result: unknown): Promise<unknown> {
  if (!isStreamableFile(result)) { return result }
  const chunks: Uint8Array[] = []
  for await (const chunk of result.getStream()) {
    chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)
  }
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  const { type, disposition } = result.options ?? {}
  if (!type && !disposition) { return bytes }
  const name = filenameFromDisposition(disposition)
  return resource(bytes, {
    mimeType: type ?? 'application/octet-stream',
    ...(name ? { name } : {})
  })
}
