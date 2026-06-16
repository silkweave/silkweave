import type { z } from 'zod/v4'

/** Reflect-metadata key carrying `@Mcp` options on a controller method. */
export const MCP_METADATA = '__silkweave_mcp__'

/**
 * Options for the `@Mcp()` method decorator. Every field is optional - an empty
 * `@Mcp()` exposes the decorated controller route as an MCP tool with its name,
 * description, and input schema fully reflected from the method's route
 * (`@Get`/`@Post`/...), parameter decorators (`@Param`/`@Query`/`@Body`), and
 * any `@nestjs/swagger` (`@ApiOperation`/`@ApiParam`/`@ApiProperty`) or
 * `class-validator` metadata it carries.
 */
export interface McpMetadata {
  /**
   * MCP tool name override. When unset it is derived from the controller class
   * and method name (e.g. `ChannelsController.findOne` → `ChannelsFindOne`).
   */
  name?: string
  /**
   * Tool description override. When unset it falls back to the method's
   * `@ApiOperation({ summary | description })`, then a generated default.
   */
  description?: string
  /**
   * Zod raw-shape override merged over the reflected input fields (override
   * wins per field). The escape hatch for shapes reflection can't express
   * losslessly - discriminated unions, custom validators, `@Transform`, etc.
   */
  input?: Record<string, z.ZodType>
  /**
   * Whether to apply the controller method's parameter-bound pipes
   * (`@Param('id', ParseIntPipe)`) when re-binding the call. Default `'apply'`.
   * Global/`ValidationPipe`, interceptors, and exception filters never run -
   * the method is invoked directly, not through Nest's HTTP request pipeline.
   */
  pipes?: 'apply' | 'skip'
  /**
   * Default MCP result format for this tool. `'json'` returns compact JSON text
   * (`jsonToolResult`); `'smart'` (the default when unset) inlines small
   * payloads and offloads large ones to an embedded resource (`smartToolResult`).
   * This is only a default - a client that sends `_meta.disposition` on the tool
   * call overrides it.
   */
  result?: 'json' | 'smart'
}
