import { app } from '@/silkweave/server'

export const { GET, POST, OPTIONS } = app.trpc({ endpoint: '/api/trpc' })

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
