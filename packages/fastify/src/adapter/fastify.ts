import type { FastifyCorsOptions } from '@fastify/cors'
import { AuthConfig, AuthInfo, generateProtectedResourceMetadata, OAuthRequest, OAuthResponse, validateToken } from '@silkweave/auth'
import { Action, actionMethod, ActionStreamRun, AdapterFactory, binarySchemaMeta, buildLogLevels, HttpMethod, isBinarySchema, isStreamingAction, Logger, LogLevel, methodHasBody, pathParamNames, resolveActionInput, resourceBytes, runStreamingAction, SilkweaveContext, SilkweaveError, toActionResource, validateActionRouting, type ActionResource } from '@silkweave/core'
import { once } from 'events'
import { FastifyBaseLogger, FastifyHttpOptions, fastify as fastifyInstance, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Server } from 'http'
import z from 'zod/v4'

type FastifyLogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace'

const PINO_LEVEL_MAP: Record<LogLevel, FastifyLogLevel> = {
  emergency: 'fatal',
  alert: 'fatal',
  critical: 'fatal',
  error: 'error',
  warning: 'warn',
  notice: 'debug',
  info: 'info',
  debug: 'debug'
}

export interface FastifyAdapterOptions extends FastifyHttpOptions<Server, FastifyBaseLogger> {
  host?: string
  port?: number
  auth?: AuthConfig
  /** CORS configuration. `false` to disable, `true`/`undefined` for permissive defaults, or a FastifyCorsOptions object. */
  cors?: FastifyCorsOptions | boolean
}

function toOAuthReq(request: FastifyRequest): OAuthRequest {
  return {
    method: request.method,
    url: new URL(request.url, `http://${request.hostname}`),
    headers: Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])),
    body: request.body as Record<string, string> | undefined
  }
}

function sendOAuth(reply: FastifyReply, oauthRes: OAuthResponse) {
  for (const [key, value] of Object.entries(oauthRes.headers)) { reply.header(key, value) }
  return reply.status(oauthRes.status).send(oauthRes.body)
}

function mountOAuthRoutes(instance: FastifyInstance, auth: AuthConfig): Set<string> {
  const provider = auth.provider!
  // The provider builds its upstream redirect_uri as `${resourceUrl}${callbackPath}`,
  // so the callback route must match the configured callbackPath, not a hardcoded one.
  const callbackPath = auth.callbackPath ?? '/auth/callback'

  const paths = new Set([
    '/.well-known/oauth-authorization-server',
    '/authorize',
    callbackPath,
    '/token',
    '/register'
  ])

  instance.get('/.well-known/oauth-authorization-server', async (_req, reply) => {
    return sendOAuth(reply, provider.metadata())
  })
  instance.get('/authorize', async (req, reply) => {
    return sendOAuth(reply, await provider.authorize(toOAuthReq(req)))
  })
  instance.get(callbackPath, async (req, reply) => {
    return sendOAuth(reply, await provider.callback(toOAuthReq(req)))
  })
  instance.post('/token', async (req, reply) => {
    return sendOAuth(reply, await provider.token(toOAuthReq(req)))
  })
  instance.post('/register', async (req, reply) => {
    return sendOAuth(reply, await provider.register(toOAuthReq(req)))
  })

  return paths
}

function mountAuthMiddleware(instance: FastifyInstance, auth: AuthConfig, oauthPaths: Set<string>, context: SilkweaveContext) {
  instance.decorateRequest('__silkweave_auth', undefined)
  instance.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url.startsWith('/.well-known/') || oauthPaths.has(request.url.split('?')[0])) { return }
    const result = await validateToken(request.headers.authorization, auth, context.fork({ request }))
    if (result.error) {
      for (const [key, value] of Object.entries(result.error.headers)) {
        reply.header(key, value)
      }
      return reply.status(result.error.statusCode).send(result.error.body)
    }
    if (result.auth) {
      (request as FastifyRequest & { __silkweave_auth?: AuthInfo }).__silkweave_auth = result.auth
    }
  })
}

type StreamFormat = 'sse' | 'ndjson'

function pickStreamFormat(acceptHeader: string | undefined): StreamFormat | null {
  if (!acceptHeader) { return null }
  if (acceptHeader.includes('text/event-stream')) { return 'sse' }
  if (acceptHeader.includes('application/x-ndjson') || acceptHeader.includes('application/ndjson')) { return 'ndjson' }
  return null
}

function encodeChunk(format: StreamFormat, chunk: unknown): string {
  const payload = JSON.stringify(chunk)
  return format === 'sse' ? `data: ${payload}\n\n` : `${payload}\n`
}

function encodeStreamError(format: StreamFormat, error: unknown): string {
  const payload = JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : 'Error'
  })
  return format === 'sse' ? `event: error\ndata: ${payload}\n\n` : `${payload}\n`
}

