import { afterEach, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { syncResourceDirectory } from './resource-sync'

let root: string
let source: string
let destination: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tokenbird-resource-sync-'))
  source = join(root, 'source')
  destination = join(root, 'destination')
  mkdirSync(source)
  mkdirSync(destination)
})

afterEach(() => {
  const relativeRoot = relative(realpathSync(tmpdir()), realpathSync(root))
  if (relativeRoot === '..' || relativeRoot.startsWith(`..${sep}`)) throw new Error('Unexpected temporary directory')
  rmSync(root, { recursive: true, force: true })
})

test('removes renamed assets while copying current resources and preserving the source', () => {
  mkdirSync(join(source, 'bin'))
  mkdirSync(join(destination, 'bin'))
  writeFileSync(join(source, 'bin', 'tokenbird'), 'current command')
  writeFileSync(join(destination, 'bin', 'outdated-cli'), 'obsolete command')
  syncResourceDirectory(source, destination)
  expect(existsSync(join(destination, 'bin', 'outdated-cli'))).toBe(false)
  expect(readFileSync(join(destination, 'bin', 'tokenbird'), 'utf8')).toBe('current command')
  expect(readFileSync(join(source, 'bin', 'tokenbird'), 'utf8')).toBe('current command')
})

test('rejects overlapping source and destination without deleting resources', () => {
  writeFileSync(join(source, 'keep'), 'keep')
  expect(() => syncResourceDirectory(source, source)).toThrow('must not overlap')
  expect(() => syncResourceDirectory(source, root)).toThrow('must not overlap')
  expect(() => syncResourceDirectory(source, join(source, 'output'))).toThrow('must not overlap')
  expect(readFileSync(join(source, 'keep'), 'utf8')).toBe('keep')
})

test('replaces a destination junction without writing or deleting outside the destination', () => {
  const outside = join(root, 'outside')
  mkdirSync(outside)
  mkdirSync(join(source, 'linked'))
  writeFileSync(join(outside, 'keep'), 'untouched')
  writeFileSync(join(source, 'linked', 'current'), 'current')
  symlinkSync(outside, join(destination, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  syncResourceDirectory(source, destination)
  expect(readFileSync(join(outside, 'keep'), 'utf8')).toBe('untouched')
  expect(existsSync(join(outside, 'current'))).toBe(false)
  expect(readFileSync(join(destination, 'linked', 'current'), 'utf8')).toBe('current')
})
