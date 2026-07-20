import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { bytesToBase64, isTextMimeType, type Skill, type SkillFile } from '@silkweave/core'
import { fileBytes } from './util/digest.js'

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
