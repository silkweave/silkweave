/**
 * Normalize a user-supplied mount path: ensure a single leading slash and no
 * trailing slash. `'api/mcp/'` -> `'/api/mcp'`, `'/'` -> `''`.
 */
export function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.trim().replace(/\/+$/, '')
  if (trimmed === '' || trimmed === '/') { return '' }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/**
 * Rewrite a Web `Request`'s URL so the inner `@silkweave/vercel` MCP handler -
 * which matches absolute pathnames (`/mcp`, `/authorize`, `/.well-known/...`) -
 * sees canonical paths regardless of where the Next.js route is mounted.
 *
 * Given `basePath = '/api/mcp'`:
 *   `/api/mcp`                              -> `/mcp`   (the transport root)
 *   `/api/mcp/authorize`                    -> `/authorize`
 *   `/api/mcp/.well-known/oauth-...`        -> `/.well-known/oauth-...`
 *
 * The method, headers, body and abort signal are preserved. A streaming body
 * requires `duplex: 'half'` under Node's undici `fetch` implementation.
 */
export function rewriteRequestPath(request: Request, basePath: string, fallback = '/mcp'): Request {
  const base = normalizeBasePath(basePath)
  const url = new URL(request.url)

  let rest = url.pathname
  if (base !== '') {
    if (rest === base) {
      rest = fallback
    } else if (rest.startsWith(`${base}/`)) {
      rest = rest.slice(base.length)
    }
  }
  if (rest === '' || rest === '/') { rest = fallback }
  url.pathname = rest

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers: request.headers,
    signal: request.signal
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
    init.duplex = 'half'
  }
  return new Request(url.toString(), init)
}
