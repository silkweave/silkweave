import { defineMiddleware } from 'astro:middleware'

const MCP_PATHS = new Set<string>([
  '/mcp',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/authorize',
  '/token',
  '/register',
  '/auth/callback'
])

export const onRequest = defineMiddleware(async (context, next) => {
  if (MCP_PATHS.has(context.url.pathname)) {
    const { handler } = await import('./server/mcp.js')
    return handler(context.request)
  }
  return next()
})
