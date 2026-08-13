import 'reflect-metadata'
import { ForbiddenException, type CanActivate, type ExecutionContext, type Type } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants.js'
import { ApplicationConfig, ModuleRef, Reflector } from '@nestjs/core'
import { of } from 'rxjs'
import { describe, expect, it } from 'vitest'
import { collectGlobalGuards, collectGuards, runGuards } from './guards.js'

class Allow implements CanActivate {
  canActivate(): boolean {
    return true
  }
}
class Deny implements CanActivate {
  canActivate(): boolean {
    return false
  }
}

const reflector = new Reflector()
const moduleRef = {
  get: (ref: Type<CanActivate>): CanActivate => new ref(),
  create: (ref: Type<CanActivate>): CanActivate => new ref()
} as unknown as ModuleRef
class Ctrl {}
const handler = function route(): void {}
const CtrlRef = Ctrl as Type<unknown>

describe('collectGuards', () => {
  it('merges class then method @UseGuards, class first (matching Nest order)', () => {
    class ClassGuard implements CanActivate {
      canActivate(): boolean {
        return true
      }
    }
    class MethodGuard implements CanActivate {
      canActivate(): boolean {
        return true
      }
    }
    const cls = class {}
    const fn = function route(): void {}
    Reflect.defineMetadata(GUARDS_METADATA, [ClassGuard], cls)
    Reflect.defineMetadata(GUARDS_METADATA, [MethodGuard], fn)

    expect(collectGuards(reflector, cls, fn)).toEqual([ClassGuard, MethodGuard])
  })

  it('returns an empty list when neither carries guard metadata', () => {
    expect(collectGuards(reflector, class Empty {}, function bare(): void {})).toEqual([])
  })
})

describe('collectGlobalGuards', () => {
  class AllowedGlobal implements CanActivate {
    canActivate(): boolean {
      return true
    }
  }
  class OtherGlobal implements CanActivate {
    canActivate(): boolean {
      return true
    }
  }

  function appConfig(globals: CanActivate[], requestGuards: CanActivate[] = []): ApplicationConfig {
    return {
      getGlobalGuards: (): CanActivate[] => globals,
      getGlobalRequestGuards: (): { instance: CanActivate }[] => requestGuards.map((instance) => ({ instance }))
    } as unknown as ApplicationConfig
  }

  it('returns nothing when the allow-list is empty (default: no globals over MCP)', () => {
    expect(collectGlobalGuards(appConfig([new AllowedGlobal()]), [])).toEqual([])
  })

  it('keeps only allow-listed global instances', () => {
    const allowed = new AllowedGlobal()
    const result = collectGlobalGuards(appConfig([allowed, new OtherGlobal()]), [AllowedGlobal])
    expect(result).toEqual([allowed])
  })

  it('reads APP_GUARD instances from getGlobalRequestGuards', () => {
    const allowed = new AllowedGlobal()
    const result = collectGlobalGuards(appConfig([], [allowed, new OtherGlobal()]), [AllowedGlobal])
    expect(result).toEqual([allowed])
  })
})

describe('runGuards', () => {
  function run(
    guards: (CanActivate | Type<CanActivate>)[],
    request: unknown = { headers: {} },
    contextType: 'http' | 'rpc' = 'http'
  ): Promise<void> {
    return runGuards(guards, moduleRef, reflector, CtrlRef, handler, request, null, contextType)
  }

  it('resolves when every guard allows', async () => {
    await expect(run([new Allow(), new Allow()])).resolves.toBeUndefined()
  })

  it('throws ForbiddenException when any guard denies', async () => {
    await expect(run([new Allow(), new Deny()])).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('is a no-op for an empty guard list', async () => {
    await expect(run([])).resolves.toBeUndefined()
  })

  it('awaits observable and promise verdicts', async () => {
    const obsAllow: CanActivate = { canActivate: () => of(true) }
    const obsDeny: CanActivate = { canActivate: () => of(false) }
    const promiseAllow: CanActivate = { canActivate: (): Promise<boolean> => Promise.resolve(true) }
    await expect(run([obsAllow, promiseAllow])).resolves.toBeUndefined()
    await expect(run([obsDeny])).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('instantiates class-ref guards via the module ref', async () => {
    await expect(run([Allow])).resolves.toBeUndefined()
    await expect(run([Deny])).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('hands the guard a context whose request + transport type are faithful', async () => {
    const request = { headers: { 'x-api-key': 'secret' } }
    let seenKey: unknown
    let seenType: string | undefined
    const apiKeyGuard: CanActivate = {
      canActivate: (ctx: ExecutionContext): boolean => {
        seenKey = ctx.switchToHttp().getRequest<{ headers: Record<string, unknown> }>().headers['x-api-key']
        seenType = ctx.getType()
        return true
      }
    }
    await run([apiKeyGuard], request, 'http')
    expect(seenKey).toBe('secret')
    expect(seenType).toBe('http')
  })

  it('stops at the first denying guard (short-circuits)', async () => {
    let reached = false
    const after: CanActivate = {
      canActivate: (): boolean => {
        reached = true
        return true
      }
    }
    await expect(run([new Deny(), after])).rejects.toBeInstanceOf(ForbiddenException)
    expect(reached).toBe(false)
  })
})
