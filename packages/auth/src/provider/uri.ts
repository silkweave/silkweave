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
  // RFC 6749 §3.1.2: a redirection endpoint MUST NOT include a fragment.
  if (uri.includes('#')) {
    return false
  }
  let target: URL
  try {
    target = new URL(uri)
  } catch {
    return false
  }
  if (patterns.some((pattern) => matchPattern(target, pattern))) {
    return true
  }
  // A port-less loopback redirect (`http://127.0.0.1/callback`, RFC 8252 style -
  // Codex's CIMD document lists these) stands for "whatever port the client
  // binds at sign-in", so it must satisfy an any-port pattern such as
  // `http://127.0.0.1:*`. Re-test it with a concrete port; exact patterns
  // without a port already matched above.
  if (isLoopbackHttp(target) && target.port === '') {
    const withPort = new URL(target.href)
    withPort.port = '65535'
    return patterns.some((pattern) => pattern.includes(':*') && matchPattern(withPort, pattern))
  }
  return false
}

function isLoopbackHttp(url: URL): boolean {
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname) && !url.username && !url.password
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

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost'])

/**
 * Match a `redirect_uri` presented at /authorize against a client's registered
 * redirect URIs. Exact string match, except for loopback redirects (RFC 8252
 * §7.3): native clients (Claude Code, Codex, desktop apps) bind whichever port
 * is free at sign-in time, so an `http` loopback URI matches a registered one
 * that differs only in port. Scheme, host, path and query must still be equal -
 * `localhost` and `127.0.0.1` are not interchangeable.
 */
export function matchRegisteredRedirectUri(uri: string, registered: string[]): boolean {
  if (uri.includes('#')) {
    return false
  }
  if (registered.includes(uri)) {
    return true
  }
  let target: URL
  try {
    target = new URL(uri)
  } catch {
    return false
  }
  if (!isLoopbackHttp(target)) {
    return false
  }
  return registered.some((candidate) => {
    let reg: URL
    try {
      reg = new URL(candidate)
    } catch {
      return false
    }
    return (
      reg.protocol === 'http:' &&
      reg.hostname === target.hostname &&
      !reg.username &&
      !reg.password &&
      reg.pathname === target.pathname &&
      reg.search === target.search
    )
  })
}
