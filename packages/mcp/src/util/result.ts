import { EmbeddedResource, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { SilkweaveError } from '@silkweave/core'
import { randomUUID } from 'node:crypto'

export function smartToolResult(data: string | object | object[]): CallToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data)
  const mimeType = typeof data === 'string' ? 'text/plain' : 'application/json'
  const ext = typeof data === 'string' ? 'txt' : 'json'
  if (text.length > 4096) {
    const uri = `mcp://toolResult/${randomUUID()}.${ext}`
    const buffer = Buffer.from(text)
    const blob = buffer.toString('base64')
    return {
      content: [
        { type: 'text', text: `Received resource ${uri} with ${buffer.byteLength} bytes` },
        { type: 'resource', resource: { uri, mimeType, blob } }
      ]
    }
  } else {
    return {
      content: [{ type: 'text' as const, text }]
    }
  }
}

export function jsonToolResult(data: object, isError = false): CallToolResult {
  const result: CallToolResult = { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
  if (isError) { result.isError = true }
  return result
}

export function errorToolResult({ code, name, message }: SilkweaveError): CallToolResult {
  return {
    isError: true,
    content: [{
      type: 'text',
      text: JSON.stringify({ success: false, code, name, message })
    }]
  }
}

export function handleToolError(error: unknown): CallToolResult {
  if (error instanceof SilkweaveError) {
    return jsonToolResult({ success: false, name: error.name, message: error.message, code: error.code }, true)
  } else if (error instanceof Error) {
    return jsonToolResult({ success: false, name: error.name, message: error.message, stack: error.stack }, true)
  } else {
    return jsonToolResult({ success: false, name: 'Unknown error', message: 'An unknown error occurred', error }, true)
  }
}

export function parseResourceMessage({ resource }: EmbeddedResource) {
  const text = ('blob' in resource) ? Buffer.from(resource.blob, 'base64').toString('utf-8') : resource.text
  return text
}
