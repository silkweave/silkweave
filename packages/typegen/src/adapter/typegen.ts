import { AdapterFactory } from '@silkweave/core'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { generateDts } from '../lib/generateDts.js'

export interface TypegenAdapterOptions {
  path: string
}

export const typegen: AdapterFactory<TypegenAdapterOptions> = ({ path }) => {
  return (_, context) => {
    context.set('adapter', 'typegen')
    return {
      context,
      allActions: true,
      start: async (actions) => {
        const output = generateDts(actions)
        const target = resolve(path)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, output, 'utf-8')
        console.info(`typegen: wrote ${actions.length} action types to ${target}`)
      },
      stop: async () => { }
    }
  }
}
