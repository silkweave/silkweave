export function extractBearerToken(header: string | null | undefined): string | null {
  if (!header) { return null }
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1] ?? null
}

export function buildWWWAuthenticate(
  error?: string,
  description?: string,
  resourceMetadataUrl?: string
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
  return parts.length > 0 ? `Bearer ${parts.join(', ')}` : 'Bearer'
}
