import { createAction } from '@silkweave/core'
import { Logger } from '@silkweave/logger'
import z from 'zod'

export const CalculateAction = createAction({
  name: 'calculate',
  description: 'Perform a basic arithmetic calculation',
  input: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('The operation to perform'),
    a: z.number().describe('First operand'),
    b: z.number().describe('Second operand')
  }),
  run: async ({ operation, a, b }, context) => {
    const logger = context.get<Logger>('logger')
    logger.info(`Calculating ${a} ${operation} ${b}`)
    let result: number
    switch (operation) {
      case 'add': result = a + b; break
      case 'subtract': result = a - b; break
      case 'multiply': result = a * b; break
      case 'divide':
        if (b === 0) { throw new Error('Division by zero') }
        result = a / b; break
    }
    return { operation, a, b, result }
  }
})
