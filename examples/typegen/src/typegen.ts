import { createAction, silkweave } from '@silkweave/core'
import { typegen } from '@silkweave/typegen'
import z from 'zod/v4'

const HelloAction = createAction({
  name: 'hello',
  description: 'Say hello',
  input: z.object({ name: z.string() }),
  output: z.object({ message: z.string() }),
  run: async ({ name }) => ({ message: `Hello, ${name}!` })
})

const ListThingsAction = createAction({
  name: 'list-things',
  description: 'List available things',
  kind: 'query',
  input: z.object({ contains: z.string().optional() }),
  output: z.object({ items: z.array(z.string()) }),
  run: async () => ({ items: ['hammer', 'saw', 'wrench'] })
})

async function main() {
  await silkweave({ name: 'silkweave', description: 'Silkweave typegen example', version: '1.0.0' })
    .adapter(typegen({ path: 'out/actions.d.ts' }))
    .action(HelloAction)
    .action(ListThingsAction)
    .start()
}

main()
