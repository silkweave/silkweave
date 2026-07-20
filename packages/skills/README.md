# @silkweave/skills

Serve [Agent Skills](https://agentskills.io/specification) (the `SKILL.md` format used by Claude Code and other agents) from a Silkweave MCP server - versioned, digest-verified, and installable with the `silkweave` CLI.

The serving model follows the MCP Skills working group's direction (SEP-2640, "skills as resources") while staying consumable by every client today:

1. **`skill://` resources** - every skill file is an MCP resource (`skill://<name>/<path>`), readable via plain `resources/list`/`resources/read`.
2. **`ListSkills` / `GetSkill` tools** - ordinary Silkweave actions returning the digest-carrying manifest and per-file content, so any current MCP client (and the `silkweave skills` CLI) can list and install skills. Being actions, they compose with `filterActions`, auth, and telemetry.
3. **Server instructions** - the MCP `initialize` response announces the skills, so hosts that surface instructions activate them without any SEP-2640 support.

## Usage

```typescript
import { defineSkill, silkweave } from '@silkweave/core'
import { http } from '@silkweave/mcp/server'

await silkweave({ name: 'team-skills', description: 'Team skills server', version: '1.0.0' })
  .adapter(http({
    host: 'localhost',
    port: 8080,
    skills: [
      defineSkill({ dir: './skills/commit-message' }),
      defineSkill({ dir: './skills/release-checklist', tags: ['internal'] })
    ]
  }))
  .start()
```

The `skills` option is available on `stdio()`, `http()`, `mcpTransport()`, and `edge()`. `@silkweave/skills` is an optional peer of the adapter packages - install it next to them; the adapters lazy-import it only when the option is used.

On a filesystem-less runtime (Cloudflare Workers), pass inline content instead of a directory:

```typescript
defineSkill({ files: { 'SKILL.md': skillMarkdown, 'references/api.md': apiDocs } })
```

Consumers install and update skills with the CLI (see the [`silkweave`](../silkweave) package):

```bash
npx silkweave skills sync --url https://skills.example.com/mcp --token $TOKEN
```

## Skill format

A skill is a directory with a `SKILL.md` (YAML frontmatter + Markdown body) plus optional supporting files, per the Agent Skills spec. `resolveSkill()` validates at start:

- `name`: 1-64 lowercase alphanumerics/hyphens; must match the directory name (`defineSkill({ name })` is the explicit override).
- `description`: required, 1-1024 chars.
- Versioning: the spec has no first-class version field - Silkweave reads the conventional `metadata.version` frontmatter entry, overridable via `defineSkill({ version })`.

Every file gets a `sha256:<hex>` content digest, plus an aggregate skill digest - the identity `silkweave skills sync` uses for update checks and install verification.

## API

| Export | Description |
|--------|-------------|
| `resolveSkill(def)` / `resolveSkills(defs)` | Load + validate a `SkillDefinition` (from `dir` or inline `files`) into a digest-carrying `Skill`. (`defineSkill()` itself lives in `@silkweave/core`, like the `Skill` types.) |
| `skillActions(skills)` | The `ListSkills` / `GetSkill` actions (tagged `silkweave/skills` for `filterActions` gating). |
| `skillInstructions(skills)` | The server-instructions blurb announcing the skills. |
| `skillManifest(skills)` / `skillPayload(skill)` | Wire shapes: metadata-only listing and full-content payload. |
| `diffSkills(manifest, lockfile)` / `lockEntry()` / `emptyLockfile()` | Lockfile model + diff (`missing` / `outdated` / `up-to-date` / `held` / `orphaned`) shared with the CLI. |
| `sha256(data)` / `assertSafeSkillPath(path)` | The digest and path-safety primitives (Web Crypto only - identical on Node and edge). |
| `registerSkillResources(server, skills)` (from `@silkweave/skills/mcp`) | Registers the `skill://` file resources on an SDK `McpServer`. Separate entry so the package root has no MCP SDK dependency. |

## Access control

Skills tools carry the `silkweave/skills` tag. When a per-request `filterActions` drops them (e.g. for unauthenticated callers), the adapters also hide the `skill://` resources and the instructions for that request - the filter gates the whole skill surface, not just the tools. Combine with `@silkweave/auth` bearer/OAuth for private skill servers, or serve public and private skills from one endpoint by filtering on skill `tags`.

## Security notes

- The CLI re-verifies every file against its manifest digest with the same `sha256` the server used, and revalidates skill names and file paths before writing - a hostile or corrupted server cannot direct writes outside the target directory.
- Digests bind content to what was listed; they are not signatures. Treat skills like code: install from servers you trust.
