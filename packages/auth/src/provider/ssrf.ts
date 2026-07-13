/**
 * Best-effort SSRF guard for the Client ID Metadata Document (CIMD) fetch. An
 * unknown `client_id` that is an `https://` URL is fetched by the proxy, so an
 * attacker could point it at internal services or a cloud metadata endpoint
 * (`https://169.254.169.254/...`). This blocks the high-value targets without
 * pulling in `node:dns` (the OAuth proxy also runs on edge/Workers).
 *
 * Coverage and residual risk: IP-literal hosts in private/loopback/link-local/
 * reserved ranges and `localhost` are rejected synchronously; a *hostname* that
 * resolves to a private IP is NOT caught here (no DNS at this layer). Callers
 * MUST additionally disallow redirects and set a timeout on the fetch. Deployments
 * with strict internal-network requirements should enforce egress policy at the
 * network layer.
 */
export function assertSafeMetadataUrl(raw: string): { ok: true } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'invalid URL' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'must be https' }
  }
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return { ok: false, reason: 'loopback host' }
  }
  if (isBlockedIpLiteral(host)) {
    return { ok: false, reason: 'private or reserved address' }
  }
  return { ok: true }
}

function isBlockedIpLiteral(host: string): boolean {
  // URL.hostname keeps IPv6 literals in brackets (`[::1]`); strip them first.
  if (host.startsWith('[') && host.endsWith(']')) {
    return isBlockedIpv6(host.slice(1, -1))
  }
  const v4 = parseIpv4(host)
  return v4 !== null && isBlockedIpv4(v4)
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.')
  if (parts.length !== 4) { return null }
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) { return null }
    const n = Number(part)
    if (n > 255) { return null }
    octets.push(n)
  }
  return octets as [number, number, number, number]
}

function isBlockedIpv4([a, b]: [number, number, number, number]): boolean {
  if (a === 0) { return true } // 0.0.0.0/8
  if (a === 10) { return true } // 10.0.0.0/8
  if (a === 127) { return true } // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) { return true } // 169.254.0.0/16 link-local (metadata)
  if (a === 172 && b >= 16 && b <= 31) { return true } // 172.16.0.0/12
  if (a === 192 && b === 168) { return true } // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) { return true } // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) { return true } // 192.0.0.0/24 IETF
  if (a === 198 && (b === 18 || b === 19)) { return true } // 198.18.0.0/15 benchmark
  if (a >= 224) { return true } // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false
}

function isBlockedIpv6(host: string): boolean {
  const h = host.toLowerCase()
  if (h === '::' || h === '::1') { return true } // unspecified, loopback
  // IPv4-mapped (::ffff:...). URL normalizes the embedded v4 to hex
  // (`::ffff:a00:1`), so rather than decode it, block all mapped addresses -
  // a legit client metadata URL never uses an IPv4-mapped IPv6 literal.
  if (h.startsWith('::ffff:')) { return true }
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
    return true // fe80::/10 link-local
  }
  if (h.startsWith('fc') || h.startsWith('fd')) { return true } // fc00::/7 unique-local
  if (h.startsWith('ff')) { return true } // ff00::/8 multicast
  return false
}
