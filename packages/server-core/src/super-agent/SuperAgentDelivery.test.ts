import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadSuperAgentDocument, withSuperAgentOrchestrator } from '@craft-agent/shared/super-agent'
import { buildSuperAgentNodePrompt } from './SuperAgentPrompt'
import { superAgentFixture, until } from './SuperAgentTestSupport'

const actions = (value: object) => `<super_agent_actions>${JSON.stringify(value)}</super_agent_actions>`

async function prepareArtifact() {
  const f = await superAgentFixture()
  await f.service.save('alpha', f.config)
  await f.service.command('alpha', { type: 'task', id: 'report-task', nodeId: 'worker', title: 'Report', instructions: 'Write report' })
  const running = await until(() => f.service.get('alpha'), s => s.state.tasks[0]?.status === 'running')
  const path = join(f.workingDirectory, 'report.md')
  await writeFile(path, 'Initial report')
  await f.service.updateNodeTask('alpha', running.state.tasks[0]!.sessionId!, { action: 'artifact', taskId: 'report-task', id: 'report', path: 'report.md', description: 'Research report' })
  f.host.complete(running.state.tasks[0]!.sessionId!, 'Report ready')
  f.advance(2_000)
  await f.service.tick()
  const summary = await until(() => f.service.get('alpha'), s => s.state.nodes[0]?.status === 'working')
  return { ...f, path, sessionId: summary.state.nodes[0]!.sessionId! }
}

describe('Super Agent delivery', () => {
  test('file handoff persists its version, and the same text can advance from stage to final', async () => {
    const f = await prepareArtifact()
    const reply = 'Report is ready.'
    f.host.complete(f.sessionId, actions({ userReply: reply, userDelivery: { kind: 'stage', title: 'Draft', artifactIds: ['report', 'report'] } }))
    const stage = await until(() => f.service.get('alpha'), s => s.state.nodes[0]?.status === 'idle')
    const delivery = stage.state.messages.findLast(m => m.delivery)!.delivery!
    expect(delivery).toMatchObject({ kind: 'stage', title: 'Draft', artifacts: [{ id: 'report', path: f.path }] })
    expect(delivery.artifacts).toHaveLength(1)
    const saved = await loadSuperAgentDocument(join(f.root, 'alpha'))
    expect(saved.state.messages.findLast(m => m.delivery)?.delivery).toEqual(delivery)

    f.advance(2_000)
    await f.service.command('alpha', { type: 'inspect' })
    const active = await until(() => f.service.get('alpha'), s => s.state.nodes[0]?.status === 'working')
    f.host.complete(active.state.nodes[0]!.sessionId!, actions({ userReply: reply, userDelivery: { kind: 'final', artifactIds: ['report'] } }))
    const final = await until(() => f.service.get('alpha'), s => s.state.nodes[0]?.status === 'idle')
    expect(final.state.messages.filter(m => m.delivery).map(m => m.delivery!.kind)).toEqual(['stage', 'final'])
    expect(final.state.plans[0]!.status).not.toBe('completed')
  })

  test('changed files reject the success claim until their current version is registered', async () => {
    const f = await prepareArtifact()
    await writeFile(f.path, 'Changed report')
    f.host.complete(f.sessionId, actions({ userReply: 'Delivered!', userDelivery: { kind: 'final', artifactIds: ['report'] } }))
    const result = await until(() => f.service.get('alpha'), s => s.state.nodes[0]?.status === 'idle')
    expect(result.state.messages.some(m => m.toNodeId === 'user' && m.body === 'Delivered!')).toBe(false)
    expect(result.state.messages.some(m => m.delivery)).toBe(false)
    expect(result.state.messages.some(m => m.body.includes('changed; register and verify'))).toBe(true)
  })

  test('a delivery requires visible text and registered artifact IDs', async () => {
    for (const input of [
      { userDelivery: { kind: 'stage' } },
      { userReply: 'Delivered!', userDelivery: { kind: 'final', artifactIds: ['invented'] } },
      { userReply: 'Delivered!', userDelivery: { kind: 'other' } },
    ]) {
      const f = await superAgentFixture()
      await f.service.save('alpha', f.config)
      await f.service.command('alpha', { type: 'chat', text: 'Create a report' })
      const active = await until(() => f.service.get('alpha'), s => s.state.nodes[0]?.status === 'working')
      f.host.complete(active.state.nodes[0]!.sessionId!, actions(input))
      const result = await until(() => f.service.get('alpha'), s => s.state.nodes[0]?.status === 'idle')
      expect(result.state.messages.some(m => m.delivery)).toBe(false)
      expect(result.state.messages.some(m => m.toNodeId === 'user' && m.body === 'Delivered!')).toBe(false)
    }
  })

  test('workers cannot submit user deliveries', async () => {
    const f = await superAgentFixture()
    await f.service.save('alpha', f.config)
    await f.service.command('alpha', { type: 'task', nodeId: 'worker', title: 'Work', instructions: 'Work' })
    const active = await until(() => f.service.get('alpha'), s => s.state.tasks[0]?.status === 'running')
    f.host.complete(active.state.tasks[0]!.sessionId!, actions({ userDelivery: { kind: 'final' } }))
    const result = await until(() => f.service.get('alpha'), s => s.state.tasks[0]?.status === 'completed')
    expect(result.state.messages.some(m => m.delivery)).toBe(false)
    expect(result.state.messages.some(m => m.body.includes('Only the interaction node may deliver'))).toBe(true)
  })

  test('separated and legacy intent nodes both receive the delivery contract', async () => {
    const f = await superAgentFixture()
    for (const config of [f.config, withSuperAgentOrchestrator(f.config)]) {
      const prompt = buildSuperAgentNodePrompt(config, config.nodes.find(n => n.role === 'coordinator')!)
      expect(prompt).toContain('super_agent_deliver')
      expect(prompt).toContain('stage/final')
      expect(prompt).toContain('artifactIds')
    }
  })
})
