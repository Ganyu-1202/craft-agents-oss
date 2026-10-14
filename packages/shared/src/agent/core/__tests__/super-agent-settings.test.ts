import { afterEach, expect, test } from 'bun:test'
import { classifyActionGate } from '../action-gates'
import { authorizeSessionPolicyTool, checkSessionExecutionPolicy, clearSessionExecutionPolicy, setSessionExecutionPolicy, setSessionPolicyPermissionHandler } from '../session-execution-policy'
const sessionId = 'settings-policy'
afterEach(() => clearSessionExecutionPolicy(sessionId))
test('settings edits keep role, source identity and action approval boundaries', async () => {
  expect(classifyActionGate('mcp__session__super_agent_settings', { action: 'get' })).toBeUndefined()
  expect(classifyActionGate('mcp__session__super_agent_settings', { action: 'update' })).toBe('state-change')
  for (const role of ['coordinator', 'orchestrator', 'worker'] as const) {
    for (const fullControl of [true, false]) {
      setSessionExecutionPolicy(sessionId, { nodeId: role, role, rootPath: process.cwd(), readFiles: false, writeFiles: false, runPrograms: false, browser: false, allowSources: [], allowSubagents: false, actionGates: true, fullControl })
      expect(checkSessionExecutionPolicy(sessionId, 'mcp__session__super_agent_settings', { action: 'get' }).allowed).toBe(role === 'coordinator')
      expect(checkSessionExecutionPolicy(sessionId, 'mcp__session__super_agent_settings', { action: 'update' }).allowed).toBe(false)
      expect(checkSessionExecutionPolicy(sessionId, 'mcp__other__super_agent_settings', { action: 'get' }).allowed).toBe(false)
      let approvals = 0
      setSessionPolicyPermissionHandler(sessionId, async () => { approvals++; return true })
      const updated = await authorizeSessionPolicyTool(sessionId, 'mcp__session__super_agent_settings', { action: 'update', changes: { name: 'User requested name' } }, process.cwd(), undefined, `settings-${role}-${fullControl}`)
      expect(updated.allowed).toBe(role === 'coordinator')
      expect(approvals).toBe(role === 'coordinator' ? 1 : 0)
    }
  }
})
