import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { validateSkillContent, validateSlug } from '@tokenbird/session-tools-core'
import { invalidateSkillsCache, loadSkill } from '@tokenbird/shared/skills'

async function packageFiles(directory: string) {
  const files = new Map<string, Buffer>(); let bytes = 0; let entries = 0
  const visit = async (path: string, prefix = ''): Promise<void> => {
    if ((await lstat(path)).isSymbolicLink() || await realpath(path) !== resolve(path)) throw new Error('Skill packages cannot contain links or junctions')
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++entries > 256) throw new Error('Skill package has too many entries')
      const name = prefix ? `${prefix}/${entry.name}` : entry.name
      const file = join(path, entry.name); const before = await lstat(file)
      if (before.isSymbolicLink()) throw new Error('Skill packages cannot contain links')
      if (before.isDirectory()) { await visit(file, name); continue }
      if (!before.isFile() || before.size > 4 * 1024 * 1024 || bytes + before.size > 16 * 1024 * 1024) throw new Error('Skill package exceeds its file limits')
      const data = await readFile(file); const after = await lstat(file)
      if (after.isSymbolicLink() || await realpath(file) !== resolve(file) || before.ino !== after.ino || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || data.length !== before.size) throw new Error('Skill package changed while being read')
      bytes += data.length; files.set(name, data)
    }
  }
  await visit(directory)
  return files
}

const hashes = (files: Map<string, Buffer>) => [...files].map(([path, data]) => ({ path, sha256: createHash('sha256').update(data).digest('hex') }))

/** Narrow managed installation: an execution-folder package into this workspace only.
 * It never overwrites a different skill, binds resources, or executes package code. */
export async function installSuperAgentSkill(workspaceRoot: string, executionRoot: string, path: string, slug: string) {
  if (!validateSlug(slug).valid) throw new Error('Invalid skill slug')
  const root = await realpath(executionRoot); const source = resolve(root, path)
  const rel = relative(root, source)
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Skill package must be inside the execution folder')
  const files = await packageFiles(source)
  const content = files.get('SKILL.md')
  if (!content) throw new Error('Skill package must contain SKILL.md')
  const validation = validateSkillContent(content.toString('utf8'), slug)
  if (!validation.valid) throw new Error(`Invalid skill: ${validation.errors.map(error => error.message).join('; ')}`)
  const workspace = await realpath(workspaceRoot); const skills = join(workspace, 'skills')
  await mkdir(skills, { recursive: true })
  if (await realpath(skills) !== skills) throw new Error('Workspace skill directory cannot be a link or junction')
  const destination = join(skills, slug); const expected = hashes(files)
  let created = false
  try {
    await mkdir(destination); created = true
    // Publish the entry point last so incomplete installs are not discoverable.
    for (const [name, data] of [...files].sort(([a], [b]) => Number(a === 'SKILL.md') - Number(b === 'SKILL.md'))) {
      const target = join(destination, name)
      await mkdir(resolve(target, '..'), { recursive: true })
      await writeFile(target, data, { flag: 'wx' })
    }
  } catch (error) {
    if (created) { await rm(destination, { recursive: true, force: true }); throw error }
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if (JSON.stringify(hashes(await packageFiles(destination))) !== JSON.stringify(expected)) throw new Error('A different skill already exists; installation will not overwrite it')
  }
  invalidateSkillsCache()
  const skill = loadSkill(workspace, slug)
  if (!skill) throw new Error('Installed skill was not recognized by the workspace')
  return { skillSlug: slug, path: destination, installed: true, reused: !created, validation, files: expected }
}
