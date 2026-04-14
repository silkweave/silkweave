import { AuthInfo } from '@silkweave/auth'
import { createAction } from '@silkweave/core'
import z from 'zod'

export const UserAction = createAction({
  name: 'user',
  description: 'Retrieve current Oauth User',
  input: z.object({
    state: z.string()
  }),
  output: z.object({
    success: z.boolean(),
    state: z.string(),
    auth: z.strictObject({
      token: z.string(),
      clientId: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      expiresAt: z.number().optional()
    })
  }),
  run: async ({ state }, context) => {
    const auth = context.get<AuthInfo>('auth')
    return { success: true, state, auth }
  }
})
