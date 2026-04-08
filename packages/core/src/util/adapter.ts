import { SilkweaveOptions } from '../lib/silkweave.js'
import { Action } from './action.js'
import { SilkweaveContext } from './context.js'

export interface Adapter {
  context: SilkweaveContext
  start(actions: Action[]): Promise<void>
  stop(): Promise<void>
}

export type AdapterGenerator = (options: SilkweaveOptions, baseContext: SilkweaveContext) => Adapter

export type AdapterFactory<T = void> = (options: T) => AdapterGenerator
