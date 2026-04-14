import { Action } from '../util/action.js'
import { Adapter, AdapterGenerator, SilkweaveOptions } from '../util/adapter.js'
import { createContext } from '../util/context.js'

export type { SilkweaveOptions } from '../util/adapter.js'

export interface Silkweave {
  set: <T>(key: string, value: T) => Silkweave
  adapter: (generator: AdapterGenerator) => Silkweave
  action: (action: Action) => Silkweave
  actions: (actions: Action[]) => Silkweave
  start: () => Promise<Silkweave>
}

export function silkweave(options: SilkweaveOptions): Silkweave {
  const adapters: Adapter[] = []
  const actions: Action[] = []
  const context = createContext()
  const builder: Silkweave = {
    set: (key, value) => {
      context.set(key, value)
      return builder
    },
    adapter: (generator) => {
      adapters.push(generator(options, context))
      return builder
    },
    action: (value) => {
      actions.push(value)
      return builder
    },
    actions: (values) => {
      actions.push(...values)
      return builder
    },
    start: async () => {
      await Promise.all(adapters.map((adapter) => {
        const filtered = adapter.allActions
          ? actions
          : actions.filter((action) => {
            if (!action.isEnabled) { return true }
            return action.isEnabled(adapter.context)
          })
        return adapter.start(filtered)
      }))
      return builder
    }
  }
  return builder
}
