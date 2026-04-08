export interface SilkweaveContext {
  keys: () => string[]
  has: (key: string) => boolean
  get: <T>(key: string) => T
  set: <T>(key: string, value: T) => void
  fork: (store?: Record<string, unknown>) => SilkweaveContext
}

export function createContext(store: Record<string, unknown> = {}): SilkweaveContext {
  return {
    keys: () => {
      return Object.keys(store)
    },
    has: (key: string): boolean => {
      return store[key] != null
    },
    get: <T>(key: string): T => {
      const value = store[key]
      if (value == null) { throw new Error(`Invalid context key: ${key}`) }
      return value as T
    },
    set: <T>(key: string, value: T) => {
      store[key] = value
    },
    fork: (value?: Record<string, unknown>) => {
      return createContext({ ...store, ...value })
    }
  }
}
