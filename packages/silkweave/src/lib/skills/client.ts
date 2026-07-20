import type { Client } from '@modelcontextprotocol/sdk/client'
import type { ToolResultContent } from '@modelcontextprotocol/sdk/types.js'
import type { SkillManifestEntry, SkillPayload } from '@silkweave/skills'

/** Parse a JSON tool result, surfacing `isError` results as legible failures. */
async function callJsonTool<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args, _meta: { disposition: 'json' } }) as ToolResultContent
  const text = result.content.find((block) => block.type === 'text')?.text
  if (result.isError) {
    throw new Error(text ?? `${name} failed`)
  }
  if (!text) {
    throw new Error(`${name} returned no JSON payload - is this a silkweave server with a skills option?`)
  }
  return JSON.parse(text) as T
}

/** The server's skill manifest, via the `ListSkills` tool. */
export async function fetchManifest(client: Client): Promise<SkillManifestEntry[]> {
  const { skills } = await callJsonTool<{ skills: SkillManifestEntry[] }>(client, 'ListSkills', {})
  return skills
}

/** One skill's full file payload, via the `GetSkill` tool. */
export async function fetchSkill(client: Client, name: string): Promise<SkillPayload> {
  return callJsonTool<SkillPayload>(client, 'GetSkill', { name })
}
