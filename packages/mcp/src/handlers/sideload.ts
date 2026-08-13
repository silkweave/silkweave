import { type RequestHandler } from 'express'
import { readFile } from 'fs/promises'
import { basename, resolve, sep } from 'path'
import { type SideloadResource } from '../util/sideload.js'

export interface SideloadResourceOptions {
  /** Directory to read sideload resources from. Defaults to `resources/` (cwd-relative). */
  resourceDir?: string
}

/**
 * Handler for `GET /resource/:id` - serves a large MCP response that was
 * sideloaded to disk as a `{id}` payload with a `{id}.json` metadata sidecar.
 *
 * The route param `id` is provided by the host framework (Express, Nest, etc.).
 */
export function sideloadResource(options: SideloadResourceOptions = {}): RequestHandler {
  const { resourceDir = 'resources' } = options
  const baseDir = resolve(resourceDir)
  return async (req, res) => {
    const id = req.params['id']
    if (!id || typeof id !== 'string') {
      throw new Error('Invalid ID')
    }
    // Contain the read to resourceDir. Express 5 decodes %2F in the route param,
    // so an untrusted `id` like `../../etc/passwd` would otherwise escape the
    // directory. basename() strips any path separators; the resolve+prefix check
    // is defense in depth against platform-specific separator handling.
    const safeId = basename(id)
    const target = resolve(baseDir, safeId)
    if (safeId !== id || (target !== baseDir && !target.startsWith(baseDir + sep))) {
      res.status(400).json({ error: 'invalid_resource_id' })
      return
    }
    const resourceMeta: SideloadResource = JSON.parse(await readFile(`${target}.json`, 'utf-8'))
    const buffer = await readFile(target)
    res.status(200)
    res.header('Content-Type', resourceMeta.contentType)
    res.send(buffer)
  }
}
