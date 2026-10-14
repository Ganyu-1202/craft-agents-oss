import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

export const mindMapTools = [
  { type: 'function', function: { name: 'list_project_files', description: 'List files in a project directory to find source code, database schemas and documentation.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative directory path; use . for the project root.' } }, required: ['path'], additionalProperties: false } } },
  { type: 'function', function: { name: 'read_project_file', description: 'Read a project text file. Use offset to continue reading long files.', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }, required: ['path'], additionalProperties: false } } },
]

const excluded = /^(?:\.|node_modules$|dist$|build$|coverage$|vendor$)|credentials?|secrets?/i
async function projectPath(directory: string, path: unknown): Promise<string> {
  if (typeof path !== 'string' || path.length > 1000 || isAbsolute(path)) throw new Error('Use a relative project path')
  const base = await realpath(directory)
  const target = await realpath(resolve(base, path))
  const rel = relative(base, target)
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Path is outside the project')
  // Check the requested spelling too, so symlinks cannot bypass excluded folders.
  const requested = relative(base, resolve(base, path))
  if ([rel, requested].some(value => value.split(/[\\/]/).filter(Boolean).some(part => excluded.test(part)))) throw new Error('This project path is excluded')
  return target
}

export async function executeMindMapTool(directory: string, name: string, args: Record<string, unknown>): Promise<string> {
  const path = await projectPath(directory, args.path)
  if (name === 'list_project_files') {
    const entries = (await readdir(path, { withFileTypes: true })).filter(entry => !excluded.test(entry.name) && !entry.isSymbolicLink())
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200)
    return JSON.stringify(entries.map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })))
  }
  if (name === 'read_project_file') {
    const info = await stat(path)
    if (!info.isFile() || info.size > 2_000_000) throw new Error('Choose a text file smaller than 2 MB')
    const buffer = await readFile(path)
    if (buffer.includes(0)) throw new Error('This is not a text file')
    const content = buffer.toString('utf8')
    const offset = typeof args.offset === 'number' && Number.isSafeInteger(args.offset) && args.offset >= 0 ? args.offset : 0
    return JSON.stringify({ path: args.path, offset, totalCharacters: content.length, content: content.slice(offset, offset + 16_000) })
  }
  throw new Error(`Unknown tool: ${name}`)
}
