import { AuthInfo } from '@silkweave/auth'
import { createAction } from '@silkweave/core'
import z from 'zod'

export const UserAction = createAction({
  name: 'user',
  description: 'Retrieve current Oauth User',
  input: z.object({}),
  run: async (_, context) => {
    const auth = context.get<AuthInfo>('auth')
    return { success: true, auth }
  }
})
