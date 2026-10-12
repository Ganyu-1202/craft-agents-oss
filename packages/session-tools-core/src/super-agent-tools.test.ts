import { describe, expect, test } from 'bun:test'
import { SUPER_AGENT_ACTION_TOOLS, parseSuperAgentToolCall } from './super-agent-tools'
import { getToolDefsAsJsonSchema, SESSION_TOOL_REGISTRY } from './tool-defs'
import type { SessionToolContext } from './context'

describe('collaboration tool schemas and registry', () => {
  test('advertises separate object schemas with required business fields', () => {
    const defs = getToolDefsAsJsonSchema({ prefix: 'mcp__session__' })
    for (const tool of SUPER_AGENT_ACTION_TOOLS) {
      const def = defs.find(def => def.name === `mcp__session__${tool.name}`)!
      expect(def).toBeDefined()
      expect(def.inputSchema.type).toBe('object')
      expect(def.inputSchema.additionalProperties).toBe(false)
      expect(def.inputSchema.required).toContain('requestId')
      expect(def.inputSchema.properties).not.toHaveProperty('json')
      expect(SESSION_TOOL_REGISTRY.get(tool.name)?.executionMode).toBe('registry')
    }
    const dispatch = defs.find(def => def.name === 'mcp__session__super_agent_dispatch')!
    expect(dispatch.inputSchema.required).toContain('title')
    expect(dispatch.inputSchema.required).toContain('instructions')
    const plan = defs.find(def => def.name === 'mcp__session__super_agent_plan')!
    expect(plan.inputSchema.required).toContain('expectedRevision')
  })

  test('preserves Unicode, quotes and paths as arguments without reparsing prose', () => {
    const instructions = '读取 E:\\项目\\报告.md\n保留 "已验证" 的引用。'
    const parsed = parseSuperAgentToolCall('super_agent_dispatch', { requestId: 'one', title: '核验', instructions })
    expect(parsed.actions.tasks?.[0]?.instructions).toBe(instructions)
    expect(() => parseSuperAgentToolCall('super_agent_dispatch', { requestId: 'bad', title: '核验', body: instructions })).toThrow()
    expect(() => parseSuperAgentToolCall('super_agent_script', { requestId: 'bad', action: 'run' })).toThrow('scriptId')
    expect(() => parseSuperAgentToolCall('super_agent_resources', { requestId: 'bad', nodeId: 'worker', reason: 'Need resource' })).toThrow('at least one')
  })

  test('fails closed without an active host and returns rejected outcomes as tool errors', async () => {
    const tool = SESSION_TOOL_REGISTRY.get('super_agent_message')!
    const args = { requestId: 'message', toNodeId: 'main', body: 'New evidence' }
    expect((await tool.handler!({} as SessionToolContext, args)).isError).toBe(true)
    const ctx = { superAgentAction: async () => ({ receipt: { status: 'partially_applied', applied: [{ id: 'committed' }], rejected: { error: 'Runtime failure' } } }) } as unknown as SessionToolContext
    const rejected = await tool.handler!(ctx, args)
    expect(rejected.isError).toBe(true)
    expect(JSON.stringify(rejected)).toContain('committed')
  })
})
