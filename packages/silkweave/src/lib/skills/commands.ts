import type { Client } from '@modelcontextprotocol/sdk/client'
import { diffSkills, lockEntry, type SkillDiff } from '@silkweave/skills'
import type { Command } from 'commander'
import { connectRemote, parseUrl, type RemoteOptions } from '../connect.js'
import { skillSource } from './client.js'
import { installSkill, removeSkill } from './install.js'
import { defaultTarget, readLockfile, writeLockfile } from './io.js'

interface SkillsOptions extends RemoteOptions {
  url?: string
  target: string
  prune?: boolean
}

function withCommonOptions(command: Command): Command {
  return command
    .option('-u, --url <url>', 'MCP endpoint URL (or SILKWEAVE_URL), e.g. https://host:8080/mcp')
    .option('-t, --token <token>', 'bearer token (or SILKWEAVE_TOKEN)')
    .option('-H, --header <key=value...>', 'extra request header (repeatable)')
    .option('--target <dir>', 'install directory', defaultTarget())
}

function endpoint(options: SkillsOptions): URL {
  const url = options.url ?? process.env['SILKWEAVE_URL']
  if (!url) {
    console.error('No MCP endpoint - pass --url or set SILKWEAVE_URL')
    process.exit(1)
  }
  return parseUrl(url)
}

async function withClient<T>(options: SkillsOptions, fn: (client: Client, url: URL) => Promise<T>): Promise<T> {
  const url = endpoint(options)
  const { client, close } = await connectRemote(url, options)
  try {
    return await fn(client, url)
  } finally {
    await close()
  }
}

function describeDiff(diff: SkillDiff): string {
  const version = diff.remote?.version ?? diff.locked?.version
  const label = `${diff.name}${version ? ` ${version}` : ''}`
  switch (diff.status) {
    case 'up-to-date': return `up-to-date  ${label}`
    case 'missing': return `available   ${label}`
    case 'outdated': return `outdated    ${diff.name} ${diff.locked?.version ?? '?'} -> ${diff.remote?.version ?? 'new content'}`
    case 'held': return `held        ${diff.name} (pinned ${diff.locked?.pinned}; remote has ${diff.remote?.version ?? 'new content'})`
    case 'orphaned': return `orphaned    ${diff.name} (no longer on the server; sync --prune removes it)`
  }
}

interface SyncFlags {
  /** Only these skills (error on unknown names); undefined = everything remote. */
  names?: string[]
  prune?: boolean
  /** Explicit `install` of a pinned-but-changed skill is an error instead of a silent hold. */
  failOnHeld?: boolean
}

async function runSync(options: SkillsOptions, flags: SyncFlags): Promise<void> {
  await withClient(options, async (client, url) => {
    const lockfile = await readLockfile(options.target)
    const server = url.toString()
    if (lockfile.server && lockfile.server !== server) {
      console.warn(`warning: ${options.target} was last synced from ${lockfile.server} - one server per target is supported`)
    }
    const source = await skillSource(client)
    if (source.kind === 'extension') { console.log('(consuming SEP-2640 skills extension)') }
    const manifest = await source.manifest()
    let diffs = diffSkills(manifest, lockfile)
    if (flags.names?.length) {
      const known = new Set(diffs.map((diff) => diff.name))
      const unknown = flags.names.filter((name) => !known.has(name))
      if (unknown.length) {
        console.error(`Unknown skill(s): ${unknown.join(', ')} - see \`silkweave skills list\``)
        process.exit(1)
      }
      diffs = diffs.filter((diff) => flags.names!.includes(diff.name))
    }
    let installed = 0
    let removed = 0
    for (const diff of diffs) {
      if (diff.status === 'missing' || diff.status === 'outdated') {
        const payload = await source.payload(diff.name)
        if (payload.digest !== diff.remote!.digest) {
          throw new Error(`${diff.name}: manifest/payload digest mismatch (server changed mid-sync?) - retry`)
        }
        await installSkill(options.target, payload, diff.locked)
        lockfile.skills[diff.name] = lockEntry(diff.remote!, diff.locked?.pinned)
        installed += 1
        const version = diff.remote?.version ? ` ${diff.remote.version}` : ''
        console.log(`${diff.status === 'missing' ? 'installed  ' : 'updated    '}${diff.name}${version}`)
      } else if (diff.status === 'orphaned' && flags.prune) {
        await removeSkill(options.target, diff.name)
        delete lockfile.skills[diff.name]
        removed += 1
        console.log(`removed     ${diff.name}`)
      } else {
        if (diff.status === 'held' && flags.failOnHeld) {
          console.error(`${diff.name} is pinned at ${diff.locked?.pinned} - \`silkweave skills unpin ${diff.name}\` first`)
          process.exit(1)
        }
        console.log(describeDiff(diff))
      }
    }
    lockfile.server = server
    await writeLockfile(options.target, lockfile)
    console.log(`${installed} installed/updated, ${removed} removed, target ${options.target}`)
  })
}

