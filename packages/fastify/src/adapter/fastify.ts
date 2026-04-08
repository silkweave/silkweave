import { AuthConfig, AuthInfo, generateProtectedResourceMetadata, OAuthRequest, OAuthResponse, validateToken } from '@silkweave/auth'
import { AdapterFactory } from '@silkweave/core'
import { buildLogLevels, Logger, LogLevel } from '@silkweave/logger'
import { FastifyBaseLogger, FastifyHttpOptions, fastify as fastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Server } from 'http'

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
}

export const fastify: AdapterFactory<FastifyAdapterOptions> = ({ host, port, auth, ...fastifyOptions }) => {
  const instance = fastifyInstance(fastifyOptions)
  return (options, baseContext) => {
    const context = baseContext.fork({ adapter: 'fastify' })
    return {
      context,
      start: async (actions) => {
        await instance.register(import('@fastify/swagger'), {
          openapi: {
            info: {
              title: options.name,
              description: options.description,
              version: options.version
            }
          }
        })
        await instance.register(import('@scalar/fastify-api-reference'), { routePrefix: '/' as `/${string}` })

        if (auth?.authorizationServers?.length && auth.resourceUrl) {
          instance.get('/.well-known/oauth-protected-resource', () => {
            return generateProtectedResourceMetadata(auth.resourceUrl!, auth.authorizationServers!)
          })
        }

        const oauthPaths = new Set<string>()
        if (auth?.provider) {
          const provider = auth.provider
          const toOAuthReq = (request: FastifyRequest): OAuthRequest => ({
            method: request.method,
            url: new URL(request.url, `http://${request.hostname}`),
            headers: Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])),
            body: request.body as Record<string, string> | undefined
          })
          const sendOAuth = (reply: FastifyReply, oauthRes: OAuthResponse) => {
            for (const [key, value] of Object.entries(oauthRes.headers)) { reply.header(key, value) }
            return reply.status(oauthRes.status).send(oauthRes.body)
          }

          oauthPaths.add('/.well-known/oauth-authorization-server')
          oauthPaths.add('/authorize')
          oauthPaths.add('/auth/callback')
          oauthPaths.add('/token')
          oauthPaths.add('/register')

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
        }

        if (auth) {
          instance.decorateRequest('__silkweave_auth', undefined)
          instance.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
            if (request.url.startsWith('/.well-known/') || oauthPaths.has(request.url.split('?')[0])) { return }
            const result = await validateToken(request.headers.authorization, auth)
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

        for (const action of actions) {
          const schema = action.input.toJSONSchema()
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
          }, (request) => {
            const logger: Logger = {
              ...buildLogLevels((level, data) => {
                const pinoLevel = PINO_LEVEL_MAP[level] ?? 'info'
                instance.log[pinoLevel](data)
              }),
              progress: ({ progress, total, message }) => { instance.log.trace({ progress, total }, message) }
            }
            const authInfo = auth ? (request as FastifyRequest & { __silkweave_auth?: AuthInfo }).__silkweave_auth : undefined
            return action.run(request.body, context.fork({ logger, request, ...(authInfo ? { auth: authInfo } : {}) }))
          })
        }
        await instance.listen({ host, port })
      },
      stop: async () => { await instance.close() }
    }
  }
}
