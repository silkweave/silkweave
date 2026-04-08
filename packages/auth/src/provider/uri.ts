export function matchRedirectUri(uri: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const regex = patternToRegex(pattern)
    return regex.test(uri)
  })
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}
