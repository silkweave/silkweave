/* eslint-disable @typescript-eslint/no-explicit-any */
import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import z from 'zod/v4'
import { SilkweaveContext } from './context.js'

export type ActionKind = 'query' | 'mutation'

export type ActionRun<I, O> = (input: I, context: SilkweaveContext) => Promise<O>
export type ActionStreamRun<I, C> = (input: I, context: SilkweaveContext) => AsyncGenerator<C, void, void>

export interface Action<
  I extends object = any,
  O extends object = any,
  N extends string = string,
  K extends ActionKind = ActionKind,
  C = any
> {
  name: N
  description: string
  input: z.ZodType<I> & { shape: Record<string, z.ZodTypeAny> }
  output?: z.ZodType<O> & { shape: Record<string, z.ZodTypeAny> }
  /**
   * Schema for individual chunks yielded by a streaming `run`. Required when
   * `run` is an async generator; adapters detect streaming actions by checking
   * `isStreamingAction(action)` at runtime, but type-aware tooling (inferRouter,
   * typegen) uses the presence of this field.
   */
  chunk?: z.ZodType<C>
  kind?: K
  args?: (keyof I)[]
  isEnabled?: (context: SilkweaveContext) => boolean
  run: ActionRun<I, O> | ActionStreamRun<I, C>
  toolResult?: (response: O, context: SilkweaveContext) => CallToolResult | undefined
}

export interface NonStreamingActionInput<I extends object, O extends object, N extends string, K extends ActionKind> {
  name: N
  description: string
  input: z.ZodType<I> & { shape: Record<string, z.ZodTypeAny> }
  output?: z.ZodType<O> & { shape: Record<string, z.ZodTypeAny> }
  kind?: K
  args?: (keyof I)[]
  isEnabled?: (context: SilkweaveContext) => boolean
  run: ActionRun<I, O>
  toolResult?: (response: O, context: SilkweaveContext) => CallToolResult | undefined
}

export interface StreamingActionInput<I extends object, C, N extends string, K extends ActionKind> {
  name: N
  description: string
  input: z.ZodType<I> & { shape: Record<string, z.ZodTypeAny> }
  chunk: z.ZodType<C>
  kind?: K
  args?: (keyof I)[]
  isEnabled?: (context: SilkweaveContext) => boolean
  run: ActionStreamRun<I, C>
  toolResult?: (response: C[], context: SilkweaveContext) => CallToolResult | undefined
}

export function createAction<
  I extends object,
  C,
  N extends string,
  K extends ActionKind = 'mutation'
>(action: StreamingActionInput<I, C, N, K>): StreamingActionInput<I, C, N, K>
export function createAction<
  I extends object,
  O extends object,
  N extends string,
  K extends ActionKind = 'mutation'
>(action: NonStreamingActionInput<I, O, N, K>): NonStreamingActionInput<I, O, N, K>
export function createAction(action: Action): Action {
  return action
}

/**
 * Returns `true` when `action.run` is an async generator function (declared
 * with `async function*`). Adapters use this to switch between buffered
 * request/response and streaming chunk delivery.
 */
export function isStreamingAction(action: Action): boolean {
  return action.run?.constructor?.name === 'AsyncGeneratorFunction'
}
