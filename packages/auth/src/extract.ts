export function extractBearerToken(header: string | null | undefined): string | null {
  if (!header) {
    return null
  }
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1] ?? null
}

export function buildWWWAuthenticate(
  error?: string,
  description?: string,
  resourceMetadataUrl?: string,
  scope?: string
): string {
  const parts: string[] = []
  if (error) {
    parts.push(`error="${error}"`)
  }
  if (description) {
    parts.push(`error_description="${description}"`)
  }
  if (resourceMetadataUrl) {
    parts.push(`resource_metadata="${resourceMetadataUrl}"`)
  }
  // The scopes the client must obtain to step up (RFC 9470 / SEP-2350).
  if (scope) {
    parts.push(`scope="${scope}"`)
  }
  return parts.length > 0 ? `Bearer ${parts.join(', ')}` : 'Bearer'
}
