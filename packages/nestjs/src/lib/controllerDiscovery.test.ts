import 'reflect-metadata'
import { Body, Controller, Delete, ForbiddenException, Get, Injectable, Param, Post, Put, UseGuards, type CanActivate, type ExecutionContext } from '@nestjs/common'
import { ApplicationConfig, DiscoveryService, MetadataScanner, ModuleRef, Reflector } from '@nestjs/core'
import { createContext, type Action, type SilkweaveContext, type ToolCallEvent } from '@silkweave/core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { Mcp } from '../decorator/mcp.js'
import { Trpc } from '../decorator/trpc.js'
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

function discoverController(controller: object, options: Parameters<ControllerDiscovery['discover']>[0] = {}): Action[] {
  const discovery = { getProviders: () => [], getControllers: () => [{ instance: controller }] } as unknown as DiscoveryService
  const moduleRef = { get: (ref: new () => unknown) => new ref(), create: (ref: new () => unknown) => new ref() } as unknown as ModuleRef
  const cd = new ControllerDiscovery(discovery, new MetadataScanner(), new Reflector(), moduleRef, new ApplicationConfig())
  return cd.discover(options)
}

function discover(): Action[] {
  return discoverController(new MessagesController())
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

@Controller('things')
class ThingsController {
  @Get()
  @Mcp()
  list(): unknown[] { return [] }

  @Put(':id')
  @Mcp()
  replace(@Param('id') id: string): { id: string } { return { id } }

  @Delete(':id')
  @Mcp()
  remove(@Param('id') id: string): { id: string } { return { id } }

  @Post('archive')
  @Mcp({ annotations: { destructiveHint: true } })
  archive(): object { return {} }
}

describe('ControllerDiscovery annotations', () => {
  const byName = (actions: Action[], name: string): Action => actions.find((a) => a.name === name)!

  it('derives read-only + idempotent hints from @Get', () => {
    const actions = discoverController(new ThingsController())
    expect(byName(actions, 'Things.list').annotations).toEqual({ readOnlyHint: true, idempotentHint: true })
  })

  it('derives idempotent (not read-only) from @Put', () => {
    const actions = discoverController(new ThingsController())
    expect(byName(actions, 'Things.replace').annotations).toEqual({ readOnlyHint: false, idempotentHint: true })
  })

  it('derives destructive + idempotent from @Delete', () => {
    const actions = discoverController(new ThingsController())
    expect(byName(actions, 'Things.remove').annotations).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: true })
  })

  it('merges explicit @Mcp({ annotations }) over the verb-derived defaults', () => {
    const actions = discoverController(new ThingsController())
    expect(byName(actions, 'Things.archive').annotations).toEqual({ readOnlyHint: false, destructiveHint: true })
  })
})

const userShape = { id: z.string(), label: z.string() }

@Controller('users')
class StructuredController {
  @Get(':id')
  @Mcp({ result: 'structured', output: userShape })
  get(@Param('id') id: string): { id: string; label: string } { return { id, label: 'Ada' } }
}

@Controller('users')
class StructuredViaTrpcController {
  @Get(':id')
  @Mcp({ result: 'structured' })
  @Trpc({ output: userShape })
  get(@Param('id') id: string): { id: string; label: string } { return { id, label: 'Ada' } }
}

@Controller('users')
class StructuredWithoutOutputController {
  @Get(':id')
  @Mcp({ result: 'structured' })
  get(@Param('id') id: string): { id: string } { return { id } }
}

describe('ControllerDiscovery structured output', () => {
  it('accepts @Mcp({ result: structured, output }) and sets disposition + output on the action', () => {
    const [action] = discoverController(new StructuredController())
    expect(action.disposition).toBe('structured')
    expect(action.output).toBeDefined()
    expect(action.output!.safeParse({ id: 'u1', label: 'x' }).success).toBe(true)
  })

  it('reuses an explicit @Trpc({ output }) as the structured contract', () => {
    const actions = discoverController(new StructuredViaTrpcController())
    const mcpAction = actions.find((a) => a.isEnabled?.(createContext({ adapter: 'mcp' })))!
    expect(mcpAction.disposition).toBe('structured')
    expect(mcpAction.output).toBeDefined()
  })

  it('boot-errors on result: structured without an explicit output schema', () => {
    expect(() => discoverController(new StructuredWithoutOutputController()))
      .toThrow(/requires an explicit output schema/)
  })
})

@Controller('reports')
class ReportsController {
  @Get()
  @Mcp()
  @Trpc()
  list(): { rows: number } { return { rows: 3 } }

  @Post('explode')
  @Trpc()
  explode(): never { throw new ForbiddenException('no access') }
}

describe('ControllerDiscovery telemetry (trpc wrapper)', () => {
  const setup = () => {
    const events: ToolCallEvent[] = []
    const actions = discoverController(new ReportsController(), { onToolCall: (event) => { events.push(event) } })
    return { events, actions }
  }
  const trpcCtx = () => createContext({ adapter: 'trpc' })

  it('emits one trpc event per successful procedure call', async () => {
    const { events, actions } = setup()
    const trpcList = actions.find((a) => a.name === 'Reports.list' && a.isEnabled?.(trpcCtx()))!
    await trpcList.run({}, trpcCtx())
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ action: 'Reports.list', tool: 'reportsList', transport: 'trpc', ok: true })
    expect(events[0].resultBytes).toBeUndefined()
  })

  it('emits ok: false with the mapped http status code on a thrown HttpException', async () => {
    const { events, actions } = setup()
    const explode = actions.find((a) => a.name === 'Reports.explode')!
    await expect(explode.run({}, trpcCtx())).rejects.toThrow('no access')
    expect(events[0]).toMatchObject({ ok: false, transport: 'trpc', errorCode: 'http_error', errorMessage: 'no access' })
  })

  it('does not emit from the MCP action (the MCP registrar owns that seam - no double-fire)', async () => {
    const { events, actions } = setup()
    const mcpList = actions.find((a) => a.name === 'Reports.list' && a.isEnabled?.(createContext({ adapter: 'mcp' })))!
    await mcpList.run({}, createContext({ adapter: 'mcp' }))
    expect(events).toHaveLength(0)
  })

  it('does not emit under the typegen adapter context', async () => {
    const { events, actions } = setup()
    const trpcList = actions.find((a) => a.name === 'Reports.list' && a.isEnabled?.(trpcCtx()))!
    await trpcList.run({}, createContext({ adapter: 'typegen' }))
    expect(events).toHaveLength(0)
  })
})
