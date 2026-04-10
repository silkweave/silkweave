import { createContext } from '@silkweave/core'
import { createLogger } from '@silkweave/logger'
import { UserListAction } from './actions/UserListAction.js'

async function main() {
  const _response = await UserListAction.run({ responseType: 'smart' }, createContext({ logger: createLogger() }))
}

main()