async function streamAction(
  reply: FastifyReply,
  format: StreamFormat,
  action: Action,
  input: object,
  context: SilkweaveContext
): Promise<void> {
  reply.raw.setHeader('Content-Type', format === 'sse' ? 'text/event-stream' : 'application/x-ndjson')
  reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
  reply.raw.setHeader('Connection', 'keep-alive')
  reply.raw.flushHeaders?.()
  reply.hijack()
  const raw = reply.raw
  const iter = (action.run as ActionStreamRun<object, unknown>)(input, context)
  // On client disconnect the next write() returns false and a plain
  // `once(raw, 'drain')` would park forever - the generator would never resume,
  // its finally/cleanup would never run, and response/context stay pinned. Track
  // 'close' and race the drain against it so we bail and tear the generator down.
  const gone = { value: raw.destroyed || raw.writableEnded }
  const onClose = () => { gone.value = true }
  raw.on('close', onClose)
  const closed = once(raw, 'close')
  try {
    for await (const chunk of iter) {
      if (gone.value) { break }
      if (!raw.write(encodeChunk(format, chunk))) {
        await Promise.race([once(raw, 'drain'), closed])
        if (gone.value) { break }
      }
    }
    if (!gone.value && format === 'sse') { raw.write('event: done\ndata: {}\n\n') }
  } catch (error) {
    if (!gone.value) { raw.write(encodeStreamError(format, error)) }
  } finally {
    raw.off('close', onClose)
    // Ask the generator to run its finally/cleanup (release DB handles etc).
    await iter.return?.().catch(() => { /* generator cleanup best-effort */ })
    if (!raw.writableEnded) { raw.end() }
  }
}

function createActionLogger(instance: FastifyInstance): Logger {
  return {
    ...buildLogLevels((level, data) => {
      const pinoLevel = PINO_LEVEL_MAP[level] ?? 'info'
      instance.log[pinoLevel](data)
    }),
    progress: ({ progress, total, message }) => { instance.log.trace({ progress, total }, message) }
  }
}

interface ObjectSchema {
  type: 'object'
  properties: Record<string, unknown>
  required: string[]
}

/**
 * Split an action's input JSON Schema into Fastify `params`/`querystring`/`body`
 * schemas based on its `path` placeholders and `queryParams`. Fastify's own AJV
 * validation, type coercion, and default-filling then apply per source, and the
 * three are merged back into a single input by `resolveActionInput` at runtime.
 */
function splitInputSchema(action: Action, method: HttpMethod): {
  params?: ObjectSchema
  querystring?: ObjectSchema
  body?: ObjectSchema
} {
  const json = z.toJSONSchema(action.input) as { properties?: Record<string, unknown>; required?: string[] }
  const properties = json.properties ?? {}
  const required = new Set(json.required ?? [])
  const pathParams = new Set(pathParamNames(action.path))
  const queryKeys = new Set((action.queryParams ?? []).map(String))
  const hasBody = methodHasBody(method)

  const params: ObjectSchema = { type: 'object', properties: {}, required: [] }
  const querystring: ObjectSchema = { type: 'object', properties: {}, required: [] }
  const body: ObjectSchema = { type: 'object', properties: {}, required: [] }

  for (const [key, prop] of Object.entries(properties)) {
    if (pathParams.has(key)) {
      params.properties[key] = prop
      params.required.push(key)
    } else if (!hasBody || queryKeys.has(key)) {
      querystring.properties[key] = prop
      if (required.has(key)) { querystring.required.push(key) }
    } else {
      body.properties[key] = prop
      if (required.has(key)) { body.required.push(key) }
    }
  }

  return {
    params: Object.keys(params.properties).length ? params : undefined,
    querystring: Object.keys(querystring.properties).length ? querystring : undefined,
    body: hasBody && Object.keys(body.properties).length ? body : undefined
  }
}

