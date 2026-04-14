import { createContext } from '@silkweave/core'
import { createLogger } from '@silkweave/logger'
import { UserAction } from './actions/UserAction.js'

async function main() {
  const response = await UserAction.run({ state: 'test' }, createContext({ logger: createLogger() }))
  console.info(response)
}

main()
