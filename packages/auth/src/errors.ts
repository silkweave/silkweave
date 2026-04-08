export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 401
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export function invalidToken(message = 'Invalid token') {
  return new AuthError(message, 'invalid_token', 401)
}

export function insufficientScope(message = 'Insufficient scope') {
  return new AuthError(message, 'insufficient_scope', 403)
}