/** Strip characters that would break (or smuggle headers into) an HTTP header value. */
function headerSafe(value: string): string {
  return value.replace(/["\r\n]/g, ' ').trim()
}

/**
 * Send a resource result as a raw HTTP body: bytes with `Content-Type` from
 * the resource's media type, a `Content-Disposition` filename when the
 * resource carries a name, and the description (if any) as
 * `Content-Description` - over REST the binary itself IS the response, so the
 * metadata rides in headers.
 */
function sendResource(reply: FastifyReply, res: ActionResource) {
  reply.header('Content-Type', res.mimeType)
  if (res.name) { reply.header('Content-Disposition', `inline; filename="${headerSafe(res.name)}"`) }
  if (res.description) { reply.header('Content-Description', headerSafe(res.description)) }
  return reply.send(Buffer.from(resourceBytes(res)))
}

/**
 * OpenAPI response schema: binary actions document their payload as
 * `type: string, format: binary` under the declared media type.
 */
function responseSchema(action: Action) {
  if (!isBinarySchema(action.output)) {
    return { 200: { description: 'Successful response' } }
  }
  const mimeType = binarySchemaMeta(action.output).mimeType ?? 'application/octet-stream'
  return {
    200: {
      description: 'Successful response',
      content: { [mimeType]: { schema: { type: 'string', format: 'binary' } } }
    }
  }
}

/**
 * Register the Scalar API-reference UI. It's an optional peer, so a missing
 * module is skipped with a hint rather than crashing a headless deployment.
 * Resolving the import here (vs. handing `register` a rejecting plugin promise)
 * is what makes the absence catchable now instead of later during `listen`.
 */
async function registerScalarDocs(instance: FastifyInstance): Promise<void> {
  const scalar = await import('@scalar/fastify-api-reference').catch((error: unknown) => {
    const code = (error as { code?: string }).code
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      instance.log.info('@scalar/fastify-api-reference is not installed - skipping the API reference UI. Install it to enable the docs UI.')
      return null
    }
    throw error
  })
  if (scalar) {
    await instance.register(scalar.default, { routePrefix: '/' })
  }
}

/** The instance-wide error handler: Silkweave/Zod/AJV failures map to legible statuses. */
function errorHandler(instance: FastifyInstance) {
  return (error: Error, _request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof SilkweaveError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message })
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: 'validation_error', issues: error.issues })
    }
    // Fastify's schema (AJV) validation failures for body/querystring/params.
    const validation = (error as { validation?: unknown }).validation
    if (validation) {
      return reply.status(400).send({ error: 'validation_error', issues: validation })
    }
    instance.log.error(error)
    return reply.status(500).send({ error: 'internal', message: 'Internal server error' })
  }
}

/** Register one action as a Fastify route (validation, streaming, resource, and JSON paths). */
function registerActionRoute(instance: FastifyInstance, action: Action, context: SilkweaveContext, logger: Logger, hasAuth: boolean) {
  validateActionRouting(action)
  const method = actionMethod(action)
  const url = action.path ? `/${action.path.replace(/^\//, '')}` : `/${action.name}`
  const { params, querystring, body } = splitInputSchema(action, method)
  const streaming = isStreamingAction(action)
  instance.route({
    method,
    url,
    schema: {
      description: action.description,
      ...(params ? { params } : {}),
      ...(querystring ? { querystring } : {}),
      ...(body ? { body } : {}),
      response: responseSchema(action)
    },
    handler: async (request, reply) => {
      const authInfo = hasAuth ? (request as FastifyRequest & { __silkweave_auth?: AuthInfo }).__silkweave_auth : undefined
      const actionContext = context.fork({ logger, request, ...(authInfo ? { auth: authInfo } : {}) })
      // Fastify's AJV only validates the JSON-Schema projection, which
      // cannot express Zod refinements/transforms. Parse the merged input
      // so .refine()/.email()/.transform() are enforced here as they are
      // over MCP/tRPC/CLI (a ZodError becomes a 400 via setErrorHandler).
      const input = action.input.parse(resolveActionInput(action, {
        params: request.params as Record<string, string | undefined>,
        query: request.query as Record<string, unknown>,
        body: request.body
      }))
      if (streaming) {
        const format = pickStreamFormat(request.headers.accept)
        if (format) {
          await streamAction(reply, format, action, input, actionContext)
          return reply
        }
        return runStreamingAction(action, input, actionContext)
      }
      const result = await (action.run as (input: object, context: SilkweaveContext) => Promise<object>)(input, actionContext)
      // A resource result (resource()/File/Blob/bytes) leaves as raw
      // bytes with mime headers instead of JSON.
      const res = await toActionResource(result, binarySchemaMeta(action.output))
      if (res) { return sendResource(reply, res) }
      return result
    }
  })
}

export const fastify: AdapterFactory<FastifyAdapterOptions> = ({ host, port, auth, cors: corsConfig, ...fastifyOptions }) => {
  const instance = fastifyInstance(fastifyOptions)
  return (options, baseContext) => {
    const context = baseContext.fork({ adapter: 'fastify' })
    return {
      context,
      start: async (actions) => {
        if (corsConfig !== false) {
          const userConfig = corsConfig === true || corsConfig === undefined ? {} : corsConfig
          await instance.register(import('@fastify/cors'), { origin: '*', ...userConfig })
        }

        await instance.register(import('@fastify/swagger'), {
          openapi: {
            info: {
              title: options.name,
              description: options.description,
              version: options.version
            }
          }
        })
        await registerScalarDocs(instance)

        if (auth?.authorizationServers?.length && auth.resourceUrl) {
          instance.get('/.well-known/oauth-protected-resource', () => {
            return generateProtectedResourceMetadata(auth.resourceUrl!, auth.authorizationServers!, auth.requiredScopes)
          })
        }

        const oauthPaths = auth?.provider ? mountOAuthRoutes(instance, auth) : new Set<string>()

        if (auth) {
          mountAuthMiddleware(instance, auth, oauthPaths, context)
        }

        instance.setErrorHandler(errorHandler(instance))

        const logger = createActionLogger(instance)

        for (const action of actions) {
          registerActionRoute(instance, action, context, logger, Boolean(auth))
        }
        await instance.listen({ host, port })
      },
      stop: async () => { await instance.close() }
    }
  }
}
