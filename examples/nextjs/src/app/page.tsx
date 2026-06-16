import { Users } from './users.js'

export default function Home() {
  return (
    <main>
      <h1>Silkweave + Next.js</h1>
      <p>
        One action set (<code>list-users</code>, <code>ban-user</code>) projected onto two
        Next.js App Router route handlers from a single source of truth.
      </p>

      <h2>Active users (via tRPC)</h2>
      <Users />

      <h2>Endpoints</h2>
      <ul>
        <li><code>POST /api/trpc/listUsers</code> &mdash; tRPC (typed frontend client)</li>
        <li><code>POST /api/mcp</code> &mdash; MCP Streamable HTTP (agents)</li>
      </ul>

      <p>
        Point an MCP client at <code>http://localhost:8080/api/mcp</code> to call the same
        actions as tools (<code>ListUsers</code> / <code>BanUser</code>).
      </p>
    </main>
  )
}
