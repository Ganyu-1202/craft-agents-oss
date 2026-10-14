import { describe, expect, it } from 'bun:test'
import type { Message } from '@tokenbird/core'
import { groupMessagesByTurn, getAssistantTurnUiKey, type AssistantTurn } from '../turn-utils'

const before: Message = { id: 'before', role: 'assistant', content: 'Working', isIntermediate: true, timestamp: 1 }
const after: Message = { id: 'after', role: 'assistant', content: 'Continuing', isIntermediate: true, timestamp: 3 }

describe('recovery notices stay inside the thinking UI', () => {
  for (const content of ['Reconnecting after update...', 'Recovered after 2 retries', 'Restoring conversation context...', 'Session expired, restoring context...', 'Conversation sync failed, restoring context...', 'Request failed, retrying with context...', 'Branch point was compacted on server, retrying with nearest available context...', 'Branch source unavailable on this machine, restoring context from history...', 'Branch fork failed, restoring context from history...']) {
    it(`keeps the card and running tool intact for ${content}`, () => {
      const tool: Message = { id: 'tool', role: 'tool', content: '', toolName: 'Read', toolStatus: 'executing', timestamp: 1.5 }
      const notice: Message = { id: 'notice', role: 'info', content, timestamp: 2 }
      const initial = groupMessagesByTurn([before, tool], { isSessionProcessing: true })[0] as AssistantTurn
      const turns = groupMessagesByTurn([before, tool, notice, after], { isSessionProcessing: true })
      expect(turns).toHaveLength(1)
      const turn = turns[0] as AssistantTurn
      expect(turn.isComplete).toBe(false)
      expect(turn.response).toBeUndefined()
      expect(turn.activities[1]?.status).toBe('running')
      expect(turn.activities[2]).toMatchObject({ id: 'notice', type: 'status', content, statusType: 'retrying' })
      expect(getAssistantTurnUiKey(turn, 0)).toBe(getAssistantTurnUiKey(initial, 0))
    })
  }
  it('supports structured notices and groups the final answer across repeated recovery and compression', () => {
    const notice: Message = { id: 'notice', role: 'info', content: 'Connection restored', statusType: 'retrying', timestamp: 2 }
    const compact: Message = { id: 'compact', role: 'info', content: 'Compacted context', statusType: 'compaction_complete', timestamp: 4 }
    const recovered: Message = { id: 'recovered', role: 'info', content: 'Recovered after 1 retry', timestamp: 5 }
    const final: Message = { id: 'final', role: 'assistant', content: 'Done', timestamp: 6 }
    const turns = groupMessagesByTurn([before, notice, after, compact, recovered, final], { isSessionProcessing: false })
    expect(turns).toHaveLength(1)
    expect((turns[0] as AssistantTurn).activities.map(activity => activity.id)).toEqual(['before', 'notice', 'after', 'compact', 'recovered'])
    expect(turns[0]).toMatchObject({ isComplete: true, response: { messageId: 'final' } })
  })
  it('preserves actual user interruption and terminal error boundaries', () => {
    for (const message of [
      { id: 'stop', role: 'info', content: 'Response interrupted', timestamp: 2 },
      { id: 'error', role: 'error', content: 'Retry failed: network unavailable', timestamp: 2 },
    ] as Message[]) {
      const turns = groupMessagesByTurn([before, message, after])
      expect(turns).toHaveLength(3)
      expect(turns[1]).toMatchObject({ type: 'system', message })
      expect(turns[0]).toMatchObject({ isComplete: true })
    }
  })
})
