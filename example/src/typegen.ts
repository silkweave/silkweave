import { TypeGenerator } from '@silkweave/typegen'
import { HelloAction } from './actions/HelloAction.js'

async function main() {
  const typegen = new TypeGenerator()
  const result = typegen.generate(HelloAction)
  console.info(result)
}

main()
