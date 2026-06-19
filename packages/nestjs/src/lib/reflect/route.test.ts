import 'reflect-metadata'
import { Controller, Delete, Get, Head, Options, Patch, Post, Put } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { reflectRoute } from './route.js'

@Controller('sessions/:sessionId')
class ScopedController {
  @Get('channels/:channelId') list(): void {}
  @Post() create(): void {}
  @Put('rename') rename(): void {}
  @Delete() remove(): void {}
  @Patch() patch(): void {}
  @Options() opts(): void {}
  @Head() head(): void {}
  @Get() root(): void {}
}

@Controller('/api/')
class SlashyController {
  @Get('/users/') users(): void {}
}

@Controller()
class PrefixlessController {
  @Get('health') health(): void {}
}

function handler(c: { prototype: object }, name: string): (...args: unknown[]) => unknown {
  return (c.prototype as Record<string, (...args: unknown[]) => unknown>)[name]
}

describe('reflectRoute', () => {
  it('composes controller + method path, extracts params, and builds the OpenAPI path', () => {
    const route = reflectRoute(ScopedController, handler(ScopedController, 'list'))
    expect(route).toEqual({
      method: 'GET',
      path: 'sessions/:sessionId/channels/:channelId',
      openapiPath: '/sessions/{sessionId}/channels/{channelId}',
      pathParams: ['sessionId', 'channelId']
    })
  })

  it('falls back to the controller path when the method has none', () => {
    const route = reflectRoute(ScopedController, handler(ScopedController, 'create'))
    expect(route.method).toBe('POST')
    expect(route.path).toBe('sessions/:sessionId')
    expect(route.pathParams).toEqual(['sessionId'])
  })

  it('maps each HTTP verb', () => {
    const verb = (name: string): string => reflectRoute(ScopedController, handler(ScopedController, name)).method
    expect(verb('rename')).toBe('PUT')
    expect(verb('remove')).toBe('DELETE')
    expect(verb('patch')).toBe('PATCH')
    expect(verb('opts')).toBe('OPTIONS')
    expect(verb('head')).toBe('HEAD')
    expect(verb('root')).toBe('GET')
  })

  it('normalizes leading/trailing slashes when joining segments', () => {
    const route = reflectRoute(SlashyController, handler(SlashyController, 'users'))
    expect(route.path).toBe('api/users')
    expect(route.openapiPath).toBe('/api/users')
  })

  it('handles a prefixless controller', () => {
    const route = reflectRoute(PrefixlessController, handler(PrefixlessController, 'health'))
    expect(route.path).toBe('health')
    expect(route.pathParams).toEqual([])
  })

  it('defaults to GET / empty path when there is no routing metadata', () => {
    expect(reflectRoute(class Plain {}, function bare(): void {})).toEqual({
      method: 'GET',
      path: '',
      openapiPath: '/',
      pathParams: []
    })
  })
})
