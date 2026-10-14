import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RpcServer, HandlerFn, RequestContext } from '../../transport'
import type { HandlerDeps } from '../handler-deps'

const root = await mkdtemp(join(tmpdir(), 'tokenbird-sftp-test-'))
const previous = process.env.TOKENBIRD_CONFIG_DIR
process.env.TOKENBIRD_CONFIG_DIR = root
await writeFile(join(root, 'config.json'), JSON.stringify({
  workspaces: [{ id: 'workspace', name: 'SFTP test', rootPath: join(root, 'workspace'), createdAt: Date.now() }],
  activeWorkspaceId: 'workspace',
}))
// Load shared barrels first to avoid Bun's Windows evaluation-order stall
// when importing the standalone RPC handler without server bootstrap.
await import('@tokenbird/shared/utils')
await import('@tokenbird/shared/sessions')
await import('@tokenbird/shared/config')
await import('@tokenbird/server-core/services')
await import('@tokenbird/server-core/handlers')
const { registerFilesHandlers } = await import('./files')
const { RPC_CHANNELS } = await import('@tokenbird/shared/protocol')
const handlers = new Map<string, HandlerFn>()
registerFilesHandlers({ handle: (channel, handler) => { handlers.set(channel, handler) } } as RpcServer, {
  sessionManager: { getSession: async () => ({ workspaceId: 'workspace' }) },
  platform: { logger: { info() {}, warn() {}, error() {}, debug() {} } },
} as unknown as HandlerDeps)
const ctx: RequestContext = { clientId: 'uploader', workspaceId: 'workspace', webContentsId: null }
const invoke = (attachment: unknown, options: unknown, client = ctx) =>
  handlers.get(RPC_CHANNELS.file.STORE_ATTACHMENT)!(client, 'sftp-session', attachment, options)
const attachment = { type: 'unknown', name: 'archive.tar.gz', mimeType: 'application/gzip', size: 4, path: '' }
afterAll(async () => {
  if (previous === undefined) delete process.env.TOKENBIRD_CONFIG_DIR
  else process.env.TOKENBIRD_CONFIG_DIR = previous
  await rm(root, { recursive: true, force: true })
})

test('SFTP staging stores exact bytes and returns persistent attachment metadata', async () => {
  const staged = await invoke(attachment, { sftpStage: 'prepare' }) as { id: string; storedPath: string }
  await writeFile(staged.storedPath, Buffer.from([1, 2, 3, 4]))
  const stored = await invoke({}, { sftpStage: 'finish', uploadId: staged.id }) as { storedPath: string; name: string; size: number }
  expect(stored.name).toBe(attachment.name)
  expect(stored.size).toBe(4)
  expect(await readFile(stored.storedPath)).toEqual(Buffer.from([1, 2, 3, 4]))
  expect(await readFile(staged.storedPath).catch(() => null)).toBeNull()
  await expect(invoke({}, { sftpStage: 'finish', uploadId: staged.id })).rejects.toThrow('expired')
})

test('SFTP staging rejects other clients and mismatched file sizes', async () => {
  const staged = await invoke(attachment, { sftpStage: 'prepare' }) as { id: string; storedPath: string }
  await writeFile(staged.storedPath, 'short')
  await expect(invoke({}, { sftpStage: 'finish', uploadId: staged.id }, { ...ctx, clientId: 'other' })).rejects.toThrow('another connection')
  await expect(invoke({}, { sftpStage: 'finish', uploadId: staged.id })).rejects.toThrow('size or file type mismatch')
  expect(await readFile(staged.storedPath).catch(() => null)).toBeNull()
})

test('SFTP cancellation removes the staged file', async () => {
  const staged = await invoke(attachment, { sftpStage: 'prepare' }) as { id: string; storedPath: string }
  await writeFile(staged.storedPath, 'data')
  await invoke({}, { sftpStage: 'cancel', uploadId: staged.id })
  expect(await readFile(staged.storedPath).catch(() => null)).toBeNull()
})
