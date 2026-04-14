import { Action } from './action.js'
import { SilkweaveContext } from './context.js'

export interface SilkweaveOptions {
  name: string
  description: string
  version: string
}

export interface Adapter {
  context: SilkweaveContext
  allActions?: boolean
  start(actions: Action[]): Promise<void>
  stop(): Promise<void>
}

export type AdapterGenerator = (options: SilkweaveOptions, baseContext: SilkweaveContext) => Adapter

export type AdapterFactory<T = void> = (options: T) => AdapterGenerator
