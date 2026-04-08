export interface AuthInfo {
  token: string
  clientId?: string
  scopes?: string[]
  expiresAt?: number
  [key: string]: unknown
}

export interface OAuthRequest {
  method: string
  url: URL
  headers: Record<string, string | undefined>
  body?: Record<string, string>
}

export interface OAuthResponse {
  status: number
  headers: Record<string, string>
  body?: string | Record<string, unknown>
}

export interface OAuthProvider {
  authorize(req: OAuthRequest): Promise<OAuthResponse>
  callback(req: OAuthRequest): Promise<OAuthResponse>
  token(req: OAuthRequest): Promise<OAuthResponse>
  register(req: OAuthRequest): Promise<OAuthResponse>
  metadata(): OAuthResponse
  verifyToken(token: string): Promise<AuthInfo | undefined>
}
