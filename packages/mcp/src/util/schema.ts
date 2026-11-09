import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import { z } from 'zod/v4'

type JsonSchemaTarget = 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | (object & string)

/** MCP SDK target names -> zod's `toJSONSchema` target names. */
function zodTarget(target: JsonSchemaTarget): 'draft-2020-12' | 'draft-7' | 'openapi-3.0' {
  if (target === 'draft-07') {
    return 'draft-7'
  }
  return target === 'openapi-3.0' ? 'openapi-3.0' : 'draft-2020-12'
}

const cache = new WeakMap<z.ZodType, StandardSchemaWithJSON>()

/**
 * Adapt an action's zod schema to the MCP SDK v2 `StandardSchemaWithJSON`
 * contract (`registerTool`'s `inputSchema`/`outputSchema`).
 *
 * The SDK requires `~standard.jsonSchema`, which zod only ships natively from
 * 4.2 - the `zod/v4` subpath of zod 3.25 (and zod 4.0/4.1) lacks it. Rather than
 * forcing consumers onto zod >= 4.2, the adapter supplies it from
 * `z.toJSONSchema()` (present in every `zod/v4` we support) and delegates
 * validation to the schema's own `~standard.validate`, so defaults, transforms
 * and coercion behave exactly as zod defines them - no JSON-Schema re-validation
 * drift. No consumer zod instance is handed to the SDK, so the SDK's own zod
 * dependency never meets it.
 *
 * `unrepresentable: 'any'` keeps a schema the converter cannot express (a
 * `z.custom()`, the `binary()` resource schema) from throwing at `tools/list`;
 * it degrades to an unconstrained JSON Schema, as the v1 SDK's converter did.
 */
export function standardSchema(schema: z.ZodType): StandardSchemaWithJSON {
  const cached = cache.get(schema)
  if (cached) {
    return cached
  }
  const toJson = (io: 'input' | 'output') => (options: { target: JsonSchemaTarget }) =>
    z.toJSONSchema(schema, { target: zodTarget(options.target), io, unrepresentable: 'any' }) as Record<string, unknown>
  const adapted: StandardSchemaWithJSON = {
    '~standard': {
      version: 1,
      vendor: 'silkweave',
      validate: (value: unknown) => schema['~standard'].validate(value),
      jsonSchema: { input: toJson('input'), output: toJson('output') }
    }
  }
  cache.set(schema, adapted)
  return adapted
}
