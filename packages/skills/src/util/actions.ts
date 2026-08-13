import { createAction, notFound, type Action, type Skill } from '@silkweave/core'
import z from 'zod/v4'
import { skillManifest, skillPayload } from './manifest.js'

/** Tag carried by the skill actions, so `filterActions` can gate the whole skill surface. */
export const SKILL_ACTIONS_TAG = 'silkweave/skills'

/**
 * The tool-fallback serving surface: plain silkweave actions (`ListSkills`,
 * `GetSkill`) that work through every adapter and every MCP client today -
 * including hosts with no SEP-2640 support. Being ordinary actions, they
 * compose with `filterActions`, auth, and telemetry like any other tool.
 */
export function skillActions(skills: Skill[]): Action[] {
  const listSkills = createAction({
    name: 'list-skills',
    description:
      'List the agent skills this server provides (name, version, description, per-file content digests). ' +
      "Fetch a skill's files with GetSkill, or install/update them locally with: npx silkweave skills sync --url <this server's MCP endpoint>",
    kind: 'query',
    tags: [SKILL_ACTIONS_TAG],
    input: z.object({}),
    run: async () => ({ skills: skillManifest(skills) })
  })
  const getSkill = createAction({
    name: 'get-skill',
    description:
      'Fetch all files of one agent skill by name (as listed by ListSkills). ' +
      'Text files ship as `text`, binary files as `base64`; verify each file against its `digest` when installing.',
    kind: 'query',
    tags: [SKILL_ACTIONS_TAG],
    input: z.object({
      name: z.string().describe('Skill name as returned by ListSkills')
    }),
    args: ['name'],
    run: async ({ name }) => {
      const skill = skills.find((candidate) => candidate.name === name)
      if (!skill) {
        throw notFound(`Unknown skill '${name}'`)
      }
      return skillPayload(skill)
    }
  })
  return [listSkills, getSkill] as Action[]
}
