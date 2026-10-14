import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import type { RpcServer, HandlerFn, RequestContext } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import type { ImageProcessor } from '../../runtime/platform'
import type { StoredAttachment } from '@craft-agent/core/types'

const root = await mkdtemp(join(tmpdir(), 'tokenbird-image-upload-test-'))
const previous = process.env.TOKENBIRD_CONFIG_DIR
process.env.TOKENBIRD_CONFIG_DIR = root
await writeFile(join(root, 'config.json'), JSON.stringify({
  workspaces: [{ id: 'workspace', name: 'Image test', rootPath: join(root, 'workspace'), createdAt: Date.now() }],
  activeWorkspaceId: 'workspace',
}))
await import('@craft-agent/shared/utils')
const { getSessionAttachmentsPath } = await import('@craft-agent/shared/sessions')
await import('@craft-agent/shared/config')
const { setImageProcessor } = await import('@craft-agent/server-core/services')
await import('@craft-agent/server-core/handlers')
const { registerFilesHandlers } = await import('./files')
const { RPC_CHANNELS, IMAGE_UPLOAD_MAX_BYTES } = await import('@craft-agent/shared/protocol')
const realProcessor: ImageProcessor = {
  getMetadata: async input => {
    const result = await sharp(input).metadata()
    return result.width && result.height ? { width: result.width, height: result.height } : null
  },
  process: async (input, opts) => {
    let result = sharp(input)
    if (opts?.resize) result = result.resize(opts.resize.width, opts.resize.height, { fit: opts.fit ?? 'inside' })
    return opts?.format === 'jpeg' ? result.jpeg({ quality: opts.quality }).toBuffer() : result.png().toBuffer()
  },
}
const deps = {
  sessionManager: { getSession: async () => ({ workspaceId: 'workspace' }) },
  platform: { imageProcessor: realProcessor, logger: { info() {}, warn() {}, error() {}, debug() {} } },
} as unknown as HandlerDeps
const handlers = new Map<string, HandlerFn>()
registerFilesHandlers({ handle: (channel, handler) => { handlers.set(channel, handler) } } as RpcServer, deps)
const ctx: RequestContext = { clientId: 'uploader', workspaceId: 'workspace', webContentsId: null }
const invoke = (attachment: unknown, options: unknown = {}, session = 'image-session') =>
  handlers.get(RPC_CHANNELS.file.STORE_ATTACHMENT)!(ctx, session, attachment, options) as Promise<StoredAttachment>
const attachment = (buffer: Buffer) => ({ type: 'image', name: 'photo.png', mimeType: 'image/png', size: buffer.length, base64: buffer.toString('base64'), path: '' })
function processor(value: ImageProcessor) { deps.platform.imageProcessor = value; setImageProcessor(value) }
const large = await sharp(randomBytes(1800 * 1400 * 3), { raw: { width: 1800, height: 1400, channels: 3 } }).png().toBuffer()

afterAll(async () => {
  if (previous === undefined) delete process.env.TOKENBIRD_CONFIG_DIR
  else process.env.TOKENBIRD_CONFIG_DIR = previous
  await rm(root, { recursive: true, force: true })
})

test('compresses a real >2MB upload with optional compression disabled, matching disk bytes, MIME and payload', async () => {
  processor(realProcessor)
  expect(large.length).toBeGreaterThan(IMAGE_UPLOAD_MAX_BYTES)
  const stored = await invoke(attachment(large), { compressImagesBeforeUpload: false })
  const bytes = await readFile(stored.storedPath)
  expect(bytes.length).toBeLessThanOrEqual(IMAGE_UPLOAD_MAX_BYTES)
  expect(stored.size).toBe(bytes.length)
  expect(Buffer.from(stored.resizedBase64!, 'base64')).toEqual(bytes)
  expect(stored.mimeType).toBe('image/jpeg')
  expect(stored.storedPath.endsWith('.jpg')).toBe(true)
  expect((await sharp(bytes).metadata()).format).toBe('jpeg')
})

test('keeps valid uploads at exactly 2MB when optional compression is disabled', async () => {
  processor({ getMetadata: async () => ({ width: 100, height: 100 }), process: async () => Buffer.from('thumbnail') })
  const bytes = Buffer.alloc(IMAGE_UPLOAD_MAX_BYTES)
  const stored = await invoke(attachment(bytes), { compressImagesBeforeUpload: false }, 'boundary-session')
  expect(stored.size).toBe(IMAGE_UPLOAD_MAX_BYTES)
  expect(stored.resizedBase64).toBeUndefined()
  expect(await readFile(stored.storedPath)).toEqual(bytes)
})

test('does not allow the best-effort 100KB path to store an image above 2MB', async () => {
  processor({ getMetadata: async () => ({ width: 1800, height: 1400 }), process: async () => Buffer.alloc(IMAGE_UPLOAD_MAX_BYTES + 1) })
  await expect(invoke(attachment(large), { compressImagesBeforeUpload: true }, 'failed-session')).rejects.toThrow('automatic resize failed')
  expect(await readdir(getSessionAttachmentsPath(join(root, 'workspace'), 'failed-session'))).toEqual([])
})

test('fails closed above 2MB when image processing is unavailable', async () => {
  processor({ getMetadata: async () => null, process: async () => { throw new Error("Cannot find package 'sharp'") } })
  await expect(invoke(attachment(large), { compressImagesBeforeUpload: false })).rejects.toThrow('oversized images')
})

test('compresses staged SFTP images before final storage and removes staging bytes', async () => {
  processor(realProcessor)
  const staged = await invoke(attachment(large), { sftpStage: 'prepare' })
  await writeFile(staged.storedPath, large)
  const stored = await invoke({}, { sftpStage: 'finish', uploadId: staged.id, compressImagesBeforeUpload: false })
  expect((await readFile(stored.storedPath)).length).toBeLessThanOrEqual(IMAGE_UPLOAD_MAX_BYTES)
  expect(await readFile(staged.storedPath).catch(() => null)).toBeNull()
})
