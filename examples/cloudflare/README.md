# @silkweave/example-cloudflare

Silkweave MCP server on **Cloudflare Workers**: stateless Streamable HTTP + **Google Workspace OAuth 2.1**, with OAuth state persisted in **Cloudflare KV**.

This is the Web-Standard deployment path. The `edge()` adapter is a plain `(Request) => Response` handler (no Express), so it drops straight onto a Worker's `fetch` handler and serves both the MCP transport and the full OAuth surface from one Worker.

## Why this shape

- **Stateless, no session id.** `edge()` runs the MCP transport with `sessionIdGenerator: undefined` - no `Mcp-Session-Id`, no session map, no `GET`/`DELETE` reconnect. Every request is self-contained, so the Worker scales horizontally with no shared in-memory state. This is the blessed shape for serverless MCP.
- **KV-backed OAuth store.** Workers have no filesystem, so the JSON-file store can't be used. We reuse `createRedisStore` from `@silkweave/auth/oauth` over a ~10-line Cloudflare KV adapter (KV's `get`/`put`/`delete` matches the `RedisClient` shape). Auth codes, PKCE verifiers, client registrations and refresh tokens all live in KV.
- **Lazy app construction.** KV bindings + secrets are only available per-request via `env`, so the Silkweave app is built on first request and memoized (see `src/index.ts`).

---

## From-scratch setup

If you have never used Cloudflare or Google Cloud before, follow every step. Total time ~15 minutes. Nothing here costs money (Workers + KV both have generous free tiers).

### Prerequisites

- **Node 20+** and this monorepo installed (`pnpm install` at the repo root).
- A **Cloudflare account** (free): sign up at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) and verify your email. No domain or credit card required - Workers get a free `*.workers.dev` subdomain.
- A **Google account** with access to [Google Cloud Console](https://console.cloud.google.com) (any Gmail/Workspace account works).

### Step 1 - Authenticate Wrangler with Cloudflare

`wrangler` is Cloudflare's CLI; it ships as a dev dependency of this example. Log in once - it opens a browser to authorize:

```bash
pnpm -F @silkweave/example-cloudflare exec wrangler login
```

On first run Cloudflare also assigns your account a workers.dev subdomain (e.g. `jane-doe.workers.dev`); you can see/change it in the dashboard under **Workers & Pages -> Subdomain**. Your Worker will be reachable at `https://silkweave-mcp.<your-subdomain>.workers.dev`. Verify the login with:

```bash
pnpm -F @silkweave/example-cloudflare exec wrangler whoami
```

### Step 2 - Create the KV namespace

KV stores the OAuth state. Create a production namespace and a preview namespace (the latter is used by `wrangler dev`):

```bash
pnpm -F @silkweave/example-cloudflare exec wrangler kv namespace create OAUTH_KV
pnpm -F @silkweave/example-cloudflare exec wrangler kv namespace create OAUTH_KV --preview
```

Each command prints an `id`. Paste them into `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  { "binding": "OAUTH_KV", "id": "<id from first command>", "preview_id": "<id from --preview command>" }
]
```

### Step 3 - Create the Google OAuth client

1. In [Google Cloud Console](https://console.cloud.google.com), create (or pick) a project via the project dropdown in the top bar.
2. **APIs & Services -> OAuth consent screen**: choose a user type.
   - **Internal** restricts sign-in to your Google **Workspace** domain - this is the recommended way to scope the server to your team (requires a Workspace org).
   - **External** allows any Google account (add yourself under "Test users" while in testing).
   Fill in the app name + support email and save.
3. **APIs & Services -> Credentials -> Create Credentials -> OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized redirect URIs**: add both
     - `https://silkweave-mcp.<your-subdomain>.workers.dev/auth/callback` (production)
     - `http://localhost:8787/auth/callback` (local `wrangler dev`)
4. Copy the **Client ID** and **Client Secret** shown after creation.

### Step 4 - Configure resource URL + secrets

Set `RESOURCE_URL` in `wrangler.jsonc` `vars` to your deployed origin:

```jsonc
"vars": { "RESOURCE_URL": "https://silkweave-mcp.<your-subdomain>.workers.dev" }
```

Then store the three secrets. `SIGNING_KEY` is any high-entropy string used to sign the bearer tokens the Worker issues (generate one with `node -e "console.log(crypto.randomUUID())"`):

```bash
# production secrets (encrypted, stored by Cloudflare)
pnpm -F @silkweave/example-cloudflare exec wrangler secret put GOOGLE_CLIENT_ID
pnpm -F @silkweave/example-cloudflare exec wrangler secret put GOOGLE_CLIENT_SECRET
pnpm -F @silkweave/example-cloudflare exec wrangler secret put SIGNING_KEY

# local dev secrets (gitignored file, never committed)
cp .dev.vars.example .dev.vars   # then edit .dev.vars with real values
```

### Step 5 - Run locally, then deploy

```bash
pnpm build                                   # from repo root - builds the @silkweave/* deps

pnpm -F @silkweave/example-cloudflare dev    # wrangler dev on http://localhost:8787
pnpm -F @silkweave/example-cloudflare deploy # publish to https://silkweave-mcp.<subdomain>.workers.dev
```

> `wrangler` bundles via esbuild and resolves `@silkweave/*` to their built output (`build/`), so run `pnpm build` at the repo root first. After `deploy`, the CLI prints the live URL.

---

## Connect from Claude Desktop

**+ -> Connectors -> Add custom connector**, URL: `https://silkweave-mcp.<your-subdomain>.workers.dev/mcp`

Claude discovers the auth server via `/.well-known/oauth-protected-resource`, runs the OAuth flow (CIMD/DCR + PKCE) against the Worker, you sign in with Google once, and the `hello` / `who-am-i` tools appear. The caller's identity is available inside actions via `context.get('auth')`.

For local testing against `wrangler dev`, point an MCP client at `http://localhost:8787/mcp` (Claude Desktop requires a public HTTPS URL, so use the deployed Worker for it).

## What the endpoints are

The single Worker serves everything off `RESOURCE_URL`:

| Path | Purpose |
|------|---------|
| `/mcp` | MCP Streamable HTTP transport (the connector URL) |
| `/.well-known/oauth-protected-resource` | RFC 9728 metadata - how Claude discovers the auth server |
| `/.well-known/oauth-authorization-server` | OAuth 2.1 server metadata |
| `/authorize`, `/token`, `/register` | OAuth 2.1 endpoints (PKCE, DCR) |
| `/auth/callback` | Google redirect target |

## Notes & troubleshooting

- **`redirect_uri_mismatch` from Google**: the redirect URI in step 3 must match exactly (scheme + host + `/auth/callback`). Watch the Worker logs (`wrangler tail`) on the first connect to see the exact value Claude/Google used.
- **Restricting to a Workspace domain**: the cleanest enforcement is an **Internal** OAuth consent screen (step 3). Per-request domain checks inside an action would need the email surfaced into `AuthInfo`, which the base bearer info does not currently include.
- **KV minimum TTL** is 60s; the adapter floors short expiries to satisfy it (`KV_MIN_TTL` in `src/index.ts`).
- **Inspect stored OAuth state**: `wrangler kv key list --binding OAUTH_KV` (add `--preview` for the dev namespace).
- **Use real Worker types** in your own project: run `wrangler types` and import `@cloudflare/workers-types` instead of the hand-rolled `KVNamespace` interface in `src/index.ts`.
