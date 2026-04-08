import { TextContent } from '@modelcontextprotocol/sdk/types.js'

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

export function parseToolResponse<T = unknown>(result: ToolResponse): T {
  const text = result.content[0].text
  return JSON.parse(text)
}
