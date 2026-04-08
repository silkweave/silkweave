import { TextContent } from '@modelcontextprotocol/sdk/types.js'
import { SilkweaveError } from './error.js'

export interface ToolResponse {
  content: TextContent[]
  isError?: boolean
  [x: string]: unknown
}

export function toolResponse(data: object, isError = false): ToolResponse {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {})
  }
}

export function handleToolError(error: unknown): ToolResponse {
  if (error instanceof SilkweaveError) {
    return toolResponse({ success: false, code: error.code, name: error.name, message: error.message }, true)
  } else if (error instanceof Error) {
    return toolResponse({ success: false, name: error.name, message: error.message, stack: error.stack }, true)
  } else {
    return toolResponse({ success: false, name: 'Unknown Error', message: 'An unknown error occurred', error }, true)
  }
}

export function parseToolResponse<T = unknown>(result: ToolResponse): T {
  const text = result.content[0].text
  return JSON.parse(text)
}
