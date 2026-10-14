import { describe, expect, it } from 'bun:test'
import type { Message } from '@tokenbird/core'
import { groupMessagesByTurn } from '../turn-utils'

const requestId = '20261011133948439232468268d9d6nfIF0vPK'
const raw: Message = {
  id: 'raw', role: 'error', timestamp: 1,
  content: 'Request Blocked by Usage Policy',
  errorCode: 'content_policy_blocked',
  errorOriginal: `400: {"message":"request blocked by content moderation (request id: ${requestId})","code":"prompt_blocked"}`,
}
const structured: Message = {
  id: 'structured', role: 'error', timestamp: 2,
  content: 'Request Blocked by Usage Policy',
  errorCode: 'content_policy_blocked',
  errorCanRetry: false,
  errorActions: [],
  errorDetails: ['Status: 400 Bad Request', `API message: request blocked by content moderation (request id: ${requestId})`],
}

describe('duplicate request error cards', () => {
  it('combines the screenshot errors and keeps both diagnostic formats without mutating history', () => {
    const turns = groupMessagesByTurn([raw, structured])
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ type: 'system', message: {
      id: 'raw', timestamp: 1, errorCode: 'content_policy_blocked', errorCanRetry: false,
      errorDetails: [...structured.errorDetails!, `Raw: ${raw.errorOriginal}`],
    } })
    expect(raw.errorDetails).toBeUndefined()
    expect(structured.errorDetails).toHaveLength(2)
  })

  it('prefers structured metadata regardless of arrival order and retains plain diagnostics', () => {
    const plain: Message = { id: 'plain', role: 'error', timestamp: 3, content: raw.errorOriginal! }
    for (const messages of [[plain, structured], [structured, plain]]) {
      const turns = groupMessagesByTurn(messages)
      expect(turns).toHaveLength(1)
      expect(turns[0]).toMatchObject({ message: {
        errorCode: 'content_policy_blocked', errorCanRetry: false,
        errorDetails: [...structured.errorDetails!, `Raw: ${plain.content}`],
      } })
    }
  })

  it('keeps distinct requests and errors without request identity visible', () => {
    for (const other of [
      { ...structured, errorDetails: structured.errorDetails!.map(detail => detail.replace(requestId, 'different-request')) },
      { ...structured, errorDetails: undefined },
    ]) {
      expect(groupMessagesByTurn([raw, other])).toHaveLength(2)
    }
  })

  it('does not merge across a new user turn or an assistant response', () => {
    for (const role of ['user', 'assistant'] as const) {
      const separator: Message = { id: 'separator', role, content: 'Try again', timestamp: 1.5 }
      expect(groupMessagesByTurn([raw, separator, structured])).toHaveLength(3)
    }
  })

  it('deduplicates diagnostic lines when a request is reported repeatedly', () => {
    const turns = groupMessagesByTurn([raw, structured, { ...structured, id: 'repeat', timestamp: 3 }])
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ message: { errorDetails: [...structured.errorDetails!, `Raw: ${raw.errorOriginal}`] } })
  })
})
