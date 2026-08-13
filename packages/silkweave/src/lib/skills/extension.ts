import type { Client } from '@modelcontextprotocol/sdk/client'
import {
  aggregateDigest,
  mimeForPath,
  SKILLS_EXTENSION_ID,
  SKILLS_GET_METHOD,
  SKILLS_LIST_METHOD,
  type SkillEntryWire,
  type SkillManifestEntry,
  type SkillPayload,
  type SkillPayloadFile
} from '@silkweave/skills'
import z from 'zod/v4'

const skillEntrySchema = z.looseObject({
  uri: z.string(),
  frontmatter: z.record(z.string(), z.unknown()),
  resources: z.array(z.looseObject({ uri: z.string(), digest: z.string() }))
})

const skillsListResultSchema = z.looseObject({
  skills: z.array(skillEntrySchema),
  nextCursor: z.string().optional()
})

/** Whether the connected server declares the SEP-2640 skills extension. */
export function hasSkillsExtension(client: Client): boolean {
  const capabilities = client.getServerCapabilities() as { extensions?: Record<string, unknown> } | undefined
  return Boolean(capabilities?.extensions?.[SKILLS_EXTENSION_ID])
}

function entryName(entry: SkillEntryWire): string {
  const fromFrontmatter = entry.frontmatter['name']
  if (typeof fromFrontmatter === 'string' && fromFrontmatter) {
    return fromFrontmatter
  }
  // Spec: the skill URI's final path segment before SKILL.md equals the name.
  const segments = entry.uri.replace(/^skill:\/\//, '').split('/')
  return segments.length > 1 ? segments[segments.length - 2] : segments[0]
}

function entryVersion(entry: SkillEntryWire): string | undefined {
  const metadata = entry.frontmatter['metadata']
  if (typeof metadata !== 'object' || metadata === null) {
    return undefined
  }
  const version = (metadata as Record<string, unknown>)['version']
  return typeof version === 'string' ? version : undefined
}

/**
 * Map a SEP-2640 listing entry onto the manifest model the sync engine uses.
 * File paths are derived from the resource URIs (relative to the skill root);
 * the aggregate digest is computed client-side with the same canonical
 * formula the silkweave server uses, so lockfile identities stay stable.
 */
async function entryToManifest(entry: SkillEntryWire): Promise<SkillManifestEntry> {
  const name = entryName(entry)
  const root = entry.uri.replace(/SKILL\.md$/, '')
  const files = entry.resources.map((resource) => {
    const path = resource.uri.startsWith(root)
      ? resource.uri.slice(root.length)
      : (resource.uri.split('/').pop() ?? resource.uri)
    return { path, mimeType: mimeForPath(path), digest: resource.digest }
  })
  const description = entry.frontmatter['description']
  return {
    name,
    description: typeof description === 'string' ? description : '',
    ...(entryVersion(entry) ? { version: entryVersion(entry) } : {}),
    digest: await aggregateDigest(files),
    files
  }
}

export interface ExtensionSkills {
  manifest: SkillManifestEntry[]
  /** Fetch one skill's files via `resources/read`, keyed by manifest name. */
  payload: (name: string) => Promise<SkillPayload>
}

/**
 * EXPERIMENTAL - consume a SEP-2640 server: `skills/list` for the listing,
 * `resources/read` per file for content. Works against any server declaring
 * the extension, silkweave or not; per-file digests are still verified at
 * install time, exactly like the tool path.
 */
export async function fetchExtensionSkills(client: Client): Promise<ExtensionSkills> {
  const listed = await client.request({ method: SKILLS_LIST_METHOD, params: {} }, skillsListResultSchema)
  const entries = new Map<string, { entry: SkillEntryWire; manifest: SkillManifestEntry }>()
  for (const entry of listed.skills) {
    const manifest = await entryToManifest(entry)
    entries.set(manifest.name, { entry, manifest })
  }
  return {
    manifest: [...entries.values()].map(({ manifest }) => manifest),
    payload: async (name) => {
      const found = entries.get(name)
      if (!found) {
        throw new Error(`Unknown skill '${name}' (${SKILLS_GET_METHOD} listing has no such entry)`)
      }
      const files: SkillPayloadFile[] = []
      for (const [index, resource] of found.entry.resources.entries()) {
        const file = found.manifest.files[index]
        const read = await client.readResource({ uri: resource.uri })
        const content = read.contents[0] as { text?: string; blob?: string } | undefined
        if (!content) {
          throw new Error(`Empty resource read for ${resource.uri}`)
        }
        files.push({
          path: file.path,
          mimeType: file.mimeType,
          digest: file.digest,
          ...(typeof content.text === 'string' ? { text: content.text } : { base64: content.blob ?? '' })
        })
      }
      return {
        name: found.manifest.name,
        description: found.manifest.description,
        ...(found.manifest.version ? { version: found.manifest.version } : {}),
        digest: found.manifest.digest,
        files
      }
    }
  }
}
