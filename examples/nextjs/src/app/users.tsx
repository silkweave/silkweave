'use client'

import { useEffect, useState } from 'react'
import { trpc } from '@/lib/trpc'

interface User {
  id: string
  name: string
  active: boolean
}

export function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Fully typed call against the same actions exposed over MCP.
    trpc.listUsers
      .query({ activeOnly: true })
      .then((result) => {
        setUsers(result.users)
      })
      .catch((err: unknown) => {
        setError(String(err))
      })
  }, [])

  if (error) {
    return <p style={{ color: 'crimson' }}>Failed to load: {error}</p>
  }

  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  )
}
