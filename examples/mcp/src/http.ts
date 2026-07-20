import { base64ToBytes, binary, createAction, Logger, resource, silkweave } from '@silkweave/core'
import { http } from '@silkweave/mcp/server'
import z from 'zod/v4'

// An 8x8 checkerboard PNG, pre-encoded so the example stays dependency-free.
const DEMO_PNG = base64ToBytes('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAI0lEQVR42mNINvuYbPbx48vkjy+TkdkMOCUwhSBs3BJ0sAMAOwl44TYCiXQAAAAASUVORK5CYII=')

const RenderBadgeAction = createAction({
  name: 'render-badge',
  description: 'Render a small demo PNG badge and return it as a binary resource.',
  kind: 'query',
  input: z.object({ label: z.string().default('badge').describe('File name label for the rendered badge.') }),
  output: binary({ mimeType: 'image/png' }),
  run: async ({ label }) => resource(DEMO_PNG, {
    mimeType: 'image/png',
    name: `${label}.png`,
    description: `Demo badge '${label}' (8x8 PNG checkerboard)`
  })
})

const HelloAction = createAction({
  name: 'hello',
  description: 'Greet a person by name and return a friendly greeting message.',
  input: z.object({ name: z.string().describe('The name of the person to greet.') }),
  output: z.object({ message: z.string() }),
  // Rendered as a positional by CLI clients: `cli-proxy hello Alice`
  // (carried to cliProxy via the MCP tool's _meta `silkweave/args`).
  args: ['name'],
  run: async ({ name }, context) => {
    const logger = context.get<Logger>('logger')
    const message = `Hello, ${name}!`
    logger.info(message)
    return { message }
  }
})

async function main() {
  await silkweave({ name: 'silkweave', description: 'Silkweave MCP HTTP example', version: '1.0.0' })
    .adapter(http({ host: 'localhost', port: 8080, allowedHosts: ['localhost'] }))
    .action(HelloAction)
    .action(RenderBadgeAction)
    .start()
}

main()
