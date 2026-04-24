import { silkweave } from '@silkweave/core'
import { cliProxy } from '@silkweave/mcp'

async function main() {
  await silkweave({ name: 'silkweave', description: 'Silkweave', version: '1.0.0' })
    .adapter(cliProxy({ url: new URL('http://localhost:8080/mcp') }))
    .start()
}

main()
