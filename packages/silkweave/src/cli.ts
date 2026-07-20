#!/usr/bin/env node
import { Command } from 'commander'
import { createRequire } from 'node:module'
import { registerProxyCommand } from './lib/proxy.js'
import { registerSkillsCommands } from './lib/skills/commands.js'

const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

const program = new Command()
  .name('silkweave')
  .description('Silkweave tooling - sync agent skills from silkweave MCP servers, proxy any MCP server as a CLI')
  .version(version)
  // Lets `proxy <url> <tool> --tool-flag` pass tool flags through untouched.
  .enablePositionalOptions()

registerSkillsCommands(program)
registerProxyCommand(program)

await program.parseAsync()
