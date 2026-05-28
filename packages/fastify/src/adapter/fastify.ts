import type { FastifyCorsOptions } from '@fastify/cors'
import { AuthConfig, AuthInfo, generateProtectedResourceMetadata, OAuthRequest, OAuthResponse, validateToken } from '@silkweave/auth'
import { Action, ActionStreamRun, AdapterFactory, isStreamingAction, runStreamingAction, SilkweaveContext, SilkweaveError } from '@silkweave/core'
import { buildLogLevels, Logger, LogLevel } from '@silkweave/logger'
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

  const paths = new Set([
    '/.well-known/oauth-authorization-server',
    '/authorize',
    '/auth/callback',
    '/token',
    '/register'
  ])

  instance.get('/.well-known/oauth-authorization-server', async (_req, reply) => {
    return sendOAuth(reply, provider.metadata())
  })
  instance.get('/authorize', async (req, reply) => {
    return sendOAuth(reply, await provider.authorize(toOAuthReq(req)))
  })
  instance.get('/auth/callback', async (req, reply) => {
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
  const streamRun = action.run as ActionStreamRun<object, unknown>
  const iter = streamRun(input, context)
  try {
    for await (const chunk of iter) {
      const payload = JSON.stringify(chunk)
      const line = format === 'sse' ? `data: ${payload}\n\n` : `${payload}\n`
      if (!reply.raw.write(line)) {
        await once(reply.raw, 'drain')
      }
    }
    if (format === 'sse') {
      reply.raw.write('event: done\ndata: {}\n\n')
    }
  } catch (error) {
    const payload = JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'Error'
    })
    if (format === 'sse') {
      reply.raw.write(`event: error\ndata: ${payload}\n\n`)
    } else {
      reply.raw.write(`${payload}\n`)
    }
  } finally {
    reply.raw.end()
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
        await instance.register(import('@scalar/fastify-api-reference'), { routePrefix: '/' })

        if (auth?.authorizationServers?.length && auth.resourceUrl) {
          instance.get('/.well-known/oauth-protected-resource', () => {
            return generateProtectedResourceMetadata(auth.resourceUrl!, auth.authorizationServers!)
          })
        }

        const oauthPaths = auth?.provider ? mountOAuthRoutes(instance, auth) : new Set<string>()

        if (auth) {
          mountAuthMiddleware(instance, auth, oauthPaths, context)
        }

        instance.setErrorHandler((error, _request, reply) => {
          if (error instanceof SilkweaveError) {
            return reply.status(error.statusCode).send({ error: error.code, message: error.message })
          }
          if (error instanceof z.ZodError) {
            return reply.status(400).send({ error: 'validation_error', issues: error.issues })
          }
          instance.log.error(error)
          return reply.status(500).send({ error: 'internal', message: 'Internal server error' })
        })

        const logger = createActionLogger(instance)

        for (const action of actions) {
          const schema = z.toJSONSchema(action.input) as { properties?: Record<string, unknown>; required?: string[] }
          const streaming = isStreamingAction(action)
          instance.post(`/${action.name}`, {
            schema: {
              description: action.description,
              body: {
                type: 'object',
                properties: schema.properties,
                required: schema.required
              },
              response: {
                200: { description: 'Successful response' }
              }
            }
          }, async (request, reply) => {
            const authInfo = auth ? (request as FastifyRequest & { __silkweave_auth?: AuthInfo }).__silkweave_auth : undefined
            const actionContext = context.fork({ logger, request, ...(authInfo ? { auth: authInfo } : {}) })
            if (streaming) {
              const format = pickStreamFormat(request.headers.accept)
              if (format) {
                await streamAction(reply, format, action, request.body as object, actionContext)
                return reply
              }
              return runStreamingAction(action, request.body as object, actionContext)
            }
            return action.run(request.body, actionContext)
          })
        }
        await instance.listen({ host, port })
      },
      stop: async () => { await instance.close() }
    }
  }
}
