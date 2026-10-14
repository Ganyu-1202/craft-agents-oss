import { expect, it } from 'bun:test'
import { Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import { studioTextDispatcher } from './studio-http'

it('removes HTTP deadlines while honoring the currently configured proxy dispatcher', () => {
  const original = getGlobalDispatcher()
  const requests: Dispatcher.DispatchOptions[] = []
  class ProxyFixture extends Dispatcher {
    dispatch(options: Dispatcher.DispatchOptions): boolean { requests.push(options); return true }
  }
  try {
    setGlobalDispatcher(new ProxyFixture())
    studioTextDispatcher.dispatch({ origin: 'https://example.test', path: '/v1/chat/completions', method: 'POST', headersTimeout: 300_000, bodyTimeout: 300_000 }, {})
    expect(requests).toHaveLength(1)
    expect(requests[0]?.headersTimeout).toBe(0)
    expect(requests[0]?.bodyTimeout).toBe(0)
    expect(requests[0]?.origin).toBe('https://example.test')
    // A subsequent settings change must be picked up without retaining a stale agent.
    setGlobalDispatcher(new ProxyFixture())
    studioTextDispatcher.dispatch({ origin: 'https://second.test', path: '/', method: 'GET' }, {})
    expect(requests).toHaveLength(2)
  } finally { setGlobalDispatcher(original) }
})
