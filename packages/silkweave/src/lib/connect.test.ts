import { describe, expect, it } from 'vitest'
import { remoteHeaders } from './connect.js'

describe('remoteHeaders', () => {
  it('adds the Bearer prefix to a bare token and keeps an explicit scheme', () => {
    expect(remoteHeaders({ token: 'abc123' })).toEqual({ authorization: 'Bearer abc123' })
    expect(remoteHeaders({ token: 'Basic dXNlcg==' })).toEqual({ authorization: 'Basic dXNlcg==' })
  })

  it('parses --header entries in key=value and key: value forms', () => {
    expect(remoteHeaders({ header: ['x-api-key=secret', 'X-Team: atomic'] })).toEqual({
      'x-api-key': 'secret',
      'x-team': 'atomic'
    })
    expect(() => remoteHeaders({ header: ['nonsense'] })).toThrow(/Invalid --header/)
  })
})
