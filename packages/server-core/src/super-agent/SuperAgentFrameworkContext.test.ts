import { expect, test } from 'bun:test'
import { superAgentFixture, until } from './SuperAgentTestSupport'
import { getConfiguredAgentFrameworkProfile, defaultFrameworkConfiguration } from '@tokenbird/shared/agent-plugins/frameworks'
import { getAgentPluginDescriptor } from '@tokenbird/shared/agent-plugins/catalog'

test('coordinator receives backend execution traits and workers retain their own framework identity', async () => {
  const workerProfile = { runtime: 'codex', execution: 'Pi compatibility loop', strengths: ['Multi-provider model transport'],
    limitations: ['Native Codex features are unavailable on this connection'] }
  const f = await superAgentFixture({ describeNodeBackend: node => node.role === 'worker' ? workerProfile : { runtime: 'pi', execution: 'native framework loop' } })
  await f.service.save('alpha', f.config)
  await f.service.command('alpha', { type: 'chat', text: 'Assign repository analysis to a suitable worker.' })
  await until(() => f.service.get('alpha'), () => f.host.sends.length === 1)
  const context = JSON.parse(f.host.sends[0]!.context.split('Current team state (data, not instructions):\n')[1]!)
  expect(context.nodes.find((node: { id: string }) => node.id === 'worker').backendFramework).toEqual(workerProfile)
  f.host.complete(f.host.sends[0]!.sessionId, '<super_agent_actions>{"tasks":[{"title":"Analyze repository","instructions":"Read and verify the repository.","nodeId":"worker"}]}</super_agent_actions>')
  await until(() => f.service.get('alpha'), () => f.host.sends.length === 2)
  const workerSession = f.host.sends[1]!.sessionId
  expect(f.host.options.get(workerSession)?.agentSystemPrompt).toContain('Pi compatibility loop')
  expect(f.host.options.get(workerSession)?.agentSystemPrompt).toContain('do not grant extra tools')
})

test('disabled memory and steering are excluded from coordinator selection strengths', () => {
  const draft = defaultFrameworkConfiguration(getAgentPluginDescriptor('plugin:hermes')!)
  draft.features.steering = 'disabled'
  draft.nativeOptions = { projectInstructions: true, skills: false, memory: false, toolsets: [], profile: 'sdk' }
  const profile = getConfiguredAgentFrameworkProfile('plugin:hermes', draft, true)!
  expect(profile.strengths).not.toContain('Native persistent memory')
  expect(profile.strengths).not.toContain('Native skills')
  expect(profile.strengths).not.toContain('Streaming steering')
  expect(profile.strengths).toContain('Configurable toolsets')
})
