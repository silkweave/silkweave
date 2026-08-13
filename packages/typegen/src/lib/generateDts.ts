import { type Action, isBinarySchema, isStreamingAction } from '@silkweave/core'
import type { z } from 'zod/v4'
import { pascalCase } from 'change-case'
import { objectMembers, serializedResourceType, zodToTs } from './zodToTs.js'

export function generateDts(actions: Action[]): string {
  const blocks: string[] = []

  for (const action of actions) {
    const name = pascalCase(action.name)

    blocks.push(interfaceBlock(`${name}Input`, action.input))

    if (isStreamingAction(action) && action.chunk) {
      // Streaming action: emit `${name}Chunk` and `${name}Output = Chunk[]`.
      blocks.push(`export type ${name}Chunk = ${zodToTs(action.chunk)}`)
      blocks.push(`export type ${name}Output = ${name}Chunk[]`)
    } else if (isBinarySchema(action.output)) {
      // Binary output: the JSON-transport wire shape (SerializedResource).
      blocks.push(`export interface ${name}Output ${serializedResourceType()}`)
    } else if (action.output) {
      blocks.push(interfaceBlock(`${name}Output`, action.output))
    }
  }

  return blocks.join('\n\n') + '\n'
}

function interfaceBlock(name: string, schema: z.ZodTypeAny): string {
  const members = objectMembers(schema)
  if (members) {
    return members.length ? `export interface ${name} {\n${members.join('\n')}\n}` : `export interface ${name} {}`
  }
  // Non-object schema: fall back to a string-keyed index signature over the
  // whole type (matches the previous compiler-API behavior).
  return `export interface ${name} {\n  [key: string]: ${zodToTs(schema)}\n}`
}
