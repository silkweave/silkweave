import 'reflect-metadata'
import { Body, Controller, ForbiddenException, Injectable, Post, UseGuards, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { ApplicationConfig, DiscoveryService, MetadataScanner, ModuleRef, Reflector } from '@nestjs/core'
import { createContext, type Action, type SilkweaveContext } from '@silkweave/core'
import { describe, expect, it } from 'vitest'
import { Mcp } from '../decorator/mcp.js'
import { ControllerDiscovery } from './controllerDiscovery.js'

// API key -> the WhatsApp sessions it is scoped to (OpenWA-style per-key scoping).
const ALLOWED: Record<string, string[]> = { 'key-a': ['session-a'], 'key-b': ['session-b'] }

@Injectable()
class ApiKeySessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers?: Record<string, unknown>; body?: Record<string, unknown> }>()
    const key = String(req.headers?.['x-api-key'] ?? '')
    const sessionId = String(req.body?.sessionId ?? '')
    if (!(ALLOWED[key] ?? []).includes(sessionId)) {
      throw new ForbiddenException('session not allowed for this api key')
    }
    return true
  }
}

@Controller('messages')
class MessagesController {
  @Post()
  @UseGuards(ApiKeySessionGuard)
  @Mcp({ description: 'Send a WhatsApp message' })
  send(@Body('sessionId') sessionId: string, @Body('text') text: string): { sent: true; sessionId: string; text: string } {
    return { sent: true, sessionId, text }
  }
}

function discover(): Action[] {
  const controller = new MessagesController()
  const discovery = { getProviders: () => [], getControllers: () => [{ instance: controller }] } as unknown as DiscoveryService
  const moduleRef = { get: (ref: new () => unknown) => new ref(), create: (ref: new () => unknown) => new ref() } as unknown as ModuleRef
  const cd = new ControllerDiscovery(discovery, new MetadataScanner(), new Reflector(), moduleRef, new ApplicationConfig())
  return cd.discover()
}

/** A forked MCP context carrying the inbound tool-call headers, as the transport would supply. */
function mcpContext(apiKey: string | null): SilkweaveContext {
  const request = apiKey === null ? undefined : { headers: { 'x-api-key': apiKey } }
  return createContext({ adapter: 'mcp', ...(request ? { request } : {}) })
}

describe('ControllerDiscovery (integration)', () => {
  it('synthesizes one MCP action per @Mcp method, named <Base>.<method>', () => {
    const actions = discover()
    expect(actions).toHaveLength(1)
    expect(actions[0].name).toBe('Messages.send')
    expect(actions[0].description).toBe('Send a WhatsApp message')
  })

  it('reflects the @Body fields into the action input schema', () => {
    const [action] = discover()
    expect(Object.keys(action.input.shape).sort()).toEqual(['sessionId', 'text'])
  })

  it('gates the action to the mcp adapter via isEnabled', () => {
    const [action] = discover()
    expect(action.isEnabled?.(mcpContext('key-a'))).toBe(true)
    expect(action.isEnabled?.(createContext({ adapter: 'trpc' }))).toBe(false)
  })

  it('allows a tool call whose key is scoped to the requested session, returning the handler result', async () => {
    const [action] = discover()
    const result: unknown = await action.run({ sessionId: 'session-a', text: 'hi' }, mcpContext('key-a'))
    expect(result).toEqual({ sent: true, sessionId: 'session-a', text: 'hi' })
  })

  it('denies a key trying to reach another key\'s session (the acceptance scenario)', async () => {
    const [action] = discover()
    await expect(action.run({ sessionId: 'session-b', text: 'hi' }, mcpContext('key-a'))).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('denies an unknown api key', async () => {
    const [action] = discover()
    await expect(action.run({ sessionId: 'session-a', text: 'hi' }, mcpContext('bogus'))).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('fails closed when the call carries no request at all (no header => denied)', async () => {
    const [action] = discover()
    await expect(action.run({ sessionId: 'session-a', text: 'hi' }, mcpContext(null))).rejects.toBeInstanceOf(ForbiddenException)
  })
})
