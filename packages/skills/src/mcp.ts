import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { bytesToBase64, isTextMimeType, type Skill, type SkillFile } from '@silkweave/core'
import z from 'zod/v4'
import { fileBytes } from './util/digest.js'
import { skillEntry, skillUri, SKILLS_EXTENSION_ID, SKILLS_GET_METHOD, SKILLS_LIST_METHOD } from './util/extension.js'

/** SEP-2640-style resource URI for one skill file: `skill://<name>/<path>`. */
export function skillFileUri(skill: Skill, file: SkillFile): string {
  return `skill://${skill.name}/${file.path}`
}

/**
 * Register every skill file as an MCP resource under its `skill://` URI - the
 * resources baseline of SEP-2640 (plain `resources/list`/`resources/read`, no
 * extension methods, no SDK changes). Hosts that treat MCP resources as a
 * virtual filesystem can consume these skills like local ones. Lives in the
 * dedicated `@silkweave/skills/mcp` entry so the package root stays free of
 * the MCP SDK (an optional peer needed only by servers).
 */
const skillsListRequestSchema = z.object({
  method: z.literal(SKILLS_LIST_METHOD),
  params: z.looseObject({ cursor: z.string().optional() }).optional()
})

const skillsGetRequestSchema = z.object({
  method: z.literal(SKILLS_GET_METHOD),
  params: z.looseObject({ uri: z.string() })
})

/**
 * EXPERIMENTAL - register the SEP-2640 draft extension surface: the
 * `capabilities.extensions["io.modelcontextprotocol/skills"]` declaration plus
 * the `skills/list` / `skills/get` methods (listing entries carry the verbatim
 * frontmatter and the per-file digest manifest; file content is read via the
 * ordinary `skill://` resources). The draft is still churning - this tracks it
 * for interop testing and is opt-in via the adapters' `skillsExtension` flag.
 * `resources/directory/read` is not implemented (`directoryRead: false`).
 */
export function registerSkillExtension(server: McpServer, skills: Skill[]): void {
  server.server.registerCapabilities({ extensions: { [SKILLS_EXTENSION_ID]: { directoryRead: false } } })
  server.server.setRequestHandler(skillsListRequestSchema, async () => ({
    skills: skills.map(skillEntry)
  }))
  server.server.setRequestHandler(skillsGetRequestSchema, async (request) => {
    const skill = skills.find((candidate) => skillUri(candidate) === request.params.uri)
    if (!skill) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown skill uri '${request.params.uri}'`)
    }
    return { skill: skillEntry(skill) }
  })
}

export function registerSkillResources(server: McpServer, skills: Skill[]): void {
  for (const skill of skills) {
    for (const file of skill.files) {
      const uri = skillFileUri(skill, file)
      server.registerResource(`${skill.name}/${file.path}`, uri, {
        mimeType: file.mimeType,
        // The skill description on SKILL.md is what lets a resource-listing
        // host decide relevance without reading every file.
        ...(file.path === 'SKILL.md' ? { description: skill.description } : {})
      }, async () => ({
        contents: [
          isTextMimeType(file.mimeType)
            ? { uri, mimeType: file.mimeType, text: typeof file.data === 'string' ? file.data : new TextDecoder().decode(file.data) }
            : { uri, mimeType: file.mimeType, blob: bytesToBase64(fileBytes(file.data)) }
        ]
      }))
    }
  }
}
