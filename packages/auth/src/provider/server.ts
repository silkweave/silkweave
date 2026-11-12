import {
  AuthorizationCore,
  AuthorizationServerConfig,
  createAuthorizationCore,
  errorResponse,
  randomToken,
  redirectResponse,
  takePendingAuth
} from './core.js'
import { OAuthStore, PendingAuthData } from './store.js'
import { AuthInfo, OAuthProvider, OAuthRequest, OAuthResponse } from './types.js'

/** A validated authorization request waiting for the person's decision - what a consent page shows. */
export interface PendingAuthorization {
  /** Opaque id (32 random bytes, base64url). Pass it to `pending`/`approve`/`deny`. */
  id: string
  clientId: string
  /**
   * The client's self-declared name. Attacker-chosen for `dcr` clients: render
   * it escaped and label it unverified.
   */
  clientName?: string
  /**
   * How the client identified itself: `cimd` - `clientId` is an https URL whose
   * metadata document was fetched (the host is meaningful); `dcr` - registered
   * anonymously via dynamic client registration (nothing about it is verified).
   */
  clientKind: 'cimd' | 'dcr'
  /**
   * For `cimd` clients, the host serving the client's metadata document (e.g.
   * `claude.ai`) - the verified identity to show. `clientName` is self-asserted
   * even for CIMD clients. Undefined for `dcr` clients.
   */
  clientHost?: string
  /** Where the browser returns after the decision. */
  redirectUri: string
  /** Host of `redirectUri` - the most honest "who gets access" signal for a DCR client. */
  redirectHost: string
  scopes: string[]
  /** RFC 8707 resource the token will be minted for (multi-resource servers only). */
  resource?: string
  /** Epoch seconds; the request is dead after this (10 minutes after /authorize). */
  expiresAt: number
}

/** The authenticated subject an approval binds the grant to. */
export interface ApprovedIdentity {
  /** Your user id. Becomes the access token's `sub` and `GrantRef.sub`. */
  sub: string
  email?: string
}

export interface OAuthServerConfig extends AuthorizationServerConfig {
  /**
   * Called once /authorize has validated the client's request (client, redirect
   * URI, PKCE, resource) and stored it as pending. Return where to send the
   * browser - your consent page, carrying `pending.id` - or a full
   * `OAuthResponse` to also set headers on that redirect, e.g. a short-lived
   * cookie binding the request to this browser so a forwarded consent URL
   * cannot be approved by someone else.
   */
  onAuthorize: (
    pending: PendingAuthorization,
    req: OAuthRequest
  ) => string | OAuthResponse | Promise<string | OAuthResponse>
  /** Advertised in metadata as `scopes_supported`. */
  scopesSupported?: string[]
}

/** The result of a consent decision: send the browser here (`window.location = redirectTo`). */
export interface ConsentResult {
  redirectTo: string
}

/** An OAuth provider for an app that is its own identity provider. */
export interface OAuthServer extends OAuthProvider {
  /** Look up a pending request for the consent page. `undefined` once decided or expired. */
  pending(id: string): Promise<PendingAuthorization | undefined>
  /**
   * Approve a pending request for an authenticated subject: mints the
   * authorization code and returns the client redirect (`code`, `state`, `iss`).
   * Single use; `undefined` when the request is unknown, already decided or
   * expired. Call it only from a signed-in browser session after the person
   * explicitly allowed it, behind your CSRF protection.
   */
  approve(id: string, identity: ApprovedIdentity): Promise<ConsentResult | undefined>
  /** Deny a pending request: returns the client redirect carrying `error` (default `access_denied`). Single use. */
  deny(id: string, opts?: { error?: string; description?: string }): Promise<ConsentResult | undefined>
}

/**
 * OAuth 2.1 authorization server for an app that is its own identity provider:
 * the person authenticates with your existing session (cookie, login page) on
 * your own consent page - no upstream IdP, no callback route. MCP clients
 * (Claude Code, Claude Desktop / claude.ai connectors, Codex) connect with just
 * the server URL: discovery, dynamic client registration or CIMD, PKCE, refresh
 * rotation with replay detection, and RFC 8707 resource indicators are all
 * handled here, identically to `createOAuthProxy`.
 *
 * Flow: the client hits `/authorize` → `onAuthorize` sends the browser to your
 * consent page with the pending id → the page shows `pending(id)` → on Allow
 * your backend calls `approve(id, { sub })` and the page navigates to
 * `redirectTo` → the client redeems the code at `/token`. Mount it as
 * `auth.provider` on any adapter, exactly like the proxy.
 */
async function loadPending(store: OAuthStore, id: string): Promise<PendingAuthData | undefined> {
  if (!id) {
    return undefined
  }
  const pending = await store.getPendingAuth(id)
  if (!pending || pending.expiresAt < Date.now() / 1000) {
    return undefined
  }
  return pending
}

async function describePending(store: OAuthStore, id: string, pending: PendingAuthData): Promise<PendingAuthorization> {
  const client = await store.getClient(pending.clientId)
  return {
    id,
    clientId: pending.clientId,
    clientName: client?.clientName,
    clientKind: pending.clientId.startsWith('https://') ? 'cimd' : 'dcr',
    clientHost: pending.clientId.startsWith('https://') ? new URL(pending.clientId).host : undefined,
    redirectUri: pending.redirectUri,
    redirectHost: new URL(pending.redirectUri).host,
    scopes: pending.scope.split(' ').filter(Boolean),
    resource: pending.resource,
    expiresAt: pending.expiresAt
  }
}

/** Validate /authorize, store the request as pending, and hand the browser to the app. */
async function authorizeToConsent(
  core: AuthorizationCore,
  config: OAuthServerConfig,
  req: OAuthRequest
): Promise<OAuthResponse> {
  const validated = await core.validateAuthorize(req)
  if ('status' in validated) {
    return validated
  }
  const id = randomToken()
  await core.store.savePendingAuth(id, validated.pending)
  const next = await config.onAuthorize(await describePending(core.store, id, validated.pending), req)
  return typeof next === 'string' ? redirectResponse(next) : next
}

export function createOAuthServer(config: OAuthServerConfig): OAuthServer {
  const core = createAuthorizationCore(config, { scopesSupported: config.scopesSupported })
  const { store } = core

  return {
    metadata: core.metadata,
    register: core.register,

    authorize: (req) => authorizeToConsent(core, config, req),

    // There is no upstream leg: the consent decision arrives via approve/deny.
    async callback(): Promise<OAuthResponse> {
      return errorResponse(404, 'not_found', 'This authorization server has no callback endpoint')
    },

    token: core.token,

    verifyToken(token): Promise<AuthInfo | undefined> {
      return core.verifyToken(token)
    },

    async pending(id) {
      const pending = await loadPending(store, id)
      return pending ? describePending(store, id, pending) : undefined
    },

    async approve(id, identity) {
      if (!identity?.sub) {
        throw new Error('approve() requires an identity with a sub')
      }
      const pending = await takePendingAuth(store, id)
      if (!pending) {
        return undefined
      }
      return { redirectTo: await core.issueCode(pending, identity) }
    },

    async deny(id, opts = {}) {
      const pending = await takePendingAuth(store, id)
      if (!pending) {
        return undefined
      }
      return { redirectTo: core.errorRedirect(pending, opts.error ?? 'access_denied', opts.description) }
    }
  }
}
