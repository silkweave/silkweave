import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'
import { Action, createAction } from './action.js'
import { lintActions, reportActionLint } from './lint.js'

function action(partial: Partial<Action> & { name: string }): Action {
  return createAction({
    name: partial.name,
    description: partial.description ?? 'A well described action that does a thing.',
    input: partial.input ?? z.object({ value: z.string().describe('the value') }),
    run: async () => ({})
  }) as Action
}

describe('lintActions', () => {
  it('returns no warnings for a well-described action', () => {
    expect(lintActions([action({ name: 'good' })])).toEqual([])
  })

  it('flags a missing description', () => {
    const warnings = lintActions([action({ name: 'nodesc', description: '   ' })])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('missing-description')
  })

  it('flags a too-short description', () => {
    const warnings = lintActions([action({ name: 'terse', description: 'gets' })])
    expect(warnings.map((w) => w.code)).toContain('short-description')
  })

  it('flags an action whose every input param lacks a description', () => {
    const warnings = lintActions([action({ name: 'bare', input: z.object({ a: z.string(), b: z.number() }) })])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('undescribed-params')
    expect(warnings[0].message).toContain('a, b')
  })

  it('flags only the undescribed subset of params', () => {
    const input = z.object({ a: z.string().describe('a'), b: z.number() })
    const warnings = lintActions([action({ name: 'partial', input })])
    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('some-undescribed-params')
    expect(warnings[0].message).toContain('b')
    expect(warnings[0].message).not.toContain('a,')
  })

  it('reads descriptions through optional/default wrappers', () => {
    const input = z.object({ a: z.string().describe('a').optional(), b: z.number().describe('b').default(1) })
    expect(lintActions([action({ name: 'wrapped', input })])).toEqual([])
  })
})

describe('reportActionLint', () => {
  it('emits each warning through the warn sink', () => {
    const warn = vi.fn()
    const warnings = reportActionLint([action({ name: 'nodesc', description: '' })], warn)
    expect(warnings).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('[silkweave]')
  })

  it('stays silent for clean actions', () => {
    const warn = vi.fn()
    reportActionLint([action({ name: 'good' })], warn)
    expect(warn).not.toHaveBeenCalled()
  })
})
