import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Session } from '@craft-agent/shared/protocol'
import { loadSuperAgentDocument, validateSuperAgentCommand } from '@craft-agent/shared/super-agent'
import { SuperAgentService } from './SuperAgentService'
import { superAgentFixture, until, type SuperAgentTestHost } from './SuperAgentTestSupport'

function resetHost(host: SuperAgentTestHost) {
  const deleted: string[] = []
  return Object.assign(host, {
    deleted,
    getSessions(workspaceId?: string): Session[] {
      return [...host.sessions.values()].filter(session => !workspaceId || session.workspaceId === workspaceId)
        .map(session => ({ workspaceName: 'Test', messages: [], lastMessageAt: 0, ...session }))
    },
    getSuperAgentSessionIds(workspaceId: string, nodeId?: string) {
      return [...host.policies].filter(([id, policy]) => host.sessions.get(id)?.workspaceId === workspaceId && (!nodeId || policy.nodeId === nodeId)).map(([id]) => id)
    },
    async deleteSession(id: string, guard?: { workspaceId: string; lastMessageAt: number; onlyIdle: true; superAgentReset?: true }) {
      const session = host.sessions.get(id)
      if (!session || !guard?.superAgentReset || session.workspaceId !== guard.workspaceId || session.isProcessing) throw new Error('Unsafe session deletion')
      deleted.push(id); host.sessions.delete(id); host.policies.delete(id)
    },
  })
}

async function failedNode(errorCode = 'invalid_api_key') {
  const fixture = await superAgentFixture()
  const host = resetHost(fixture.host)
  fixture.config.idleInspectionMinutes = 1440
  await fixture.service.save('alpha', fixture.config)
  await fixture.service.command('alpha', { type: 'board-upsert', item: { title: 'Shared evidence', content: 'Keep existing evidence' } })
  await fixture.service.command('alpha', { type: 'memory-upsert', item: { title: 'Decision', content: 'Keep shared memory', category: 'decision', tags: [], evidence: '' }, expectedRevision: 0 })
  await fixture.service.command('alpha', { type: 'task', nodeId: 'worker', title: 'Verify', instructions: 'Verify the existing work.' })
  const started = await until(() => fixture.service.get('alpha'), value => value.state.tasks[0]?.status === 'running')
  const task = started.state.tasks[0]!
  host.complete(task.sessionId!, 'Fix the connection first', 'error', { errorCode })
  await until(() => fixture.service.get('alpha'), value => ['error', 'recovering'].includes(value.state.nodes.find(node => node.nodeId === 'worker')!.status))
  return { ...fixture, host, task }
}