export function registerSkillsCommands(program: Command): void {
  const skills = program.command('skills').description('Install and update agent skills from a silkweave MCP server')

  withCommonOptions(skills.command('sync'))
    .description('Install new and update changed skills (everything the server offers)')
    .option('--prune', 'remove installed skills the server no longer offers', false)
    .action(async (options: SkillsOptions) => runSync(options, { prune: options.prune }))

  withCommonOptions(skills.command('install'))
    .description('Install or update specific skills by name')
    .argument('<names...>', 'skill names as shown by `silkweave skills list`')
    .action(async (names: string[], options: SkillsOptions) => runSync(options, { names, failOnHeld: true }))

  withCommonOptions(skills.command('list'))
    .description('List the skills the server offers, with local install status')
    .action(async (options: SkillsOptions) => {
      await withClient(options, async (client) => {
        const lockfile = await readLockfile(options.target)
        const source = await skillSource(client)
        for (const diff of diffSkills(await source.manifest(), lockfile)) {
          console.log(describeDiff(diff))
        }
      })
    })

  withCommonOptions(skills.command('outdated'))
    .description('Show skills whose remote content differs (exit 1 when updates exist)')
    .action(async (options: SkillsOptions) => {
      await withClient(options, async (client) => {
        const lockfile = await readLockfile(options.target)
        const source = await skillSource(client)
        const stale = diffSkills(await source.manifest(), lockfile)
          .filter((diff) => diff.status !== 'up-to-date')
        for (const diff of stale) { console.log(describeDiff(diff)) }
        if (stale.some((diff) => diff.status === 'missing' || diff.status === 'outdated')) {
          process.exitCode = 1
        }
      })
    })

  skills.command('pin')
    .description('Pin an installed skill - `sync` stops updating it')
    .argument('<name>', 'installed skill name')
    .argument('[version]', 'label recorded for the pin (defaults to the installed version)')
    .option('--target <dir>', 'install directory', defaultTarget())
    .action(async (name: string, version: string | undefined, options: { target: string }) => {
      const lockfile = await readLockfile(options.target)
      const entry = lockfile.skills[name]
      if (!entry) {
        console.error(`'${name}' is not installed in ${options.target}`)
        process.exit(1)
      }
      entry.pinned = version ?? entry.version ?? 'current'
      await writeLockfile(options.target, lockfile)
      console.log(`pinned      ${name} at ${entry.pinned}`)
    })

  skills.command('unpin')
    .description('Unpin a skill so `sync` updates it again')
    .argument('<name>', 'installed skill name')
    .option('--target <dir>', 'install directory', defaultTarget())
    .action(async (name: string, options: { target: string }) => {
      const lockfile = await readLockfile(options.target)
      const entry = lockfile.skills[name]
      if (!entry?.pinned) {
        console.error(`'${name}' is not pinned in ${options.target}`)
        process.exit(1)
      }
      delete entry.pinned
      await writeLockfile(options.target, lockfile)
      console.log(`unpinned    ${name}`)
    })
}
