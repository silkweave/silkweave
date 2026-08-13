import { describe, expect, it } from 'vitest'
import z from 'zod/v4'
import type { Action, ActionKind, HttpMethod } from './action.js'
import { SilkweaveError } from './error.js'
import { actionMethod, methodHasBody, pathParamNames, resolveActionInput, validateActionRouting } from './http.js'

interface ActionOpts {
  name?: string
  kind?: ActionKind
  method?: HttpMethod
  path?: string
  queryParams?: string[]
}

/** Build a minimal Action - the http helpers only read name/input/method/kind/path/queryParams. */
function makeAction(input: z.ZodObject, opts: ActionOpts = {}): Action {
  return { name: 'test.action', description: '', input, ...opts } as unknown as Action
}

describe('actionMethod', () => {
  it('honours an explicit method over the kind default', () => {
    expect(actionMethod({ method: 'PUT', kind: 'query' })).toBe('PUT')
  })

  it('defaults queries to GET and everything else to POST', () => {
    expect(actionMethod({ kind: 'query' })).toBe('GET')
    expect(actionMethod({ kind: 'mutation' })).toBe('POST')
    expect(actionMethod({})).toBe('POST')
  })
})

describe('methodHasBody', () => {
  it('is false only for GET', () => {
    expect(methodHasBody('GET')).toBe(false)
    for (const m of ['POST', 'PUT', 'DELETE'] as const) {
      expect(methodHasBody(m)).toBe(true)
    }
  })
})

describe('pathParamNames', () => {
  it('extracts :param names in order', () => {
    expect(pathParamNames('spaces/:spaceId/users/:userId')).toEqual(['spaceId', 'userId'])
  })

  it('returns [] for no params or undefined', () => {
    expect(pathParamNames('spaces/users')).toEqual([])
    expect(pathParamNames(undefined)).toEqual([])
  })
})

describe('validateActionRouting', () => {
  it('passes when every path param and query param is an input field', () => {
    const action = makeAction(z.object({ spaceId: z.string(), offset: z.number().optional() }), {
      path: 'spaces/:spaceId/users',
      queryParams: ['offset']
    })
    expect(() => validateActionRouting(action)).not.toThrow()
  })

  it('throws when a :param is absent from the input schema', () => {
    const action = makeAction(z.object({ spaceId: z.string() }), { path: 'spaces/:spaceId/users/:userId' })
    expect(() => validateActionRouting(action)).toThrowError(SilkweaveError)
  })

  it('throws when a queryParams entry is absent from the input schema', () => {
    const action = makeAction(z.object({ name: z.string() }), { queryParams: ['offset'] })
    expect(() => validateActionRouting(action)).toThrowError(SilkweaveError)
  })
})

describe('resolveActionInput', () => {
  it('reads every non-path field from the query string on a bodyless GET, coercing scalars', () => {
    const action = makeAction(
      z.object({
        spaceId: z.string(),
        offset: z.number().optional(),
        limit: z.number().optional(),
        flag: z.boolean().optional()
      }),
      { kind: 'query', path: 'spaces/:spaceId/users' }
    )
    const input = resolveActionInput(action, {
      params: { spaceId: 'sp1' },
      query: { offset: '5', limit: '10', flag: 'true' }
    })
    expect(input).toEqual({ spaceId: 'sp1', offset: 5, limit: 10, flag: true })
  })

  it('reads only declared queryParams from the query on a body method, body forming the base', () => {
    const action = makeAction(z.object({ name: z.string(), offset: z.number().optional() }), {
      method: 'POST',
      queryParams: ['offset']
    })
    const input = resolveActionInput(action, { body: { name: 'ada' }, query: { offset: '7', other: 'x' } })
    expect(input).toEqual({ name: 'ada', offset: 7 })
  })

  it('applies precedence body < query < path', () => {
    const action = makeAction(z.object({ id: z.string(), tag: z.string().optional() }), {
      method: 'PUT',
      path: 'items/:id',
      queryParams: ['tag']
    })
    const input = resolveActionInput(action, {
      params: { id: 'fromPath' },
      query: { tag: 'fromQuery' },
      body: { id: 'fromBody', tag: 'fromBody' }
    })
    expect(input).toEqual({ id: 'fromPath', tag: 'fromQuery' })
  })

  it('passes array query values through without scalar coercion', () => {
    const action = makeAction(z.object({ tags: z.array(z.string()).optional() }), { kind: 'query' })
    expect(resolveActionInput(action, { query: { tags: ['a', 'b'] } })).toEqual({ tags: ['a', 'b'] })
  })

  it('leaves un-coercible scalars as the original string so Zod can report the error', () => {
    const action = makeAction(z.object({ n: z.number().optional(), b: z.bigint().optional() }), { kind: 'query' })
    expect(resolveActionInput(action, { query: { n: 'abc' } })).toEqual({ n: 'abc' })
    expect(resolveActionInput(action, { query: { n: '' } })).toEqual({ n: '' })
    expect(resolveActionInput(action, { query: { b: 'x' } })).toEqual({ b: 'x' })
  })

  it('coerces bigint fields from the query string', () => {
    const action = makeAction(z.object({ b: z.bigint().optional() }), { kind: 'query' })
    expect(resolveActionInput(action, { query: { b: '42' } })).toEqual({ b: 42n })
  })

  it('coerces through optional/default wrappers via unwrap', () => {
    const action = makeAction(z.object({ limit: z.number().default(10) }), { kind: 'query' })
    expect(resolveActionInput(action, { query: { limit: '25' } })).toEqual({ limit: 25 })
  })
})
