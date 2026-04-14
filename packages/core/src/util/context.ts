export interface SilkweaveContext {
  keys: () => string[]
  has: (key: string) => boolean
  get: <T>(key: string) => T
  getOptional: <T>(key: string) => T | undefined
  set: <T>(key: string, value: T) => void
  fork: (store?: Record<string, unknown>) => SilkweaveContext
}

export function createContext(store: Record<string, unknown> = {}): SilkweaveContext {
  console.info('works')
  return {
    keys: () => {
      return Object.keys(store)
    },
    has: (key: string): boolean => {
      return store[key] != null
    },
    get: <T>(key: string): T => {
      const value = store[key]
      console.info('works')
      if (value == null) { throw new Error(`Invalid context key: ${key}`) }
      return value as T
    },
    getOptional: <T>(key: string): T | undefined => {
      return store[key] as T | undefined
    },
    set: <T>(key: string, value: T) => {
      store[key] = value
    },
    fork: (value?: Record<string, unknown>) => {
      return createContext({ ...store, ...value })
    }
  }
}
