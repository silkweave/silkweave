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

  if (config.requiredScopes?.length) {
    const scopes = authInfo.scopes ?? []
    const hasAll = config.requiredScopes.every((s) => scopes.includes(s))
    if (!hasAll) {
      const err = insufficientScope()
      return buildErrorResult(err, resourceMetadataUrl)
    }
  }

  return { auth: authInfo }
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
  resourceMetadataUrl?: string
): ValidateResult {
  return {
    error: {
      statusCode: err.statusCode,
      headers: {
        'WWW-Authenticate': buildWWWAuthenticate(err.code, err.message, resourceMetadataUrl),
        'Content-Type': 'application/json'
      },
      body: { error: err.code, error_description: err.message }
    }
  }
}
