import { SilkweaveContext } from '@silkweave/core'
import { AuthError, insufficientScope, invalidToken } from './errors.js'
import { buildWWWAuthenticate, extractBearerToken } from './extract.js'
import { protectedResourceMetadataUrl, resolveResourceUrl } from './resolve.js'
import { AuthConfig, AuthInfo } from './types.js'

export interface ValidateResult {
  auth?: AuthInfo
  /**
   * The protected resource identifier this request resolved to (see
   * `AuthConfig.resourceUrl`). Adapters fork this onto the action context under
   * `resource`, so a multi-tenant server can authorize per tenant without
   * re-parsing the request URL.
   *
   * Note this is *where the token may be presented*, never *what the subject may
   * do there* - see the `allowedResources` docs. Treating a matching resource as
   * an access grant is a privilege escalation.
   */
  resource?: string
  error?: {
    statusCode: number
    headers: Record<string, string>
    body: { error: string; error_description: string }
  }
}

/**
 * The RFC 9728 metadata URL advertised in a `WWW-Authenticate` challenge.
 *
 * String configs keep the historical **append** form. For a path-less resource
 * the two forms coincide, and for a path'd one (e.g. the nestjs adapter's
 * basePath mount) switching to insertion would advertise a URL nobody serves.
 * Resolver-resolved resources always carry a path, so they get RFC 9728's
 * **insertion** form - which is also what the MCP SDK probes when no challenge
 * header is in hand.
 */
function challengeUrl(config: AuthConfig, resource: string | undefined): string | undefined {
  if (typeof config.resourceUrl === 'string') {
    return `${config.resourceUrl}/.well-known/oauth-protected-resource`
  }
  return resource ? protectedResourceMetadataUrl(resource) : undefined
}

export async function validateToken(
  authorizationHeader: string | null | undefined,
  config: AuthConfig,
  context: SilkweaveContext
): Promise<ValidateResult> {
  const required = config.required ?? true
  const resource = resolveResourceUrl(config, context)
  const resourceMetadataUrl = challengeUrl(config, resource)

  const token = extractBearerToken(authorizationHeader)

  if (!token) {
    if (!required) {
      return {}
    }
    return buildChallengeResult(resourceMetadataUrl)
  }

  let authInfo: AuthInfo | undefined
  try {
    authInfo = await config.verifyToken(token, context)
  } catch (error) {
    const err = invalidToken(error instanceof Error ? error.message : 'Invalid token')
    return buildErrorResult(err, resourceMetadataUrl)
  }

  if (!authInfo) {
    const err = invalidToken()
    return buildErrorResult(err, resourceMetadataUrl)
  }

  if (authInfo.expiresAt && authInfo.expiresAt < Date.now() / 1000) {
    const err = invalidToken('Token has expired')
    return buildErrorResult(err, resourceMetadataUrl)
  }

  // Issuer binding (RFC 9207 / SEP-2468): reject a token minted by an
  // authorization server other than the expected one.
  if (config.issuer && typeof authInfo.iss === 'string' && authInfo.iss !== config.issuer) {
    return buildErrorResult(invalidToken('Token issuer mismatch'), resourceMetadataUrl)
  }

  // Audience binding (RFC 8707 / SEP-2352): reject a token whose `aud` does not
  // include this resource - the resource-server confused-deputy defence.
  //
  // When a resolver returns `undefined` (the request URL is not a recognized
  // resource) this behaves exactly as an unset `resourceUrl` does today: no
  // *default* audience check, though an explicit `config.audience` still
  // applies. Fail-open is deliberate - adapters guard non-resource routes too
  // (sideload `/resource/:id`), and failing closed there would 401 every
  // sideload fetch.
  const expectedAudience = config.audience === false ? undefined : (config.audience ?? resource)
  if (expectedAudience !== undefined && !audienceMatches(authInfo.aud, expectedAudience)) {
    return buildErrorResult(invalidToken('Token audience mismatch'), resourceMetadataUrl)
  }

  if (config.requiredScopes?.length) {
    const scopes = authInfo.scopes ?? []
    const hasAll = config.requiredScopes.every((s) => scopes.includes(s))
    if (!hasAll) {
      // Advertise the scopes to step up to (SEP-2350).
      return buildErrorResult(insufficientScope(), resourceMetadataUrl, config.requiredScopes.join(' '))
    }
  }

  return { auth: authInfo, ...(resource !== undefined ? { resource } : {}) }
}

/**
 * True when the token's `aud` claim includes one of the expected values. A token
 * with no `aud` is allowed (the verifier may have bound the audience already);
 * a present-but-mismatched `aud` is rejected.
 */
function audienceMatches(tokenAud: unknown, expected: string | string[]): boolean {
  if (tokenAud === undefined || tokenAud === null) {
    return true
  }
  const have = Array.isArray(tokenAud) ? tokenAud : [tokenAud]
  const want = Array.isArray(expected) ? expected : [expected]
  return have.some((a) => want.includes(a as string))
}

function buildChallengeResult(resourceMetadataUrl?: string): ValidateResult {
  return {
    error: {
      statusCode: 401,
      headers: {
        'WWW-Authenticate': buildWWWAuthenticate(undefined, undefined, resourceMetadataUrl),
        'Content-Type': 'application/json'
      },
      body: { error: 'missing_token', error_description: 'No authorization provided' }
    }
  }
}

function buildErrorResult(err: AuthError, resourceMetadataUrl?: string, scope?: string): ValidateResult {
  return {
    error: {
      statusCode: err.statusCode,
      headers: {
        'WWW-Authenticate': buildWWWAuthenticate(err.code, err.message, resourceMetadataUrl, scope),
        'Content-Type': 'application/json'
      },
      body: { error: err.code, error_description: err.message }
    }
  }
}
