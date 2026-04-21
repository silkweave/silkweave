import { Action } from '../util/action.js'
import { Adapter, AdapterGenerator, SilkweaveOptions } from '../util/adapter.js'
import { createContext } from '../util/context.js'

export type { SilkweaveOptions } from '../util/adapter.js'

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Silkweave<Actions extends Record<string, Action> = {}> {
  set: <T>(key: string, value: T) => Silkweave<Actions>
  adapter: (generator: AdapterGenerator) => Silkweave<Actions>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: <A extends Action<any, any, string, any>>(
    action: A
  ) => Silkweave<Actions & Record<A['name'], A>>
  actions: <Arr extends readonly Action[]>(
    actions: Arr
  ) => Silkweave<Actions & { [K in Arr[number] as K['name']]: K }>
  start: () => Promise<Silkweave<Actions>>
}

export function silkweave(options: SilkweaveOptions): Silkweave {
  const adapters: Adapter[] = []
  const actions: Action[] = []
  const context = createContext()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: Silkweave<any> = {
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
