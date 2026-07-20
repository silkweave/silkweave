import { SilkweaveError } from '@silkweave/core'
import { parse } from 'yaml'

export interface ParsedSkillMarkdown {
  frontmatter: Record<string, unknown>
  body: string
}

/**
 * Split a SKILL.md into YAML frontmatter and Markdown body. The frontmatter
 * block is required by the Agent Skills spec (it carries `name` and
 * `description`); a SKILL.md without one is rejected at resolve time.
 */
export function parseSkillMarkdown(markdown: string): ParsedSkillMarkdown {
  const normalized = markdown.replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized)
  if (!match) {
    throw new SilkweaveError('SKILL.md is missing its YAML frontmatter block (---)', 'invalid_skill')
  }
  const frontmatter: unknown = parse(match[1])
  if (typeof frontmatter !== 'object' || frontmatter === null || Array.isArray(frontmatter)) {
    throw new SilkweaveError('SKILL.md frontmatter must be a YAML mapping', 'invalid_skill')
  }
  return { frontmatter: frontmatter as Record<string, unknown>, body: match[2] }
}
