import { createAction, defineSkill, silkweave } from '@silkweave/core'
import { stdio } from '@silkweave/mcp'
import { fileURLToPath } from 'node:url'
import z from 'zod/v4'

const skillDir = (name: string) => fileURLToPath(new URL(`../skills/${name}`, import.meta.url))

const HelloAction = createAction({
  name: 'hello',
  description: 'Greet a person by name and return a friendly greeting message.',
  input: z.object({ name: z.string().describe('The name of the person to greet.') }),
  run: async ({ name }) => ({ message: `Hello, ${name}!` })
})

await silkweave({ name: 'team-skills', description: 'Silkweave skills-over-MCP example (stdio)', version: '1.0.0' })
  .adapter(stdio({
    skills: [
      defineSkill({ dir: skillDir('commit-message') }),
      defineSkill({ dir: skillDir('release-checklist') })
    ]
  }))
  .action(HelloAction)
  .start()
