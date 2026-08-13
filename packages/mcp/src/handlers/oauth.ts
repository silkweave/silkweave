import { AuthConfig, OAuthRequest, OAuthResponse } from '@silkweave/auth'
import express, { type Request, type RequestHandler, type Response } from 'express'

function toOAuthReq(req: Request): OAuthRequest {
  return {
    method: req.method,
    url: new URL(req.url, `${req.protocol}://${req.get('host')}`),
    headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])),
    body: req.body as Record<string, string> | undefined
  }
}

function sendOAuth(res: Response, oauthRes: OAuthResponse) {
  for (const [key, value] of Object.entries(oauthRes.headers)) {
    res.header(key, value)
  }
  if (oauthRes.body) {
    res.status(oauthRes.status).send(typeof oauthRes.body === 'string' ? oauthRes.body : JSON.stringify(oauthRes.body))
  } else {
    res.status(oauthRes.status).end()
  }
}

export interface OAuthRouteHandlers {
  /** `GET /.well-known/oauth-authorization-server` - RFC 8414 discovery. */
  wellKnownAuthServer: RequestHandler
  /** `GET /authorize` - start the OAuth flow. */
  authorize: RequestHandler
  /** `GET {callbackPath}` - provider callback. */
  callback: RequestHandler
  /** Path the provider should redirect to (defaults to `/auth/callback`). */
  callbackPath: string
  /** `POST /token` - exchange code / refresh token. Includes urlencoded body parser. */
  token: RequestHandler[]
  /** `POST /register` - dynamic client registration. Includes JSON body parser. */
  register: RequestHandler[]
}

/**
 * Build the OAuth 2.1 proxy route handlers (authorize, callback, token,
 * register, well-known) backed by the configured `auth.provider`. Returns the
 * handlers as individual `RequestHandler`s so callers can register them
 * wherever they like - under `/mcp`, at the server root, etc.
 *
 * `token` and `register` are returned as middleware arrays because the
 * appropriate body parser must run before the handler. Apply with
 * `app.post(path, ...token)`.
 */
export function oauthRoutes(auth: AuthConfig): OAuthRouteHandlers {
  if (!auth.provider) {
    throw new Error('@silkweave/mcp oauthRoutes(): auth.provider is required')
  }
  const provider = auth.provider
  const callbackPath = auth.callbackPath ?? '/auth/callback'

  return {
    callbackPath,
    wellKnownAuthServer: (_req, res) => {
      sendOAuth(res, provider.metadata())
    },
    authorize: async (req, res) => {
      sendOAuth(res, await provider.authorize(toOAuthReq(req)))
    },
    callback: async (req, res) => {
      sendOAuth(res, await provider.callback(toOAuthReq(req)))
    },
    token: [
      express.urlencoded({ extended: false }),
      async (req, res) => {
        sendOAuth(res, await provider.token(toOAuthReq(req)))
      }
    ],
    register: [
      express.json(),
      async (req, res) => {
        sendOAuth(res, await provider.register(toOAuthReq(req)))
      }
    ]
  }
}
