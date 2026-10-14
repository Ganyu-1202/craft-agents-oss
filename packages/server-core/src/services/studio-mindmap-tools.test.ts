import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeMindMapTool } from './studio-mindmap-tools'

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function project() {
  const directory = await mkdtemp(join(tmpdir(), 'studio-project-tools-'))
  directories.push(directory)
  await writeFile(join(directory, 'schema.sql'), 'CREATE TABLE users (id INT PRIMARY KEY);')
  return directory
}
describe('Mind map project tools', () => {
  it('lists and reads real project files with continuation offsets', async () => {
    const directory = await project()
    expect(JSON.parse(await executeMindMapTool(directory, 'list_project_files', { path: '.' }))).toEqual([{ name: 'schema.sql', type: 'file' }])
    expect(JSON.parse(await executeMindMapTool(directory, 'read_project_file', { path: 'schema.sql', offset: 7 })).content).toBe('TABLE users (id INT PRIMARY KEY);')
  })

  it('rejects traversal and excluded files', async () => {
    const directory = await project()
    await writeFile(join(directory, '.env'), 'private')
    await writeFile(join(directory, 'credentials.json'), 'private')
    await expect(executeMindMapTool(directory, 'list_project_files', { path: '..' })).rejects.toThrow('outside')
    await expect(executeMindMapTool(directory, 'read_project_file', { path: '.env' })).rejects.toThrow('excluded')
    await expect(executeMindMapTool(directory, 'read_project_file', { path: 'credentials.json' })).rejects.toThrow('excluded')
  })

  it('rejects directory links escaping the selected project', async () => {
    const directory = await project()
    const outside = await project()
    await symlink(outside, join(directory, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(executeMindMapTool(directory, 'read_project_file', { path: 'outside/schema.sql' })).rejects.toThrow('outside')
  })
})
