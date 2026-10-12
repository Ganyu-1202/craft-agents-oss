import { expect, test } from 'bun:test'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { installSuperAgentSkill } from './SuperAgentSkillInstall'
import { superAgentFixture, until } from './SuperAgentTestSupport'

const content = '---\nname: Investment analysis\ndescription: Research investment evidence\n---\nRead references/methods.md before analyzing.\n'
async function skillPackage(f: Awaited<ReturnType<typeof superAgentFixture>>) {
  const directory = join(f.workingDirectory, 'investment-analysis')
  await mkdir(join(directory, 'references'), { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), content)
  await writeFile(join(directory, 'references', 'methods.md'), 'Preserve evidence and do not execute trades.')
  await mkdir(join(f.root, 'alpha'), { recursive: true })
  return directory
}

test('managed install validates, retains references, is recognized and reuses identical content without overwriting', async () => {
  const f = await superAgentFixture(); const source = await skillPackage(f)
  const installed = await installSuperAgentSkill(join(f.root, 'alpha'), f.workingDirectory, source, 'investment-analysis')
  expect(installed).toMatchObject({ installed: true, reused: false, validation: { valid: true } })
  expect(installed.files).toHaveLength(2)
  expect(await readFile(join(installed.path, 'references', 'methods.md'), 'utf8')).toContain('do not execute trades')
  expect((await installSuperAgentSkill(join(f.root, 'alpha'), f.workingDirectory, source, 'investment-analysis')).reused).toBe(true)
  await writeFile(join(source, 'SKILL.md'), content + 'Changed version')
  await expect(installSuperAgentSkill(join(f.root, 'alpha'), f.workingDirectory, source, 'investment-analysis')).rejects.toThrow('will not overwrite')
  expect(await readFile(join(installed.path, 'SKILL.md'), 'utf8')).toBe(content)
})

test('managed install rejects invalid packages, outside directories and links', async () => {
  const f = await superAgentFixture(); const source = await skillPackage(f)
  await expect(installSuperAgentSkill(join(f.root, 'alpha'), f.workingDirectory, f.root, 'investment-analysis')).rejects.toThrow('inside the execution folder')
  await expect(installSuperAgentSkill(join(f.root, 'alpha'), f.workingDirectory, source, '../other')).rejects.toThrow('Invalid skill slug')
  await writeFile(join(source, 'SKILL.md'), 'No frontmatter')
  await expect(installSuperAgentSkill(join(f.root, 'alpha'), f.workingDirectory, source, 'investment-analysis')).rejects.toThrow('Invalid skill')
  await writeFile(join(source, 'SKILL.md'), content)
  await symlink(join(f.root, 'alpha'), join(source, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(installSuperAgentSkill(join(f.root, 'alpha'), f.workingDirectory, source, 'investment-analysis')).rejects.toThrow('links')
})

test('installation is limited to the assigned full control worker and returns the real workspace', async () => {
  const f = await superAgentFixture(); const source = await skillPackage(f)
  await f.service.save('alpha', f.config)
  await f.service.command('alpha', { type: 'task', id: 'install', title: 'Install skill', instructions: 'Install the authorized skill', nodeId: 'worker' })
  const snapshot = await until(() => f.service.get('alpha'), value => value.state.tasks[0]?.status === 'running' && f.host.sends.length > 0)
  const sessionId = snapshot.state.nodes.find(node => node.nodeId === 'worker')!.sessionId!
  const request = { action: 'install-skill', taskId: 'install', skillSlug: 'investment-analysis', path: source }
  await expect(f.service.updateNodeTask('alpha', sessionId, request)).rejects.toThrow('full control')
  const state = await f.service.updateNodeTask('alpha', sessionId, { action: 'get' })
  expect(state).toHaveProperty('workspace', { id: 'alpha', rootPath: join(f.root, 'alpha') })
  await expect(f.service.updateNodeTask('alpha', sessionId, { ...request, taskId: 'other' })).rejects.toThrow('assigned')
  f.config.environment.fullControl = true
  await f.service.save('alpha', f.config)
  expect(await f.service.updateNodeTask('alpha', sessionId, request)).toMatchObject({ installed: true, workspaceId: 'alpha', validation: { valid: true } })
  expect(f.host.fullControlChanges).toContainEqual({ workspaceId: 'alpha', enabled: true })
})
