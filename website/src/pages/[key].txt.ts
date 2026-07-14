import type { APIRoute } from 'astro'

// IndexNow key file (https://www.indexnow.org/documentation). The protocol requires the
// key to be publicly retrievable at https://<host>/<key>.txt; the key itself is not a
// secret, but we keep it out of git (website/.env locally, INDEXNOW_KEY env on Vercel)
// and serve it dynamically instead of committing a key-named file.
export const GET: APIRoute = ({ params }) => {
  const key = process.env.INDEXNOW_KEY ?? import.meta.env.INDEXNOW_KEY
  if (!key || params.key !== key) {
    return new Response('Not Found', { status: 404 })
  }
  return new Response(key, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
