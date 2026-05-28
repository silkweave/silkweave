import { type RequestHandler } from 'express'
import { readFile } from 'fs/promises'
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
  return async (req, res) => {
    const id = req.params['id']
    if (!id || typeof id !== 'string') { throw new Error('Invalid ID') }
    const resourceMeta: SideloadResource = JSON.parse(await readFile(`${resourceDir}/${id}.json`, 'utf-8'))
    const buffer = await readFile(`${resourceDir}/${id}`)
    res.status(200)
    res.header('Content-Type', resourceMeta.contentType)
    res.send(buffer)
  }
}
