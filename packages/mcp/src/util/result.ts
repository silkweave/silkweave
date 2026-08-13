import { EmbeddedResource, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  bytesToBase64,
  isTextMimeType,
  resourceBytes,
  resourceText,
  SilkweaveError,
  type ActionResource
} from '@silkweave/core'

// Web-standard (Node 18+ and edge/Workers) UTF-8 <-> base64 so this subpath,
// which @silkweave/edge imports, carries no Node-only crypto/Buffer dependency.
function utf8ToBase64(text: string): { base64: string; byteLength: number } {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return { base64: btoa(binary), byteLength: bytes.length }
}

function base64ToUtf8(base64: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

export function smartToolResult(data: string | object | object[]): CallToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data)
  const mimeType = typeof data === 'string' ? 'text/plain' : 'application/json'
  const ext = typeof data === 'string' ? 'txt' : 'json'
  if (text.length > 4096) {
    const uri = `mcp://toolResult/${crypto.randomUUID()}.${ext}`
    const { base64: blob, byteLength } = utf8ToBase64(text)
    return {
      content: [
        { type: 'text', text: `Received resource ${uri} with ${byteLength} bytes` },
        { type: 'resource', resource: { uri, mimeType, blob } }
      ]
    }
  } else {
    return {
      content: [{ type: 'text' as const, text }]
    }
  }
}

// Raster formats multimodal hosts (and the Claude API) actually render as
// images. Non-raster image/* (notably image/svg+xml) would break hosts that
// forward image blocks to a vision model, so SVG ships as a text resource.
const RASTER_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function normalizedMimeType(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase()
}

/**
 * Result formatter for resource results (an action returning `resource()`, a
 * `File`/`Blob`, or bare bytes - normalized by the caller via
 * `toActionResource()`). The mapping is mime-driven:
 *
 * - `description` (when set) ships first as a `text` content block, so the
 *   model knows what the artifact is without decoding it,
 * - raster `image/*` (png/jpeg/gif/webp) ⇒ an `image` block - multimodal
 *   hosts surface it to the model directly,
 * - `audio/*` ⇒ an `audio` block,
 * - text-based media types (JSON, markdown, XML/SVG, `text/*`) ⇒ an embedded
 *   resource with `text`,
 * - anything else (PDF, zip, ...) ⇒ an embedded resource with a base64 `blob`.
 */
export function resourceToolResult(res: ActionResource): CallToolResult {
  const content: CallToolResult['content'] = []
  if (res.description) {
    content.push({ type: 'text', text: res.description })
  }
  const mimeType = normalizedMimeType(res.mimeType)
  if (RASTER_IMAGE_TYPES.has(mimeType)) {
    content.push({ type: 'image', data: bytesToBase64(resourceBytes(res)), mimeType })
  } else if (mimeType.startsWith('audio/')) {
    content.push({ type: 'audio', data: bytesToBase64(resourceBytes(res)), mimeType })
  } else {
    const uri = `mcp://toolResult/${crypto.randomUUID()}${res.name ? `/${res.name}` : ''}`
    content.push({
      type: 'resource',
      resource: isTextMimeType(mimeType)
        ? { uri, mimeType: res.mimeType, text: resourceText(res) }
        : { uri, mimeType: res.mimeType, blob: bytesToBase64(resourceBytes(res)) }
    })
  }
  return { content }
}

/**
 * Result formatter for `disposition: 'structured'` actions: the (already
 * schema-parsed) data ships as `structuredContent` with a compact JSON text
 * mirror, per the spec's backwards-compat recommendation. Callers must pass
 * the OUTPUT-SCHEMA-PARSED data, not the raw result - parsing strips extra
 * fields, which is what keeps client-side JSON-Schema validation
 * (`additionalProperties: false`) passing by construction.
 */
export function structuredToolResult(data: object): CallToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>
  }
}

export function jsonToolResult(data: object, isError = false): CallToolResult {
  const result: CallToolResult = { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  if (isError) {
    result.isError = true
  }
  return result
}

export function errorToolResult({ code, name, message }: SilkweaveError): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({ success: false, code, name, message })
      }
    ]
  }
}

export function handleToolError(error: unknown): CallToolResult {
  if (error instanceof SilkweaveError) {
    return jsonToolResult({ success: false, name: error.name, message: error.message, code: error.code }, true)
  } else if (error instanceof Error) {
    // Log the full error (incl. stack) to stderr only - never put the stack trace
    // on the wire, where it would leak server internals to the MCP client.
    console.error(error)
    return jsonToolResult({ success: false, name: error.name, message: error.message }, true)
  } else {
    // Likewise keep the raw thrown value server-side - only a generic message goes out.
    console.error('Unknown tool error:', error)
    return jsonToolResult({ success: false, name: 'Unknown error', message: 'An unknown error occurred' }, true)
  }
}

export function parseResourceMessage({ resource }: EmbeddedResource) {
  const text = 'blob' in resource ? base64ToUtf8(resource.blob) : resource.text
  return text
}
