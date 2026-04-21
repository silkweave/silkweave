import type { APIRoute } from 'astro'
import { handler } from '../../../server/silkweave.js'

export const GET: APIRoute = ({ request }) => handler(request)
export const POST: APIRoute = ({ request }) => handler(request)
