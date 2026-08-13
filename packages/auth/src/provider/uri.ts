/**
 * Match a concrete `redirect_uri` against the operator's allow-list patterns.
 *
 * Matching is done per URL *component* (scheme, userinfo, host, port, path),
 * NOT by testing one glob-to-regex against the whole string. A naive
 * whole-string `*`->`.*` lets a wildcard cross authority delimiters, so
 * `https://*.example.com/cb` would match `https://attacker.com/x.example.com/cb`
 * and `http://localhost:*` would match `http://localhost:x@attacker.com/cb`
 * (userinfo injection) - both hand the auth code to an attacker host. Comparing
 * components defeats that: the target is parsed with the URL parser (so its host
 * is exactly its host), and a pattern with no userinfo rejects any target that
 * carries userinfo.
 */
export function matchRedirectUri(uri: string, patterns: string[]): boolean {
  let target: URL
  try {
    target = new URL(uri)
  } catch {
    return false
  }
  return patterns.some((pattern) => matchPattern(target, pattern))
}

/** Escape regex metacharacters, then expand `*` to `.*` (component-scoped). */
function componentRegex(part: string): RegExp {
  const escaped = part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

/**
 * A pattern may contain `*` in the host (`*.example.com`), the port
 * (`http://localhost:*`), or the path (`https://app.example.com/*`). The
 * concrete `uri` is always a valid URL. Split the pattern into
 * scheme / userinfo / host / (port + path) and match each against the target's
 * corresponding component. Because the port and path are matched as one tail,
 * a trailing `*` (e.g. loopback `http://localhost:*`) still spans any port and
 * path, as before - it just can no longer escape the authority.
 */
function matchPattern(target: URL, pattern: string): boolean {
  const parsed = /^([^:]+:)\/\/(?:([^@/]*)@)?([^/:?#]*)(.*)$/.exec(pattern)
  if (!parsed) {
    return false
  }
  const [, scheme, userinfo, host, tail] = parsed

  if (scheme !== target.protocol) {
    return false
  }

  // Userinfo: a pattern without userinfo must reject any target that carries it
  // (this is what blocks `localhost:x@attacker.com`). With userinfo, match it.
  const targetUserinfo = target.password ? `${target.username}:${target.password}` : target.username
  if (userinfo === undefined) {
    if (targetUserinfo !== '') {
      return false
    }
  } else if (!componentRegex(userinfo).test(targetUserinfo)) {
    return false
  }

  if (!componentRegex(host).test(target.hostname)) {
    return false
  }

  const targetTail = (target.port ? `:${target.port}` : '') + target.pathname + target.search + target.hash
  return componentRegex(tail).test(targetTail)
}
