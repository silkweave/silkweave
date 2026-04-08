import { createAction } from '@silkweave/core'
import { Logger } from '@silkweave/logger'
import z from 'zod'

export const AdminAction = createAction({
  name: 'admin',
  description: 'Secret admin action',
  input: z.object({
    operation: z.enum(['read', 'write'])
  }),
  args: ['operation'],
  isEnabled: (context) => {
    return context.has('userId') && context.has('role')
  },
  run: async ({ operation }, context) => {
    const logger = context.get<Logger>('logger')
    logger.info(`requesting operation ${operation}`)
    const userId = context.get<string>('userId')
    const role = context.get<string>('role')
    logger.info({ userId, role })
    const success = operation === 'read' || role === 'admin'
    return { operation, role, success }
  }
})
