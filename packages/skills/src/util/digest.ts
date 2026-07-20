/** UTF-8 bytes of a skill file's content (strings are text-mime payloads). */
export function fileBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? new TextEncoder().encode(data) : data
}

/**
 * SEP-2640-style content digest: `sha256:<hex>` over the content bytes.
 * Web Crypto only, so it runs identically on Node and edge/Workers - and the
 * CLI client verifies installs with the exact same function the server used.
 */
export async function sha256(data: Uint8Array | string): Promise<string> {
  const bytes = fileBytes(data)
  const hash = await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  return `sha256:${[...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
