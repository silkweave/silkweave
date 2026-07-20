# silkweave

The Silkweave CLI - team tooling for [Silkweave](https://www.silkweave.dev) MCP servers, run with `npx silkweave`.

> **4.x note:** this package was previously an umbrella of re-exports (`silkweave/core`, `silkweave/mcp`, ...). Those subpaths are gone - depend on the scoped packages (`@silkweave/core`, `@silkweave/mcp`, ...) directly. The `silkweave` name now ships the CLI.

## Skills

Install and update [Agent Skills](https://agentskills.io/specification) served by a Silkweave MCP server (see [`@silkweave/skills`](https://github.com/silkweave/silkweave/tree/master/packages/skills)):

```bash
# Install/update everything the server offers into ~/.claude/skills
npx silkweave skills sync --url https://skills.example.com/mcp --token $TOKEN

# See what's available / what changed
npx silkweave skills list --url https://skills.example.com/mcp
npx silkweave skills outdated --url https://skills.example.com/mcp   # exit 1 when updates exist

# Cherry-pick, hold, prune
npx silkweave skills install commit-message --url ...
npx silkweave skills pin commit-message      # sync stops updating it
npx silkweave skills unpin commit-message
npx silkweave skills sync --prune --url ...  # remove skills the server dropped
```

- **Target**: `~/.claude/skills` by default; `--target <dir>` for project-level (`.claude/skills`) or other agents' skill directories.
- **Lockfile**: `.silkweave-lock.json` in the target records server, versions, and per-file sha256 digests. Every installed file is verified against its digest; names and paths are revalidated so a server can never write outside the target.
- **Auth**: `--token <bearer>` (or `SILKWEAVE_TOKEN`), repeatable `--header key=value`. The endpoint can come from `SILKWEAVE_URL`.
- **Automation**: run `sync` from a login item, cron, or a Claude Code `SessionStart` hook to keep a fleet of machines converged on one skills server.
- **SEP-2640 aware**: when a server declares the (draft) MCP skills extension, the CLI consumes `skills/list` + `resources/read` instead of the silkweave tools - so `skills sync` also installs from any conforming third-party MCP server. Per-file digest verification applies on both paths.

## Publishing public skills (Claude Code plugins)

`skills pack` wraps one skill directory into a **skills-only Claude Code plugin** package, ready for `npm publish` - public skills get the native `/plugin` experience (real versioning, `/plugin update`) without exposing a repo:

```bash
npx silkweave skills pack ./skills/commit-message
# -> dist/commit-message-plugin/
#      package.json                      npm identity
#      .claude-plugin/plugin.json        plugin manifest
#      skills/commit-message/SKILL.md    the skill, auto-discovered by Claude Code
npm publish dist/commit-message-plugin --access public
```

- **Package name**: `--package <name>`, else the frontmatter `metadata.npmPackage`, else `<skill-name>-skill`.
- **Version**: from the frontmatter `metadata.version` (required - the plugin version is what drives `/plugin update`). Packing **refuses a version already on the registry** so changed content always ships under a new version; `--force` overrides, `--registry <url>` points the check at a private registry.
- **Distribution**: serve a marketplace from the same server via the `http()`/`edge()` adapters' `skillsMarketplace` option (see [`@silkweave/skills`](https://github.com/silkweave/silkweave/tree/master/packages/skills)). Consumers then run `/plugin marketplace add https://<host>/.claude-plugin/marketplace.json` and `/plugin install <skill>@<marketplace>`.

## Universal proxy

Turn any Silkweave (or plain MCP Streamable HTTP) server into a CLI on the spot - its tools become subcommands, built from `tools/list` at invocation time:

```bash
npx silkweave proxy http://localhost:8080/mcp                  # list available commands
npx silkweave proxy http://localhost:8080/mcp hello Tobias     # call a tool
npx silkweave proxy --token $TOKEN https://api.example.com/mcp screenshot --url https://x.dev -o shot.png
```

Proxy flags (`--token`, `--header`, `--silent`) go **before** the URL - everything after the first positional is passed through to the remote tool untouched, so tool flags never collide with proxy flags.

This is the packaged [`cliProxy`](https://github.com/silkweave/silkweave/tree/master/packages/mcp) machinery with the URL from argv: positional arguments declared by the server (`_meta['silkweave/args']`) render as CLI positionals, binary results pipe to stdout or `--output`, and log/progress notifications stream to stderr. Ship a dedicated binary with the `cliProxy` adapter when you want a branded CLI; use `silkweave proxy` when you just want to call a server.

## Options

| Flag | Commands | Description |
|------|----------|-------------|
| `-u, --url <url>` | `skills *` | MCP endpoint (or `SILKWEAVE_URL`) |
| `-t, --token <token>` | all remote | Bearer token (or `SILKWEAVE_TOKEN`); a value containing a space is sent verbatim (e.g. `"Basic ..."`) |
| `-H, --header <key=value>` | all remote | Extra request header, repeatable |
| `--target <dir>` | `skills *` | Install directory (default `~/.claude/skills`) |
| `--prune` | `skills sync` | Remove installed skills the server no longer offers |
| `-p, --package <name>` | `skills pack` | npm package name (default: `metadata.npmPackage`, else `<skill-name>-skill`) |
| `-o, --out <dir>` | `skills pack` | Output directory (default `dist/<skill-name>-plugin`) |
| `--registry <url>` | `skills pack` | npm registry for the already-published check |
| `--force` | `skills pack` | Pack even when this version is already published |
| `-s, --silent` | `proxy` | Suppress log messages |
