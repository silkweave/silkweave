import { createAction, defineSkill, silkweave } from '@silkweave/core'
import { http } from '@silkweave/mcp/server'
import { fileURLToPath } from 'node:url'
import z from 'zod/v4'

// Skill directories resolved relative to this file, so the example runs from
// any cwd. On a filesystem-less runtime (Workers), use defineSkill({ files }).
const skillDir = (name: string) => fileURLToPath(new URL(`../skills/${name}`, import.meta.url))

const HelloAction = createAction({
  name: 'hello',
  description: 'Greet a person by name and return a friendly greeting message.',
  input: z.object({ name: z.string().describe('The name of the person to greet.') }),
  args: ['name'],
  run: async ({ name }) => ({ message: `Hello, ${name}!` })
})

async function main() {
  await silkweave({ name: 'team-skills', description: 'Silkweave skills-over-MCP example', version: '1.0.0' })
    .adapter(
      http({
        host: 'localhost',
        port: 8080,
        allowedHosts: ['localhost'],
        skills: [
          // Both skills share one npmPackage, so the marketplace lists them as
          // ONE multi-skill plugin ("example-plugin"). The package is published
          // (via `silkweave skills pack <dir...> --package @silkweave/example-plugin`);
          // a marketplace only POINTS at npm - unpublished entries 404 on install.
          defineSkill({ dir: skillDir('commit-message'), npmPackage: '@silkweave/example-plugin' }),
          defineSkill({ dir: skillDir('release-checklist'), npmPackage: '@silkweave/example-plugin' })
        ],
        // Experimental: also serve the SEP-2640 draft extension
        // (skills/list + skills/get + capability declaration).
        skillsExtension: true,
        // Claude Code plugin marketplace:
        //   /plugin marketplace add http://localhost:8080/.claude-plugin/marketplace.json
        //   /plugin install example-plugin@team-skills
        skillsMarketplace: { owner: { name: 'Silkweave Example' } }
      })
    )
    .action(HelloAction)
    .start()

  console.log('Skills MCP server on http://localhost:8080/mcp')
  console.log('Try: npx silkweave skills list --url http://localhost:8080/mcp')
  console.log('Marketplace: http://localhost:8080/.claude-plugin/marketplace.json')
}

void main()
