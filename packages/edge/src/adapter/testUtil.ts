// Test-only helper (not a build entry). The SDK's 2025-era legacy leg always
// answers over SSE, while the raw JSON-RPC suites assert on JSON bodies: unwrap
// an SSE response into a JSON Response carrying its last `data:` message.
export function jsonFromSse<A extends { handler: (request: Request) => Promise<Response> }>(app: A): A {
  return {
    ...app,
    handler: async (request: Request) => {
      const response = await app.handler(request)
      if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        return response
      }
      const data = (await response.text())
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter(Boolean)
        .pop()
      return new Response(data ?? 'null', {
        status: response.status,
        headers: { 'content-type': 'application/json' }
      })
    }
  }
}
