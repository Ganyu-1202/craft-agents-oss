import { describe, expect, it } from 'bun:test'
import type { Message } from '@craft-agent/core'
import { groupMessagesByTurn, getAssistantTurnUiKey, type AssistantTurn } from '../turn-utils'

const command: Message = { id: 'command', role: 'user', content: '/compact', timestamp: 1 }
const complete: Message = { id: 'done', role: 'info', content: 'Compacted context', statusType: 'compaction_complete', timestamp: 3 }

describe('compaction completion display', () => {
  it('shows completion after reloading history without transient progress', () => {
    const turns = groupMessagesByTurn([command, complete])
    expect(turns).toHaveLength(2)
    expect(turns[1]).toMatchObject({ type: 'system', message: complete })
  })
  it('updates live progress without duplicating completion', () => {
    const progress: Message = { id: 'progress', role: 'status', content: 'Compacting...', statusType: 'compacting', timestamp: 2 }
    const turns = groupMessagesByTurn([command, progress, complete])
    expect(turns).toHaveLength(2)
    expect(turns[1]).toMatchObject({ type: 'assistant', activities: [{ id: 'progress', content: complete.content, status: 'completed' }] })
  })

  it('keeps persisted compression inside the ongoing activity card without promoting commentary', () => {
    const before: Message = { id: 'before', role: 'assistant', content: '准备部署', isIntermediate: true, timestamp: 2 }
    const after: Message = { id: 'after', role: 'assistant', content: '继续验证', isIntermediate: true, timestamp: 4 }
    const options = { isSessionProcessing: true }
    const initial = groupMessagesByTurn([command, before], options)[1] as AssistantTurn
    const turns = groupMessagesByTurn([command, before, complete, after], options)
    expect(turns).toHaveLength(2)
    const turn = turns[1] as AssistantTurn
    expect(turn.isComplete).toBe(false)
    expect(turn.response).toBeUndefined()
    expect(turn.activities.map(activity => activity.id)).toEqual(['before', 'done', 'after'])
    expect(turn.activities[1]).toMatchObject({ type: 'status', status: 'completed', content: complete.content })
    expect(getAssistantTurnUiKey(turn, 1)).toBe(getAssistantTurnUiKey(initial, 1))
  })

  it('groups the final answer with work on both sides of compression after reload', () => {
    const before: Message = { id: 'before', role: 'assistant', content: '准备部署', isIntermediate: true, timestamp: 2 }
    const after: Message = { id: 'after', role: 'assistant', content: '继续验证', isIntermediate: true, timestamp: 4 }
    const final: Message = { id: 'final', role: 'assistant', content: '部署完成', timestamp: 5 }
    const turns = groupMessagesByTurn([command, before, complete, after, final], { isSessionProcessing: false })
    expect(turns).toHaveLength(2)
    expect(turns[1]).toMatchObject({ type: 'assistant', isComplete: true, response: { text: final.content, messageId: final.id } })
    expect((turns[1] as AssistantTurn).activities.map(activity => activity.id)).toEqual(['before', 'done', 'after'])
  })

  it('updates the latest running compaction while preserving earlier completion', () => {
    const progress: Message = { id: 'progress', role: 'status', content: 'Compacting...', statusType: 'compacting', timestamp: 2 }
    const nextProgress: Message = { ...progress, id: 'next-progress', timestamp: 4 }
    const nextComplete: Message = { ...complete, id: 'next-done', content: 'Compacted again', timestamp: 5 }
    const turns = groupMessagesByTurn([command, progress, complete, nextProgress, nextComplete], { isSessionProcessing: true })
    expect(turns).toHaveLength(2)
    expect((turns[1] as AssistantTurn).activities).toMatchObject([
      { id: 'progress', status: 'completed', content: complete.content },
      { id: 'next-progress', status: 'completed', content: nextComplete.content },
    ])
  })
})
