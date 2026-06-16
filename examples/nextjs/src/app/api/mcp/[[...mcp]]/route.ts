import { app } from '@/silkweave/server'

// One catch-all file serves the MCP transport + any OAuth / well-known sub-paths.
export const { GET, POST, DELETE, OPTIONS } = app.mcp({ basePath: '/api/mcp' })

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
