import type { Type } from '@nestjs/common'
import type { z } from 'zod/v4'

/** Reflect-metadata key carrying `@Mcp` options on a controller method. */
export const MCP_METADATA = '__silkweave_mcp__'

/** Reflect-metadata key carrying `@Trpc` options on a controller method. */
export const TRPC_METADATA = '__silkweave_trpc__'

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
   * Zod override merged over the reflected input fields (override wins per
   * field). Accepts either a raw shape (`{ field: z.string() }`) or a whole
   * `z.object({ ... })` - the object's `.shape` is unwrapped. The escape hatch
   * for shapes reflection can't express losslessly - discriminated unions,
   * custom validators, `@Transform`, etc. Note it *adds to* the reflected
   * fields; it does not replace them, so a field reflection silently dropped
   * (see the unreflectable-param warning) is not recovered by listing the
   * others here.
   */
  input?: Record<string, z.ZodType> | z.ZodObject
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

/** tRPC procedure kind for a `@Trpc`-decorated route. */
export type TrpcKind = 'query' | 'mutation' | 'subscription'

/**
 * Options for the `@Trpc()` method decorator - the tRPC sibling of `@Mcp`. An
 * empty `@Trpc()` exposes the decorated controller route as a tRPC procedure
 * with its key, input schema, and kind reflected from the route + parameter
 * decorators + swagger/class-validator metadata (identically to `@Mcp`).
 *
 * Unlike MCP, tRPC carries precise *output* types into the generated router, so
 * `@Trpc` adds an `output`/`chunk` hatch and a `kind` override on top of the
 * shared reflection. The two decorators compose on the same method.
 */
export interface TrpcMetadata {
  /**
   * Procedure-name override (before camelCasing). When unset it is derived from
   * the controller class + method name (e.g. `UsersController.listBySpace` →
   * `Users.listBySpace`, camelCased by the router to `usersListBySpace`).
   */
  name?: string
  /**
   * Procedure description override. When unset it falls back to the method's
   * `@ApiOperation({ summary | description })`, then a generated default.
   */
  description?: string
  /**
   * Zod override merged over the reflected input fields (override wins per
   * field). Accepts a raw shape (`{ field: z.string() }`) or a whole
   * `z.object({ ... })` (its `.shape` is unwrapped). Same escape hatch as
   * `@Mcp({ input })`.
   */
  input?: Record<string, z.ZodType> | z.ZodObject
  /**
   * Explicit output schema driving the generated procedure's output type - a Zod
   * type, a DTO class (reflected like `@ApiOkResponse`), or a raw shape (wrapped
   * in `z.object`). Wins over `@ApiOkResponse` reflection. The biggest reason to
   * set this is when the return shape can't be reflected losslessly from a DTO.
   */
  output?: z.ZodType | Type | Record<string, z.ZodType>
  /**
   * Chunk schema for an async-generator route exposed as a tRPC **subscription**.
   * A Zod type or a DTO class. Drives the emitted
   * `TRPCSubscriptionProcedure<{ output }>` type. When unset the chunk type falls
   * back to `unknown`.
   */
  chunk?: z.ZodType | Type
  /**
   * Procedure kind. When unset it is inferred: an `async *` route ⇒
   * `'subscription'`, a `@Get` route ⇒ `'query'`, anything else ⇒ `'mutation'`.
   * Set this to expose a verb-less route (no `@Get`/`@Post`) as a query or
   * subscription - `@Trpc({ kind })` works without an HTTP-verb decorator, so the
   * route is served over tRPC (and/or MCP) without becoming a public REST route.
   */
  kind?: TrpcKind
  /**
   * Whether to apply the method's parameter-bound pipes when re-binding the call.
   * Default `'apply'`. Same semantics as `@Mcp({ pipes })`.
   */
  pipes?: 'apply' | 'skip'
}
