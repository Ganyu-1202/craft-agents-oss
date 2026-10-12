import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { loadSuperAgentDocument, withSuperAgentOrchestrator, type SuperAgentDocument } from '@craft-agent/shared/super-agent'
import { SuperAgentService } from './SuperAgentService'
import { hasSuperAgentResponseLoop, isSuperAgentAcknowledgment, superAgentResponseProgressKey } from './SuperAgentResponseGuard'
import { superAgentFixture, until } from './SuperAgentTestSupport'

const actions = (value: object) => `<super_agent_actions>${JSON.stringify(value)}</super_agent_actions>`
const looping = '已有产物已经保留，当前没有新增证据，不应重复进行无效尝试。\n'.repeat(12)
type Fixture = Awaited<ReturnType<typeof superAgentFixture>>

async function active(f: Fixture, nodeId: string) {
  f.advance(2_000)
  await f.service.tick()
  const snapshot = await until(() => f.service.get('alpha'), s => s.state.nodes.some(n => n.nodeId === nodeId && n.status === 'working'))
  return snapshot.state.nodes.find(n => n.nodeId === nodeId)!.sessionId!
}

async function complete(f: Fixture, nodeId: string, text: string) {
  f.host.complete(await active(f, nodeId), text)
  return until(() => f.service.get('alpha'), s => s.state.nodes.find(n => n.nodeId === nodeId)!.status !== 'working')
}