describe('Super Agent complete node reset', () => {
  test('requires explicit confirmation and a node ID', () => {
    for (const command of [{ type: 'node-reset' }, { type: 'node-reset', nodeId: 'worker' }, { type: 'node-reset', nodeId: 'worker', confirmed: false }]) {
      expect(() => validateSuperAgentCommand(command)).toThrow()
    }
    expect(validateSuperAgentCommand({ type: 'node-reset', nodeId: 'worker', confirmed: true })).toEqual({ type: 'node-reset', nodeId: 'worker', confirmed: true })
  })

  test('removes current and retired sessions, preserves team state and other active nodes, and starts fresh', async () => {
    const context = await failedNode()
    const { service, host, task, root } = context
    const oldSession = task.sessionId!
    host.sessions.set('retired', { id: 'retired', workspaceId: 'alpha', isProcessing: false })
    host.policies.set('retired', host.policies.get(oldSession)!)
    host.sessions.set('ordinary', { id: 'ordinary', workspaceId: 'alpha', isProcessing: false })
    host.sessions.set('other-workspace', { id: 'other-workspace', workspaceId: 'beta', isProcessing: false })
    host.policies.set('other-workspace', host.policies.get(oldSession)!)
    await service.command('alpha', { type: 'chat', text: 'Keep reviewing the team while the worker is reset.' })
    const before = await until(() => service.get('alpha'), value => value.state.nodes.find(node => node.nodeId === 'main')?.status === 'working')
    const otherRuntime = before.state.nodes.find(node => node.nodeId === 'main')!
    const result = await service.command('alpha', { type: 'node-reset', nodeId: 'worker', confirmed: true })
    expect(result.config).toEqual(before.config)
    expect(result.state.nodes.find(node => node.nodeId === 'worker')).toEqual({ nodeId: 'worker', status: 'idle' })
    expect(result.state.nodes.find(node => node.nodeId === 'main')).toEqual(otherRuntime)
    expect(host.sessions.get(otherRuntime.sessionId!)?.isProcessing).toBe(true)
    expect(result.state.board).toEqual(before.state.board)
    expect(result.state.memories).toEqual(before.state.memories)
    expect(result.state.tasks[0]).toMatchObject({ id: task.id, status: 'failed' })
    expect(result.state.tasks[0]!.sessionId).toBeUndefined()
    expect(result.state.tasks[0]!.checkpoint).toBeUndefined()
    expect(host.deleted.sort()).toEqual([oldSession, 'retired'].sort())
    expect(host.sessions.has('ordinary')).toBe(true)
    expect(host.sessions.has('other-workspace')).toBe(true)
    expect(host.cancelled).toEqual([])
    expect(host.permissionGrantClears).toEqual([])
    const saved = await loadSuperAgentDocument(join(root, 'alpha'))
    expect(saved.pendingTurns.some(turn => turn.nodeId === 'worker')).toBe(false)
    expect(saved.failedTurns?.some(turn => turn.nodeId === 'worker')).toBe(false)
    // Late completion and streaming events from the removed session cannot claim new work.
    for (const listener of host.listeners) listener({ workspaceId: 'alpha', sessionId: oldSession, reason: 'complete', finalText: 'Stale result' })
    host.emit({ type: 'text_delta', sessionId: oldSession, delta: 'Stale stream' }, 'alpha')
    await service.command('alpha', { type: 'task', nodeId: 'worker', title: 'New verification', instructions: 'Only verify remaining work.' })
    const fresh = await until(() => service.get('alpha'), value => value.state.tasks.at(-1)?.status === 'running')
    expect(fresh.state.tasks.at(-1)!.sessionId).not.toBe(oldSession)
    expect(fresh.state.tasks[0]!.status).toBe('failed')
    expect(fresh.state.messages.some(message => message.body === 'Stale result')).toBe(false)
    expect(host.sends.filter(send => send.sessionId === oldSession)).toHaveLength(1)
  })

  test('discards automatic recovery and waiting work without replaying after restart', async () => {
    const context = await failedNode('network_error')
    // The second task waits behind the recovering node's call-rate limit.
    await context.service.command('alpha', { type: 'task', nodeId: 'worker', title: 'Queued', instructions: 'Do not replay after reset.' })
    await context.service.command('alpha', { type: 'node-reset', nodeId: 'worker', confirmed: true })
    const saved = await loadSuperAgentDocument(join(context.root, 'alpha'))
    expect(saved.state.tasks.filter(task => task.nodeId === 'worker').every(task => task.status === 'cancelled')).toBe(true)
    expect(saved.pendingTurns.some(turn => turn.nodeId === 'worker')).toBe(false)
    await context.service.cleanup()
    const restarted = new SuperAgentService({ host: context.host, rootForWorkspace: id => join(context.root, id), now: context.now, autoTick: false })
    try {
      context.advance(5000)
      await restarted.get('alpha'); await restarted.tick()
      expect((await restarted.get('alpha')).state.nodes.find(node => node.nodeId === 'worker')).toEqual({ nodeId: 'worker', status: 'idle' })
      expect(context.host.sends.filter(send => context.host.policies.get(send.sessionId)?.nodeId === 'worker')).toHaveLength(0)
      expect(context.host.sends.filter(send => send.sessionId === context.task.sessionId)).toHaveLength(1)
    } finally { await restarted.cleanup() }
  })

  test('validates ownership and refuses active or healthy nodes before deleting anything', async () => {
    const context = await failedNode()
    const command = { type: 'node-reset', nodeId: 'worker', confirmed: true } as const
    const session = context.host.sessions.get(context.task.sessionId!)!
    session.workspaceId = 'beta'
    await expect(context.service.command('alpha', command)).rejects.toThrow('not owned')
    session.workspaceId = 'alpha'; session.isProcessing = true
    await expect(context.service.command('alpha', command)).rejects.toThrow('still busy')
    session.isProcessing = false
    await expect(context.service.command('alpha', { ...command, nodeId: 'missing' })).rejects.toThrow('Unknown node')
    await expect(context.service.command('alpha', { ...command, nodeId: 'main' })).rejects.toThrow('Only abnormal')
    expect(context.host.deleted).toEqual([])
    expect((await loadSuperAgentDocument(join(context.root, 'alpha'))).failedTurns).toHaveLength(1)
  })

  test('failed deletion keeps the node abnormal and can be retried without restoring a checkpoint', async () => {
    const context = await failedNode()
    const original = context.host.deleteSession.bind(context.host)
    context.host.deleteSession = async () => { throw new Error('Delete failed') }
    const command = { type: 'node-reset', nodeId: 'worker', confirmed: true } as const
    await expect(context.service.command('alpha', command)).rejects.toThrow('Delete failed')
    const saved = await loadSuperAgentDocument(join(context.root, 'alpha'))
    expect(saved.state.nodes.find(node => node.nodeId === 'worker')!.status).toBe('error')
    expect(saved.failedTurns).toEqual([])
    expect(saved.state.tasks[0]!.checkpoint).toBeUndefined()
    context.host.deleteSession = original
    expect((await context.service.command('alpha', command)).state.nodes.find(node => node.nodeId === 'worker')).toEqual({ nodeId: 'worker', status: 'idle' })
  })

  test('resets a failed coordinator conversation without replaying the old user turn', async () => {
    const context = await superAgentFixture()
    const host = resetHost(context.host)
    await context.service.save('alpha', context.config)
    await context.service.command('alpha', { type: 'chat', text: 'Original user request' })
    const started = await until(() => context.service.get('alpha'), snapshot => snapshot.state.nodes.find(node => node.nodeId === 'main')?.status === 'working')
    const oldSession = started.state.nodes.find(node => node.nodeId === 'main')!.sessionId!
    host.complete(oldSession, 'Invalid credentials', 'error', { errorCode: 'invalid_api_key' })
    await until(() => context.service.get('alpha'), snapshot => snapshot.state.nodes.find(node => node.nodeId === 'main')?.status === 'error')
    const reset = await context.service.command('alpha', { type: 'node-reset', nodeId: 'main', confirmed: true })
    expect(reset.state.nodes.find(node => node.nodeId === 'main')).toEqual({ nodeId: 'main', status: 'idle' })
    expect(reset.config).toEqual(started.config)
    expect(host.deleted).toEqual([oldSession])
    expect(host.sends).toHaveLength(1)
    await context.service.command('alpha', { type: 'chat', text: 'New user request' })
    await until(() => context.service.get('alpha'), snapshot => snapshot.state.nodes.find(node => node.nodeId === 'main')?.status === 'working')
    expect(host.sends.at(-1)!.sessionId).not.toBe(oldSession)
    expect(host.sends.at(-1)!.message).toBe('New user request')
  })

  test('stops only scripts linked to the node, with failed stops remaining retryable', async () => {
    const stopped: string[] = []
    let failStop = true
    const context = await superAgentFixture({
      resolveEnvironment: async (_workspace, environment) => ({ workingDirectory: environment.workingDirectory, status: { available: true, isolation: 'container', detail: 'Test' } }),
      spawnScript: async ({ script }) => ({ child: new EventEmitter() as ChildProcess, stop: async () => { if (failStop && script.id === 'own') throw new Error('Stop failed'); stopped.push(script.id) } }),
    })
    resetHost(context.host)
    context.config.environment.kind = 'sandbox'; context.config.environment.sandbox = { runtime: 'docker', image: 'test' }
    context.config.scripts = ['own', 'other'].map(id => ({ id, name: id, path: 'script.js', args: [], timeoutSeconds: 60, ...(id === 'own' ? { nodeId: 'worker' } : {}) }))
    await writeFile(join(context.workingDirectory, 'script.js'), 'console.log("test")')
    await context.service.save('alpha', context.config)
    for (const scriptId of ['own', 'other']) await context.service.command('alpha', { type: 'script-run', scriptId })
    await context.service.command('alpha', { type: 'task', nodeId: 'worker', title: 'Verify', instructions: 'Verify results' })
    const started = await until(() => context.service.get('alpha'), snapshot => snapshot.state.tasks[0]?.status === 'running')
    context.host.complete(started.state.tasks[0]!.sessionId!, 'Invalid credentials', 'error', { errorCode: 'invalid_api_key' })
    await until(() => context.service.get('alpha'), snapshot => snapshot.state.nodes.find(node => node.nodeId === 'worker')?.status === 'error')
    const command = { type: 'node-reset', nodeId: 'worker', confirmed: true } as const
    await expect(context.service.command('alpha', command)).rejects.toThrow('Stop failed')
    failStop = false
    const result = await context.service.command('alpha', command)
    expect(stopped).toEqual(['own'])
    expect(result.state.scripts.find(script => script.scriptId === 'own')!.status).toBe('stopped')
    expect(result.state.scripts.find(script => script.scriptId === 'other')!.status).toBe('running')
  })
})
