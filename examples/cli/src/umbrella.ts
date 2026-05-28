import { cli } from 'silkweave/cli'
import { createAction, silkweave } from 'silkweave/core'
import z from 'zod/v4'

const HelloAction = createAction({
  name: 'hello',
  description: 'Say hello',
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  args: ['name'],
  run: async ({ name }) => ({ message: `Hello, ${name}!` })
})

async function main() {
  await silkweave({ name: 'silkweave', description: 'Silkweave umbrella entrypoint', version: '1.0.0' })
    .adapter(cli())
    .action(HelloAction)
    .start()
}

main()
