import { SilkweaveContext } from '@silkweave/core'
import { AuthError, insufficientScope, invalidToken } from './errors.js'
import { buildWWWAuthenticate, extractBearerToken } from './extract.js'
import { AuthConfig, AuthInfo } from './types.js'

export interface ValidateResult {
  auth?: AuthInfo
  error?: {
    statusCode: number
    headers: Record<string, string>
    body: { error: string; error_description: string }
  }
}

export async function validateToken(
  authorizationHeader: string | null | undefined,
  config: AuthConfig,
  context: SilkweaveContext
): Promise<ValidateResult> {
  const required = config.required ?? true
  const resourceMetadataUrl = config.resourceUrl
    ? `${config.resourceUrl}/.well-known/oauth-protected-resource`
    : undefined

  const token = extractBearerToken(authorizationHeader)

  if (!token) {
    if (!required) { return {} }
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
  const expectedAudience = config.audience === false ? undefined : (config.audience ?? config.resourceUrl)
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

  return { auth: authInfo }
}

/**
 * True when the token's `aud` claim includes one of the expected values. A token
 * with no `aud` is allowed (the verifier may have bound the audience already);
 * a present-but-mismatched `aud` is rejected.
 */
function audienceMatches(tokenAud: unknown, expected: string | string[]): boolean {
  if (tokenAud === undefined || tokenAud === null) { return true }
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

function buildErrorResult(
  err: AuthError,
  resourceMetadataUrl?: string,
  scope?: string
): ValidateResult {
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