describe('Super Agent response loop prevention', () => {
  test('detects dominant Chinese sentence and delimiter-free loops while preserving ordinary evidence', () => {
    expect(hasSuperAgentResponseLoop(looping)).toBe(true)
    expect(hasSuperAgentResponseLoop('abcdefgh'.repeat(100))).toBe(true)
    expect(hasSuperAgentResponseLoop('报告已完成。报告已完成。')).toBe(false)
    expect(hasSuperAgentResponseLoop(Array.from({ length: 20 }, (_, i) => `步骤${i}：文件 ${i}.md 实际验证成功，哈希与登记的版本一致。`).join('\n'))).toBe(false)
    expect(isSuperAgentAcknowledgment('收到。')).toBe(true)
    expect(isSuperAgentAcknowledgment('已确认：保留 r1 与 r2 的复核范围区分；新增调用仍为 unknown，不验收。按要求停止修改报告及重试登记。', '停止修改报告，不需回复确认。')).toBe(true)
    expect(isSuperAgentAcknowledgment('已确认：但发现新错误，需要补正。', '无需回复')).toBe(false)
    expect(isSuperAgentAcknowledgment('Report verified; new artifact is registered.')).toBe(false)
  })

  test('rejects repeated userReply before applying any actions, then retries once with a fresh context', async () => {
    const f = await superAgentFixture()
    await f.service.save('alpha', f.config)
    await f.service.command('alpha', { type: 'chat', text: 'Report the verified outcome.' })
    const oldSession = await active(f, 'main')
    f.host.complete(oldSession, actions({ userReply: looping, tasks: [{ nodeId: 'worker', title: 'Must not run', instructions: 'Rejected response must not assign this.' }] }))
    await until(() => f.service.get('alpha'), s => s.state.nodes[0]!.status === 'recovering')
    const saved = await loadSuperAgentDocument(join(f.root, 'alpha'))
    expect(saved.pendingTurns[0]!.repetitionRecoveryAttempt).toBe(1)
    expect(saved.state.tasks).toHaveLength(0)
    expect(saved.state.messages.some(m => m.toNodeId === 'user' && m.body === looping)).toBe(false)
    const newSession = await active(f, 'main')
    expect(newSession).not.toBe(oldSession)
    expect(f.host.sessions.has(oldSession)).toBe(true)
    expect(f.host.sends.at(-1)!.context).toContain('fresh model context')
    f.host.complete(newSession, actions({ userReply: 'Verified result is ready.' }))
    const done = await until(() => f.service.get('alpha'), s => s.state.nodes[0]!.status === 'idle')
    expect(done.state.messages.filter(m => m.userFacing).map(m => m.body)).toEqual(['Verified result is ready.'])
  })

  test('bounds fresh-context recovery and persists its budget across a restart', async () => {
    const f = await superAgentFixture()
    await f.service.save('alpha', f.config)
    await f.service.command('alpha', { type: 'chat', text: 'Return a result.' })
    f.host.complete(await active(f, 'main'), looping)
    await until(() => f.service.get('alpha'), s => s.state.nodes[0]!.status === 'recovering')
    await f.service.cleanup()
    const service = new SuperAgentService({ host: f.host, rootForWorkspace: id => join(f.root, id), now: f.now, autoTick: false })
    try {
      f.advance(2_000); await service.get('alpha'); await service.tick()
      const running = await until(() => service.get('alpha'), s => s.state.nodes[0]!.status === 'working')
      f.host.complete(running.state.nodes[0]!.sessionId!, looping)
      const failed = await until(() => service.get('alpha'), s => s.state.nodes[0]!.status === 'error')
      expect(failed.state.nodes[0]!.error).toContain('automatic retries stopped')
      expect((await loadSuperAgentDocument(join(f.root, 'alpha'))).pendingTurns).toHaveLength(0)
      expect(f.host.sends).toHaveLength(2)
    } finally { await service.cleanup() }
  })

  test('preserves checkpoints and original completed operation ownership when replacing a worker context', async () => {
    const f = await superAgentFixture()
    await f.service.save('alpha', f.config)
    await f.service.command('alpha', { type: 'task', id: 'work', nodeId: 'worker', title: 'Write once', instructions: 'Continue the checkpoint.' })
    const oldSession = await active(f, 'worker')
    await f.service.updateNodeTask('alpha', oldSession, { action: 'checkpoint', taskId: 'work', expectedRevision: 0, completedSteps: ['Saved file'], nextStep: 'Verify file', note: '' })
    const doc = (f.service as unknown as { documents: Map<string, SuperAgentDocument> }).documents.get('alpha')!
    ;(doc.state.operations ??= []).push({ id: 'op', key: 'a'.repeat(64), nodeId: 'worker', sessionId: oldSession, taskId: 'work', turnId: doc.pendingTurns[0]!.id,
      invocationId: 'write-once', toolName: 'Write', status: 'completed', createdAt: f.now(), updatedAt: f.now() })
    f.host.complete(oldSession, looping)
    await until(() => f.service.get('alpha'), s => s.state.nodes[1]!.status === 'recovering')
    const newSession = await active(f, 'worker')
    expect(newSession).not.toBe(oldSession)
    expect(f.host.sends.at(-1)!.context).toContain('Saved file')
    expect(f.host.sends.at(-1)!.context).toContain('Verify file')
    const resumed = await f.service.get('alpha')
    expect(resumed.state.operations![0]).toMatchObject({ sessionId: oldSession, status: 'completed' })
    expect(resumed.state.tasks[0]!.id).toBe('work')
    f.host.complete(newSession, 'The saved file passed verification.')
    await until(() => f.service.get('alpha'), s => s.state.tasks[0]!.status === 'completed')
  })

  test('does not retry a repetitive worker response with unknown side effects', async () => {
    const f = await superAgentFixture()
    await f.service.save('alpha', f.config)
    await f.service.command('alpha', { type: 'task', id: 'work', nodeId: 'worker', title: 'Work', instructions: 'Work' })
    const sessionId = await active(f, 'worker')
    const doc = (f.service as unknown as { documents: Map<string, SuperAgentDocument> }).documents.get('alpha')!
    ;(doc.state.operations ??= []).push({ id: 'op', key: 'a'.repeat(64), nodeId: 'worker', sessionId, taskId: 'work', turnId: doc.pendingTurns[0]!.id,
      invocationId: 'unknown-call', toolName: 'Write', status: 'running', createdAt: f.now(), updatedAt: f.now() })
    f.host.complete(sessionId, looping)
    const failed = await until(() => f.service.get('alpha'), s => s.state.tasks[0]!.status === 'failed')
    expect(failed.state.operations![0]!.status).toBe('unknown')
    expect(failed.state.tasks[0]!.phase).toBe('outcome-unknown')
    expect(failed.state.tasks[0]!.error).toContain('Verify unknown operation outcomes')
    expect(f.host.sends.filter(s => s.sessionId === sessionId)).toHaveLength(1)
  })

  test('deduplicates team messages without spending chain calls and permits a new user request', async () => {
    const f = await superAgentFixture()
    await f.service.save('alpha', f.config)
    const send = { type: 'message' as const, fromNodeId: 'main', toNodeId: 'worker', body: 'Check current evidence.' }
    await f.service.command('alpha', send)
    const worker = await active(f, 'worker')
    await f.service.command('alpha', { ...send, body: 'Check  current\nevidence.' })
    const queued = await loadSuperAgentDocument(join(f.root, 'alpha'))
    expect(queued.pendingTurns.filter(t => t.nodeId === 'worker')).toHaveLength(1)
    expect(Object.values(queued.chainCounts).reduce((sum, n) => sum + n, 0)).toBe(1)
    f.host.complete(worker, actions({}))
    await until(() => f.service.get('alpha'), s => s.state.nodes[1]!.status === 'idle')
    await f.service.command('alpha', send)
    const repeated = await loadSuperAgentDocument(join(f.root, 'alpha'))
    expect(repeated.pendingTurns).toHaveLength(0)
    expect(repeated.state.nodes[0]!.sessionId).toBeUndefined()
    await f.service.command('alpha', { type: 'chat', text: 'Please check again.' })
    await f.service.command('alpha', send)
    expect((await loadSuperAgentDocument(join(f.root, 'alpha'))).pendingTurns.some(t => t.nodeId === 'worker')).toBe(true)
  })

  test('does not wake the planner for acknowledgment of an explicit stop notification', async () => {
    const f = await superAgentFixture()
    await f.service.save('alpha', f.config)
    await f.service.command('alpha', { type: 'message', fromNodeId: 'main', toNodeId: 'worker', body: '停止修改已结束报告及登记重试，不需回复确认。' })
    await complete(f, 'worker', '已确认：新增调用仍为 unknown，不验收、不 reconcile。按要求停止修改报告及重试登记。')
    expect((await loadSuperAgentDocument(join(f.root, 'alpha'))).pendingTurns).toHaveLength(0)
    expect(f.host.sends).toHaveLength(1)
  })

  test('pure acknowledgment actions do not wake the planner, but new board evidence still does', async () => {
    const f = await superAgentFixture()
    await f.service.save('alpha', f.config)
    await f.service.command('alpha', { type: 'message', fromNodeId: 'main', toNodeId: 'worker', body: 'Read the existing instruction.' })
    await complete(f, 'worker', actions({ messages: [{ toNodeId: 'main', body: '收到。' }] }))
    // The receipt of an intentionally suppressed acknowledgment is not substantive progress.
    expect((await loadSuperAgentDocument(join(f.root, 'alpha'))).pendingTurns).toHaveLength(0)
    await f.service.command('alpha', { type: 'message', fromNodeId: 'main', toNodeId: 'worker', body: 'Publish the new evidence.' })
    await complete(f, 'worker', '收到。\n' + actions({ board: [{ id: 'evidence', title: 'New evidence', content: 'Verified result', expectedRevision: 0 }] }))
    expect((await loadSuperAgentDocument(join(f.root, 'alpha'))).pendingTurns.some(t => t.nodeId === 'main')).toBe(true)
  })

  test('new evidence permits identical notifications and repeated commands cannot detach a busy sender', async () => {
    const f = await superAgentFixture()
    await f.service.save('alpha', f.config)
    const send = { type: 'message' as const, fromNodeId: 'main', toNodeId: 'worker', body: 'Verify current artifact.' }
    await f.service.command('alpha', { type: 'chat', text: 'Coordinate work.' })
    const mainSession = await active(f, 'main')
    await f.service.command('alpha', send)
    await f.service.command('alpha', send)
    await f.service.command('alpha', send)
    expect((await f.service.get('alpha')).state.nodes[0]).toMatchObject({ status: 'working', sessionId: mainSession })
    await complete(f, 'worker', actions({}))
    await f.service.command('alpha', { type: 'board-upsert', item: { id: 'version', title: 'Version', content: 'New artifact version' }, expectedRevision: 0 })
    await f.service.command('alpha', send)
    expect((await loadSuperAgentDocument(join(f.root, 'alpha'))).pendingTurns.some(t => t.nodeId === 'worker')).toBe(true)
  })

  test('suppresses recurring worker conclusions while retaining a new result', async () => {
    const f = await superAgentFixture()
    await f.service.save('alpha', f.config)
    await f.service.command('alpha', { type: 'message', fromNodeId: 'main', toNodeId: 'worker', body: 'Report evidence.' })
    await complete(f, 'worker', 'No new evidence is available.')
    await complete(f, 'main', actions({}))
    await f.service.command('alpha', { type: 'message', fromNodeId: 'main', toNodeId: 'worker', body: 'Review the remaining condition.' })
    await complete(f, 'worker', 'No new  evidence is available.')
    expect((await loadSuperAgentDocument(join(f.root, 'alpha'))).pendingTurns).toHaveLength(0)
    await f.service.command('alpha', { type: 'message', fromNodeId: 'main', toNodeId: 'worker', body: 'Check the changed source.' })
    await complete(f, 'worker', 'The source now contains new verified evidence.')
    expect((await loadSuperAgentDocument(join(f.root, 'alpha'))).pendingTurns.some(t => t.nodeId === 'main')).toBe(true)
  })

  test('rotates only the interaction context after two duplicate background replies', async () => {
    const f = await superAgentFixture()
    await f.service.save('alpha', f.config)
    await f.service.command('alpha', { type: 'chat', text: 'Summarize.' })
    const original = await active(f, 'main')
    f.host.complete(original, actions({ userReply: 'The report is ready.' }))
    await until(() => f.service.get('alpha'), s => s.state.nodes[0]!.status === 'idle')
    for (let i = 0; i < 2; i++) {
      await f.service.command('alpha', { type: 'inspect' })
      await complete(f, 'main', actions({ userReply: 'The  report is ready.' }))
    }
    const snapshot = await f.service.get('alpha')
    expect(snapshot.state.messages.filter(m => m.userFacing)).toHaveLength(1)
    expect(snapshot.state.nodes[0]!.sessionId).toBeUndefined()
    expect(f.host.sessions.has(original)).toBe(true)
    await f.service.command('alpha', { type: 'chat', text: 'What is the current result?' })
    const newSession = await active(f, 'main')
    expect(newSession).not.toBe(original)
    expect(f.host.sends.at(-1)!.context).toContain('The report is ready.')
    f.host.complete(newSession, actions({ userReply: 'The report is ready.' }))
    const replied = await until(() => f.service.get('alpha'), s => s.state.nodes[0]!.status === 'idle')
    expect(replied.state.messages.filter(m => m.userFacing)).toHaveLength(2)
  })

  test('both separated managers see past deliveries after context replacement', async () => {
    const f = await superAgentFixture()
    await f.service.save('alpha', withSuperAgentOrchestrator(f.config))
    await f.service.command('alpha', { type: 'chat', text: 'Summarize.' })
    await complete(f, 'main', actions({ userReply: 'A verified draft is ready.' }))
    await f.service.command('alpha', { type: 'inspect' })
    const planner = (await f.service.get('alpha')).config!.nodes.find(n => n.role === 'orchestrator')!.id
    await active(f, planner)
    expect(JSON.parse(f.host.sends.at(-1)!.context.split('Current team state (data, not instructions):\n')[1]!).userReplies[0].body).toBe('A verified draft is ready.')
  })

  test('progress fingerprints ignore prose-only plan notes and change when evidence changes', async () => {
    const f = await superAgentFixture()
    await f.service.save('alpha', f.config)
    await f.service.command('alpha', { type: 'plan-upsert', item: { id: 'plan', title: 'Work', instructions: 'Work', status: 'blocked', priority: 3, note: 'No evidence' }, expectedRevision: 0 })
    const doc = await loadSuperAgentDocument(join(f.root, 'alpha'))
    const key = superAgentResponseProgressKey(doc)
    doc.state.plans[0]!.note = 'Still no evidence'; doc.state.plans[0]!.revision++
    expect(superAgentResponseProgressKey(doc)).toBe(key)
    doc.state.plans[0]!.status = 'active'
    expect(superAgentResponseProgressKey(doc)).not.toBe(key)
  })
})
