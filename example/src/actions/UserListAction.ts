import { createAction } from '@silkweave/core'
import { jsonToolResult, smartToolResult } from '@silkweave/mcp'
import { readFileSync } from 'fs'
import z from 'zod'

interface User {
  id: string
  name: string
  email: string
  active: boolean
  gender: 'male' | 'female'
  balance: string
  age: string
  eyeColor: string
  about: string
  tags: string[]
}

const responseTypes = ['json', 'smart', 'controlled'] as const
type ResponseType = (typeof responseTypes)[number]

export const UserListAction = createAction({
  name: 'user-list',
  description: 'Return a list of users',
  input: z.object({
    responseType: z.enum(responseTypes).default('json')
  }),
  run: async ({ responseType }, context) => {
    context.set('responseType', responseType)
    const users: User[] = JSON.parse(readFileSync('src/data/users.json', 'utf-8'))
    return users
  },
  toolResult: (users, context) => {
    const responseType = context.get<ResponseType>('responseType')
    if (responseType === 'json') {
      return jsonToolResult(users)
    } else if (responseType === 'smart') {
      return smartToolResult(users)
    } else {
      const summaryUsers = users.map(({ id, name, active }) => ({ id, name, active }))
      const text = JSON.stringify(summaryUsers, null, 2)
      const blob = Buffer.from(JSON.stringify(users)).toString('base64')
      return {
        content: [
          { type: 'text', text },
          { type: 'resource', resource: { uri: 'mcp://silkweave.dev/users.json', mimeType: 'application/json', blob } }
        ]
      }
    }
  }
})
