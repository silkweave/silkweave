import { AuthConfig } from '@silkweave/auth'
import { AdapterFactory } from '@silkweave/core'
import { CorsOptions } from 'cors'
import { Express } from 'express'
import { Server } from 'http'
import { createMcpExpressHandler, CreateMcpExpressHandlerOptions } from '../lib/handler.js'

export interface HttpAdapterOptions extends Omit<CreateMcpExpressHandlerOptions, 'auth' | 'cors'> {
  host: string
  port: number
  auth?: AuthConfig
  /** CORS configuration. `false` to disable, `true`/`undefined` for permissive defaults, or a CorsOptions object. */
  cors?: CorsOptions | boolean
}

export const http: AdapterFactory<HttpAdapterOptions> = ({ host, port, auth, cors: corsConfig, ...mcpOptions }) => {
  return (options, baseContext) => {
    const context = baseContext.fork({ adapter: 'http' })
    let httpServer: Server | undefined
    let app: Express | undefined
    return {
      context,
      start: async (actions) => {
        app = createMcpExpressHandler(options, context, actions, { ...mcpOptions, host, auth, cors: corsConfig })
        httpServer = app.listen(port, host, (error) => {
          if (error) {
            console.error('Failed to start server:', error)
            process.exit(1)
          }
          console.log(`MCP Streamable HTTP Server listening on http://${host}:${port}/mcp`)
        })
      },
      stop: async () => {
        if (httpServer) {
          await new Promise<void>((resolve, reject) => {
            return httpServer!.close((err) => {
              if (err) {
                reject(err)
              } else {
                resolve()
              }
            })
          })
        }
        httpServer = undefined
      }
    }
  }
}
