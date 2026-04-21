/* eslint-disable @typescript-eslint/no-explicit-any */
import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import z from 'zod'
import { SilkweaveContext } from './context.js'

export type ActionKind = 'query' | 'mutation'

export interface Action<
  I extends object = any,
  O extends object = any,
  N extends string = string,
  K extends ActionKind = ActionKind
> {
  name: N
  description: string
  input: z.ZodType<I> & { shape: Record<string, z.ZodTypeAny> }
  output?: z.ZodType<O> & { shape: Record<string, z.ZodTypeAny> }
  kind?: K
  args?: (keyof I)[]
  isEnabled?: (context: SilkweaveContext) => boolean
  run: (input: I, context: SilkweaveContext) => Promise<O>
  toolResult?: (response: O, context: SilkweaveContext) => CallToolResult | undefined
}

export function createAction<
  I extends object = object,
  O extends object = object,
  N extends string = string,
  K extends ActionKind = 'mutation'
>(action: Action<I, O, N, K>): Action<I, O, N, K> {
  return action
}
