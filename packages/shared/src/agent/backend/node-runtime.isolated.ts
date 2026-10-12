import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// This file runs in its own process; never read or modify application connections.
const root = mkdtempSync(join(tmpdir(), 'tokenbird-node-runtime-'))
const previous = process.env.TOKENBIRD_CONFIG_DIR
process.env.TOKENBIRD_CONFIG_DIR = join(root, 'config')
const { addLlmConnection, getLlmConnection, saveConfig } = await import('../../config/storage.ts')
const { resolveBackendContext, createBackendFromResolvedContext } = await import('./factory.ts')
const { setSessionExecutionPolicy, clearSessionExecutionPolicy, checkSessionExecutionPolicy } = await import('../core/session-execution-policy.ts')
const { PiAgent } = await import('../pi-agent.ts')
const { invalidateSkillsCache } = await import('../../skills/storage.ts')
const workspace = { id: 'node-test', slug: 'node-test', name: 'Test', rootPath: join(root, 'workspace'), createdAt: 1 }
const work = join(root, 'work')
mkdirSync(workspace.rootPath); mkdirSync(work)
saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null })
afterAll(() => {
  clearSessionExecutionPolicy('node-test')
  invalidateSkillsCache()
  if (previous === undefined) delete process.env.TOKENBIRD_CONFIG_DIR
  else process.env.TOKENBIRD_CONFIG_DIR = previous
  if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('Invalid fixture cleanup root')
  rmSync(root, { recursive: true, force: true })
})

test('a durable node backend overrides the connection throughout actual backend construction', async () => {
  expect(addLlmConnection({ slug: 'shared', name: 'Shared Anthropic', providerType: 'anthropic', authType: 'none', agentRuntime: 'claude-code',
    defaultModel: 'claude-sonnet-4-6', createdAt: 1 })).toBe(true)
  const policy = setSessionExecutionPolicy('node-test', { nodeId: 'worker', role: 'worker', rootPath: work,
    agentRuntime: 'pi', allowSkills: ['report'], allowSources: [], allowSubagents: false,
    readFiles: true, writeFiles: false, runPrograms: false, browser: false })
  const context = resolveBackendContext({ sessionConnectionSlug: 'shared', sessionAgentRuntime: policy.agentRuntime })
  expect(context.agentRuntime).toBe('pi')
  expect(context.provider).toBe('pi')
  expect(resolveBackendContext({ sessionConnectionSlug: 'shared' }).agentRuntime).toBe('claude-code')
  expect(getLlmConnection('shared')!.agentRuntime).toBe('claude-code')
  expect(() => resolveBackendContext({ sessionConnectionSlug: 'shared', sessionAgentRuntime: 'codex' })).toThrow('not compatible')
  const agent = createBackendFromResolvedContext({ context, coreConfig: { workspace, isHeadless: true, skipConfigWatcher: true,
    session: { id: 'node-test', workspaceRootPath: workspace.rootPath, workingDirectory: work, createdAt: 1, lastUsedAt: 1 } }, hostRuntime: { appRootPath: process.cwd(), isPackaged: false } })
  try {
    expect(agent).toBeInstanceOf(PiAgent)
    for (const slug of ['report', 'private']) {
      const folder = join(workspace.rootPath, 'skills', slug)
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, 'SKILL.md'), `---\nname: ${slug}\ndescription: ${slug}\n---\nUse ${slug} instructions.`)
    }
    invalidateSkillsCache()
    agent.setAllSources([])
    const extraction = (agent as any).extractSkillPaths('[skill:report] Summarize the result.')
    expect([...extraction.skillPaths.keys()]).toEqual(['report'])
    expect(checkSessionExecutionPolicy('node-test', 'Read', { file_path: join(workspace.rootPath, 'skills', 'report', 'SKILL.md') }).allowed).toBe(true)
    expect(checkSessionExecutionPolicy('node-test', 'Read', { file_path: join(workspace.rootPath, 'skills', 'private', 'SKILL.md') }).allowed).toBe(false)
    expect((agent as any).extractSkillPaths('[skill:private] Read it.').missingSkills).toContain('private')
  } finally { if (agent.disposeForRestart) await agent.disposeForRestart(); else agent.destroy() }
})
