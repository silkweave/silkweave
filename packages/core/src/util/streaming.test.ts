import { describe, expect, it } from 'vitest'
import z from 'zod/v4'
import { isStreamingAction, type Action } from './action.js'
import { createContext, type SilkweaveContext } from './context.js'
import { runStreamingAction } from './streaming.js'

type Gen = (input: object, context: SilkweaveContext) => AsyncGenerator<number>

function streamingAction(run: Gen): Action {
  return { name: 'stream', input: z.object({}), chunk: z.number(), run } as unknown as Action
}

function bufferedAction(run: () => Promise<object>): Action {
  return { name: 'buffered', input: z.object({}), output: z.object({}), run } as unknown as Action
}

describe('isStreamingAction', () => {
  it('is true for an async generator run', () => {
    expect(isStreamingAction(streamingAction(async function* () { yield 1 }))).toBe(true)
  })

  it('is false for an async or sync function run', () => {
    expect(isStreamingAction(bufferedAction(async () => ({})))).toBe(false)
    expect(isStreamingAction({ name: 'x', input: z.object({}), run: () => ({}) } as unknown as Action)).toBe(false)
  })

  it('is false when there is no run', () => {
    expect(isStreamingAction({ name: 'x', input: z.object({}) } as unknown as Action)).toBe(false)
  })
})

describe('runStreamingAction', () => {
  const ctx = createContext({})

  it('throws when the action is not streaming', async () => {
    await expect(runStreamingAction(bufferedAction(async () => ({})), {}, ctx)).rejects.toThrow(/not a streaming action/)
  })

  it('buffers and returns every yielded chunk in order', async () => {
    const action = streamingAction(async function* () { yield 0; yield 1; yield 2 })
    expect(await runStreamingAction(action, {}, ctx)).toEqual([0, 1, 2])
  })

  it('invokes onChunk once per chunk with a zero-based index', async () => {
    const action = streamingAction(async function* () { yield 10; yield 20 })
    const seen: [number, number][] = []
    const chunks = await runStreamingAction(action, {}, ctx, (chunk, index) => { seen.push([chunk, index]) })
    expect(chunks).toEqual([10, 20])
    expect(seen).toEqual([[10, 0], [20, 1]])
  })

  it('awaits onChunk before pulling the next value (backpressure)', async () => {
    const events: string[] = []
    const action = streamingAction(async function* () {
      for (let i = 0; i < 3; i += 1) { events.push(`yield ${i}`); yield i }
    })
    await runStreamingAction(action, {}, ctx, async (chunk) => {
      await Promise.resolve()
      events.push(`consume ${chunk}`)
    })
    expect(events).toEqual(['yield 0', 'consume 0', 'yield 1', 'consume 1', 'yield 2', 'consume 2'])
  })

  it('returns an empty array for a generator that yields nothing', async () => {
    // eslint-disable-next-line require-yield
    const action = streamingAction(async function* () { return })
    expect(await runStreamingAction(action, {}, ctx)).toEqual([])
  })
})
