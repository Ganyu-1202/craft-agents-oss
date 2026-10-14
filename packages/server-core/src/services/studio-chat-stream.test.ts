import { describe, expect, it } from 'bun:test'
import { normalizeStudioToolCallIds, readStudioChatStream, type StudioToolCall } from './studio-chat-stream'
import type { StudioWorkEvent } from '@tokenbird/shared/protocol'

const sse = (delta: unknown, finish_reason?: string) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\r\n\r\n`
describe('Studio incremental streaming', () => {
  it('reports output before completion and decodes split UTF-8 and tool calls', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }))
    const events: Array<Omit<StudioWorkEvent, 'requestId'>> = []
    const result = readStudioChatStream(response, event => events.push(event))
    const bytes = new TextEncoder().encode(sse({ reasoning_content: 'thinking' }) + sse({ content: '中文内容' }))
    // Each individual byte can split both an SSE delimiter and a Unicode character.
    for (const byte of bytes) stream.enqueue(new Uint8Array([byte]))
    await Bun.sleep(10)
    expect(events.some(event => event.phase === 'thinking')).toBe(true)
    expect(events.some(event => event.text === '中文内容')).toBe(true)
    stream.enqueue(new TextEncoder().encode(sse({ tool_calls: [{ index: 0, id: 'call-1', function: { name: 'read_project_', arguments: '{"path":' } }] })))
    stream.enqueue(new TextEncoder().encode(sse({ tool_calls: [{ index: 0, function: { name: 'file', arguments: '"schema.sql"}' } }] }, 'tool_calls')))
    const payload = await result
    expect(payload.choices[0].message.content).toBe('中文内容')
    expect(payload.choices[0].message.tool_calls).toEqual([{ id: 'call-1', type: 'function', function: { name: 'read_project_file', arguments: '{"path":"schema.sql"}' } }])
  })

  it('rejects a stream that closes before a completion marker', async () => {
    await expect(readStudioChatStream(new Response(sse({ content: 'unfinished' })))).rejects.toThrow('connection closed')
  })

  it('keeps a repeated 37-character tool ID from becoming 222 characters', async () => {
    const id = 'call_' + 'a'.repeat(32)
    const fragments = ['{"path":', '"schema', '.sql', '"', '}', '']
    const stream = fragments.map(argumentsDelta => sse({ tool_calls: [{
      index: 0, id, function: { name: 'read_project_file', arguments: argumentsDelta },
    }] })).join('') + sse({}, 'tool_calls')
    const payload = await readStudioChatStream(new Response(stream))
    expect(payload.choices[0].message.tool_calls).toEqual([{
      id, type: 'function', function: { name: 'read_project_file', arguments: '{"path":"schema.sql"}' },
    }])
  })

  it('keeps parallel calls separate when both IDs are repeated', async () => {
    const stream = sse({ tool_calls: [
      { index: 0, id: 'call_a', function: { name: 'read_project_file', arguments: '{"path":' } },
      { index: 1, id: 'call_b', function: { name: 'read_project_file', arguments: '{"path":' } },
    ] }) + sse({ tool_calls: [
      { index: 1, id: 'call_b', function: { name: 'read_project_file', arguments: '"b.sql"}' } },
      { index: 0, id: 'call_a', function: { name: 'read_project_file', arguments: '"a.sql"}' } },
    ] }, 'tool_calls')
    const payload = await readStudioChatStream(new Response(stream))
    expect(payload.choices[0].message.tool_calls.map((call: StudioToolCall) => [call.id, call.function.arguments])).toEqual([
      ['call_a', '{"path":"a.sql"}'], ['call_b', '{"path":"b.sql"}'],
    ])
  })

  it('rejects a changed identifier instead of merging two different calls', async () => {
    const stream = sse({ tool_calls: [{ index: 0, id: 'call_a', function: { name: 'ls', arguments: '{}' } }] })
      + sse({ tool_calls: [{ index: 0, id: 'call_b' }] }, 'tool_calls')
    await expect(readStudioChatStream(new Response(stream))).rejects.toThrow('changed a tool call ID')
  })

  it('bounds oversized IDs deterministically while preserving 64-character IDs', () => {
    const calls: StudioToolCall[] = ['x'.repeat(221) + 'a', 'x'.repeat(221) + 'b', 'v'.repeat(64)].map(id => ({
      id, type: 'function', function: { name: 'read_project_file', arguments: '{}' },
    }))
    const replay = structuredClone(calls)
    normalizeStudioToolCallIds(calls)
    normalizeStudioToolCallIds(replay)
    expect(calls).toEqual(replay)
    expect(calls.every(call => call.id.length <= 64)).toBe(true)
    expect(calls[0]!.id).not.toBe(calls[1]!.id)
    expect(calls[2]!.id).toBe('v'.repeat(64))
    normalizeStudioToolCallIds(calls)
    expect(calls).toEqual(replay)
  })

  it('preserves explicit provider errors and truncated responses', async () => {
    await expect(readStudioChatStream(new Response('data: {"error":{"message":"model failed"}}\n\n'))).rejects.toThrow('model failed')
    await expect(readStudioChatStream(new Response(sse({ content: 'partial' }, 'length')))).rejects.toThrow('truncated')
  })

  it('cancels a silent stream immediately when the request is stopped', async () => {
    const controller = new AbortController()
    let cancelled = false
    const response = new Response(new ReadableStream({ cancel() { cancelled = true } }))
    const pending = readStudioChatStream(response, undefined, controller.signal)
    controller.abort(new Error('Stopped'))
    await expect(pending).rejects.toThrow('Stopped')
    expect(cancelled).toBe(true)
  })
})
