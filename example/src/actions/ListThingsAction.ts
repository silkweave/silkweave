import { createAction } from '@silkweave/core'
import z from 'zod'

const THINGS = ['hammer', 'saw', 'wrench', 'screwdriver', 'drill']

export const ListThingsAction = createAction({
  name: 'list-things',
  description: 'List available things, optionally filtered',
  kind: 'query',
  input: z.object({
    contains: z.string().optional().describe('Case-insensitive substring filter')
  }),
  output: z.object({
    items: z.array(z.string())
  }),
  run: async ({ contains }) => {
    const items = contains
      ? THINGS.filter((thing) => thing.toLowerCase().includes(contains.toLowerCase()))
      : THINGS
    return { items }
  }
})
