// MCP over HTTP with the app as its own OAuth 2.1 authorization server.
//
// No upstream IdP: the person signs in to "the app" (a toy session on :8081),
// approves the connection on its consent page, and the MCP client (Claude Code,
// Claude Desktop / claude.ai, Codex, MCP Inspector) gets tokens bound to that
// person. Connect a client to http://localhost:8080/mcp with no other config.
//
//   pnpm -F @silkweave/example-mcp http-local-oauth
//   claude mcp add --transport http local-oauth http://localhost:8080/mcp

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { AuthConfig, AuthInfo } from '@silkweave/auth'
import { createMemoryStore, createOAuthServer } from '@silkweave/auth/oauth'
import { createAction, silkweave } from '@silkweave/core'
import { http } from '@silkweave/mcp/server'
import z from 'zod/v4'

const MCP_ORIGIN = 'http://localhost:8080'
const APP_ORIGIN = 'http://localhost:8081'

// Grants the person revoked from "Connected apps" - consulted on every token
// verification and refresh, so revocation is immediate.
const revokedGrants = new Set<string>()

const oauth = createOAuthServer({
  resourceUrl: MCP_ORIGIN,
  redirectUris: ['http://localhost:*', 'http://127.0.0.1:*', 'https://claude.ai/*', 'https://claude.com/*'],
  signingKey: 'local-oauth-example-signing-key-change-me',
  store: createMemoryStore(),
  isGrantActive: ({ grantId }) => !revokedGrants.has(grantId),
  // Hand the browser to the app's consent page, binding the pending request to
  // this browser with a short-lived cookie (cookies ignore the port, so the
  // app on :8081 sees it).
  onAuthorize: (pending) => ({
    status: 302,
    headers: {
      Location: `${APP_ORIGIN}/connect?request=${encodeURIComponent(pending.id)}`,
      'Set-Cookie': `connect_request=${pending.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`
    },
    body: undefined
  })
})

const auth: AuthConfig = {
  verifyToken: (token) => oauth.verifyToken(token),
  required: true,
  resourceUrl: MCP_ORIGIN,
  authorizationServers: [MCP_ORIGIN],
  provider: oauth
}

const WhoAmI = createAction({
  name: 'whoami',
  kind: 'query',
  description: 'Return the person and connection (grant) this MCP session is authorized as',
  input: z.object({}),
  run: async (_input, context) => {
    const info = context.get<AuthInfo>('auth')
    return { sub: info.sub, client: info.oauthClientId, grant: info.grantId, scopes: info.scopes }
  }
})

// ---- the "app": a toy session + consent page --------------------------------

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function cookies(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (req.headers.cookie ?? '').split(';').flatMap((part) => {
      const [key, ...rest] = part.trim().split('=')
      return key ? [[key, decodeURIComponent(rest.join('='))]] : []
    })
  )
}

async function form(req: IncomingMessage): Promise<URLSearchParams> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
  }
  return new URLSearchParams(raw)
}

function page(res: ServerResponse, html: string): void {
  // frame-ancestors 'none': an Allow button must never be clickjackable.
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "frame-ancestors 'none'"
  })
  res.end(
    `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:32rem;margin:3rem auto">${html}`
  )
}

const app = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', APP_ORIGIN)
  const session = cookies(req).session
  const requestId = url.searchParams.get('request') ?? ''

  if (url.pathname === '/login' && req.method === 'POST') {
    const name = (await form(req)).get('name')?.trim() || 'demo'
    res.writeHead(303, {
      Location: `/connect?request=${encodeURIComponent(requestId)}`,
      'Set-Cookie': `session=${encodeURIComponent(name)}; Path=/; HttpOnly; SameSite=Lax`
    })
    res.end()
    return
  }

  if (url.pathname === '/connect' && req.method === 'GET') {
    const pending = await oauth.pending(requestId)
    if (!pending || cookies(req).connect_request !== requestId) {
      page(res, '<p>This connection request is unknown, expired, or was opened in another browser.</p>')
      return
    }
    if (!session) {
      page(
        res,
        `<h2>Sign in</h2><form method="post" action="/login?request=${encodeURIComponent(requestId)}">
          <input name="name" placeholder="your name" autofocus> <button>Sign in</button></form>`
      )
      return
    }
    const who = pending.clientName ? escapeHtml(pending.clientName) : 'An application'
    const verified = pending.clientKind === 'cimd' ? '' : ' <em>(unverified)</em>'
    page(
      res,
      `<h2>Connect as ${escapeHtml(session)}?</h2>
       <p><strong>${who}</strong>${verified} wants to use this server's tools as you.
       It will return to <code>${escapeHtml(pending.redirectHost)}</code>.</p>
       <form method="post" action="/consent?request=${encodeURIComponent(requestId)}">
         <button name="decision" value="allow">Allow</button>
         <button name="decision" value="deny">Deny</button>
       </form>`
    )
    return
  }

  if (url.pathname === '/consent' && req.method === 'POST') {
    // Only the browser that opened the request, signed in, may decide it. A real
    // app also checks its CSRF token here (a form post is cross-site-able).
    if (!session || cookies(req).connect_request !== requestId) {
      res.writeHead(403).end('Forbidden')
      return
    }
    const decision = (await form(req)).get('decision')
    const result = decision === 'allow' ? await oauth.approve(requestId, { sub: session }) : await oauth.deny(requestId)
    if (!result) {
      page(res, '<p>This connection request is unknown, expired, or already decided.</p>')
      return
    }
    res.writeHead(303, { Location: result.redirectTo, 'Set-Cookie': 'connect_request=; Path=/; Max-Age=0' })
    res.end()
    return
  }

  res.writeHead(404).end('Not found')
})

async function main() {
  await new Promise<void>((resolve) => app.listen(8081, 'localhost', resolve))
  console.log(`Consent app listening on ${APP_ORIGIN}`)
  await silkweave({ name: 'silkweave-local-oauth', description: 'Silkweave as its own OAuth server', version: '1.0.0' })
    .adapter(http({ host: 'localhost', port: 8080, allowedHosts: ['localhost'], auth }))
    .action(WhoAmI)
    .start()
}

main()
