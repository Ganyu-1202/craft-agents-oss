import { describe, expect, it } from 'bun:test'
import type { StoredMessage } from '@craft-agent/core/types'
import { MessageBranchGate, editedBranchMessages, branchSeedMessages } from './message-branching'

const transcript: StoredMessage[] = [
  { id: 'u1', type: 'user', content: 'first question', timestamp: 1 },
  { id: 'a1', type: 'assistant', content: 'first answer', timestamp: 2 },
  { id: 'u2', type: 'user', content: 'old question', timestamp: 3, badges: [] },
  { id: 'a2', type: 'assistant', content: 'later answer must not leak', timestamp: 4 },
]

describe('history editing', () => {
  it('retains the parent and cuts later messages, with a new user identity ready for replay', () => {
    const original = JSON.stringify(transcript)
    const edited = editedBranchMessages(transcript, 2, 'new question', 'new-user')
    expect(edited.map(m => m.content)).toEqual(['first question', 'first answer', 'new question'])
    expect(edited.at(-1)).toMatchObject({ id: 'new-user', isQueued: true })
    expect(edited.at(-1)?.badges).toBeUndefined()
    expect(JSON.stringify(transcript)).toBe(original)
    expect(branchSeedMessages(edited.map(m => ({ ...m, role: m.type })))).toEqual([
      { type: 'user', content: 'first question' }, { type: 'assistant', content: 'first answer' },
    ])
  })
  it('supports editing the first user message', () => {
    expect(editedBranchMessages(transcript, 0, 'first edit', 'new')[0]?.isQueued).toBe(true)
    expect(branchSeedMessages([{ role: 'user', content: 'first edit' }])).toEqual([])
  })
  it('rejects edits to completed assistant messages without changing history', () => {
    const original = JSON.stringify(transcript)
    expect(() => editedBranchMessages(transcript, 1, 'corrected answer', 'new-assistant'))
      .toThrow('Only completed user messages can be edited.')
    expect(JSON.stringify(transcript)).toBe(original)
  })
  it('rejects empty text, nonexistent, intermediate and queued messages', () => {
    expect(() => editedBranchMessages(transcript, 2, '  ', 'new')).toThrow('empty')
    expect(() => editedBranchMessages(transcript, 8, 'edit', 'new')).toThrow()
    expect(() => editedBranchMessages([{ ...transcript[0]!, isQueued: true }], 0, 'edit', 'new')).toThrow()
    expect(() => editedBranchMessages([{ ...transcript[1]!, isIntermediate: true }], 0, 'edit', 'new')).toThrow()
  })
})

describe('message branch limit', () => {
  it('admits exactly ten simultaneous creations on a shared node', async () => {
    const gate = new MessageBranchGate()
    let count = 0
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => gate.run('workspace:node', () => count, async () => {
      await Promise.resolve()
      return ++count
    })))
    expect(count).toBe(10)
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(10)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(5)
    // Different messages and workspaces have their own budgets.
    expect(await gate.run('other:node', () => 0, async () => 'ok')).toBe('ok')
  })
  it('counts restored branches and releases a slot after failure or deletion', async () => {
    const gate = new MessageBranchGate()
    let count = 9
    await expect(gate.run('restored', () => count, async () => { throw new Error('disk failure') })).rejects.toThrow('disk failure')
    expect(await gate.run('restored', () => count, async () => ++count)).toBe(10)
    await expect(gate.run('restored', () => count, async () => ++count)).rejects.toThrow('MESSAGE_BRANCH_LIMIT')
    count--
    expect(await gate.run('restored', () => count, async () => ++count)).toBe(10)
  })
})
