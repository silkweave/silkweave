/* eslint-disable @typescript-eslint/no-explicit-any */
import z from 'zod'
import { SilkweaveContext } from './context.js'

export interface Action<I extends object = any, O extends object = any> {
  name: string
  description: string
  input: z.ZodType<I> & { shape: Record<string, z.ZodTypeAny> }
  args?: (keyof I)[]
  isEnabled?: (context: SilkweaveContext) => boolean
  run: (input: I, context: SilkweaveContext) => Promise<O>
}

export function createAction<I extends object = object, O extends object = object>(
  action: Action<I, O>
): Action<I, O> {
  return action
}
