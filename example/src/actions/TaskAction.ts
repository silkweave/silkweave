import { createAction } from '@silkweave/core'
import { Logger } from '@silkweave/logger'
import { createSideloadResource } from '@silkweave/mcp'
import z from 'zod'

export const TaskAction = createAction({
  name: 'task',
  description: 'Execute a long-running task',
  input: z.object({
    stepCount: z.number().int().min(1).max(10).describe('Number of steps to execute').default(5),
    stepDuration: z.number().int().min(1000).max(10000).describe('Time duration per step').default(1000)
  }),
  run: async ({ stepCount, stepDuration }, context) => {
    const logger = context.get<Logger>('logger')
    logger.info(`Running ${stepCount} steps at ${stepDuration}ms each`)
    for (let i = 1; i <= stepCount; i += 1) {
      logger.progress({ progress: i, total: stepCount, message: `Executing step ${i} of ${stepCount}` })
      await new Promise((resolve) => { setTimeout(resolve, stepDuration) })
    }
    const buffer = Buffer.from('the secret code is "pirates"', 'utf-8')
    const resource = await createSideloadResource(buffer, { name: 'SECRET.md', contentType: 'text/plain' })
    return { completed: stepCount, resources: [resource] }
  }
})
