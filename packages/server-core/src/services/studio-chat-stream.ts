import type { StudioWorkEvent } from '@craft-agent/shared/protocol'
import { createHash } from 'node:crypto'

export type StudioToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }
export type StudioProgress = (event: Omit<StudioWorkEvent, 'requestId'>) => void

/** Bound IDs before both the assistant call and tool result enter request history. */
export function normalizeStudioToolCallIds(calls: StudioToolCall[]): void {
  const reserved = new Set(calls.map(call => call.id).filter(id => typeof id === 'string' && id.length <= 64))
  const aliases = new Map<string, string>()
  for (const call of calls) {
    if (typeof call.id !== 'string' || !call.id) throw new Error('AI returned a tool call without an ID')
    if (call.id.length <= 64) continue
    const original = call.id
    let id = aliases.get(original)
    if (!id) {
      let attempt = 0
      do {
        id = `call_${createHash('sha256').update(original).update(`\0${attempt++}`).digest('hex').slice(0, 48)}`
      } while (reserved.has(id))
      aliases.set(original, id)
      reserved.add(id)
    }
    call.id = id
  }
}

/** Decode SSE as it arrives, including UTF-8 and JSON split across network chunks. */
export async function readStudioChatStream(response: Response, progress?: StudioProgress, signal?: AbortSignal): Promise<Record<string, any>> {
  if (!response.body) throw new Error('AI returned no stream')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = '', content = '', ended = false, thinking = false, lastProgress = 0
  const calls = new Map<number, StudioToolCall>()
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  function event(raw: string) {
    const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!data) return
    if (data === '[DONE]') { ended = true; return }
    let chunk: Record<string, any>
    try { chunk = JSON.parse(data) } catch { throw new Error('AI returned an invalid stream response') }
    if (chunk.error) throw new Error(`Studio request failed: ${String(chunk.error.message ?? chunk.error).slice(0, 500)}`)
    const choice = chunk.choices?.[0]
    if (choice?.finish_reason === 'length') throw new Error('AI response was truncated before the diagram was complete')
    if (choice?.finish_reason) ended = true
    const delta = choice?.delta
    if (!thinking && (delta?.reasoning_content || delta?.reasoning)) {
      thinking = true
      progress?.({ type: 'phase', phase: 'thinking' })
    }
    if (typeof delta?.content === 'string') {
      content += delta.content
      if (Date.now() - lastProgress >= 150) {
        progress?.({ type: 'output', phase: 'receiving', characters: content.length, text: content.slice(-4000) })
        lastProgress = Date.now()
      }
    }
    for (const item of delta?.tool_calls ?? []) {
      if (!Number.isInteger(item.index)) throw new Error('AI returned an invalid tool call')
      const call = calls.get(item.index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } }
      // IDs are identifiers, not argument fragments. Some relays repeat them
      // with every delta; concatenating six 37-character IDs produced 222.
      if (typeof item.id === 'string' && item.id) {
        if (call.id && call.id !== item.id) throw new Error('AI changed a tool call ID within the stream')
        call.id = item.id
      }
      if (typeof item.function?.name === 'string') {
        const name = item.function.name
        // Preserve fragmented names while accepting repeated or cumulative names.
        if (name.startsWith(call.function.name)) call.function.name = name
        else call.function.name += name
      }
      if (typeof item.function?.arguments === 'string') call.function.arguments += item.function.arguments
      calls.set(item.index, call)
    }
  }
  try {
    while (true) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let boundary: RegExpExecArray | null
      while ((boundary = /\r?\n\r?\n/.exec(pending))) {
        event(pending.slice(0, boundary.index))
        pending = pending.slice(boundary.index + boundary[0].length)
      }
      if (done || ended) {
        if (pending.trim()) event(pending)
        break
      }
    }
    if (!ended) throw new Error('AI connection closed before the response completed')
    if (content) progress?.({ type: 'output', phase: 'receiving', characters: content.length, text: content.slice(-4000) })
    return { choices: [{ message: { content, ...(calls.size ? { tool_calls: [...calls.values()] } : {}) } }] }
  } finally {
    signal?.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
