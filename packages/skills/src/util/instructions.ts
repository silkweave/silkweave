import type { Skill } from '@silkweave/core'

/**
 * Server `instructions` blurb pointing hosts at the skills. The
 * instructions-pointer pattern is what the MCP skills working group validated
 * for activation: hosts that surface server instructions will read a skill's
 * files before performing a matching task, with no SEP-2640 client support
 * required.
 */
export function skillInstructions(skills: Skill[]): string {
  const lines = skills.map((skill) => `- ${skill.name}${skill.version ? ` (v${skill.version})` : ''}: ${skill.description}`)
  return [
    'This server provides agent skills (SKILL.md format):',
    ...lines,
    'Before performing a matching task, read the skill\'s files - via its `skill://<name>/<path>` resources or the GetSkill tool.',
    'To install these skills into a local agent, run: npx silkweave skills sync --url <this server\'s MCP endpoint>'
  ].join('\n')
}
