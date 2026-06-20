import { Action } from './action.js'
import { SilkweaveContext } from './context.js'

export interface SilkweaveOptions {
  name: string
  description: string
  version: string
  /**
   * Run the dev-time action linter on `start()` (warns about missing/short tool
   * descriptions and undescribed input params - mistakes that degrade agent
   * tool-use). Warnings go to stderr via `console.warn`. Default `true`; set
   * `false` to silence in production.
   */
  lint?: boolean
}

export interface Adapter {
  context: SilkweaveContext
  allActions?: boolean
  start(actions: Action[]): Promise<void>
  stop(): Promise<void>
}

export type AdapterGenerator = (options: SilkweaveOptions, baseContext: SilkweaveContext) => Adapter

export type AdapterFactory<T = void> = (options: T) => AdapterGenerator
