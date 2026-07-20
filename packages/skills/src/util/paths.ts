import { SilkweaveError } from '@silkweave/core'

/**
 * Validate a skill-root-relative file path. Rejects anything that could
 * escape the skill directory when written to disk by an installer (absolute
 * paths, `..` segments, backslashes, drive letters) - the zip-slip class of
 * traversal. Both the server-side loader and the CLI installer run this, so a
 * malicious or corrupted manifest can never direct a write outside the target.
 */
export function assertSafeSkillPath(path: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path)) {
    throw new SilkweaveError(`Unsafe skill file path: '${path}'`, 'invalid_skill_path', 400)
  }
  const segments = path.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new SilkweaveError(`Unsafe skill file path: '${path}'`, 'invalid_skill_path', 400)
  }
  return path
}
