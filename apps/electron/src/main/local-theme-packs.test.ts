import { expect, mock, test } from 'bun:test'
import { registerLocalThemePacks } from './local-theme-packs'
import { createLocalThemePackApi } from '../preload/local-theme-packs'
import { buildClientApi } from '../transport/build-api'
import { CHANNEL_MAP } from '../transport/channel-map'
import type { NativeAuthorityEvent } from './native-window-authority'

function fixture() {
  let selected: string | null = 'local-pack'
  const pack = { id: 'local-pack', dir: 'C:/local/themes/local-pack', source: 'native' as const, location: 'user' as const, manifest: { name: 'Local' } }
  const config = {
    listThemePacks: mock(() => [pack]), getThemePacksDir: () => 'C:/local/themes',
    loadThemePack: mock((id: string) => id === pack.id ? pack : null),
    getSelectedThemePackId: () => selected,
    setSelectedThemePackId: (id: string | null) => { selected = id },
    readThemePackAsset: mock(() => ({ path: 'C:/local/themes/local-pack/model/textures/texture.png', dataUrl: 'data:image/png;base64,bG9jYWw=', mimeType: 'image/png' })),
    importThemePackFromPath: mock(() => pack), importThemePackFromFolder: mock(() => pack),
    deleteThemePack: mock(() => true),
  }
  const listeners = new Map<string, (event: unknown, payload: unknown) => void>()
  let handler: (...args: any[]) => Promise<unknown>
  let trusted = true
  const assertSender = () => { if (!trusted) throw new Error('Untrusted window') }
  const openDialog = mock(async (_event: NativeAuthorityEvent, _folder: boolean) => ({ canceled: false, filePaths: ['C:/downloads/theme'] }))
  registerLocalThemePacks({ handle: (_channel, callback) => { handler = callback } }, {
    assertSender, config: async () => config, openDialog,
    broadcast: payload => { for (const listener of listeners.values()) listener({}, payload) },
  })
  const remoteInvoke = mock(async () => { throw new Error('Remote server unavailable') })
  const api = buildClientApi({ invoke: remoteInvoke, on: () => () => {}, handleCapability: () => {} }, CHANNEL_MAP)
  Object.assign(api, createLocalThemePackApi({
    invoke: (_channel, method, ...args) => handler({} as NativeAuthorityEvent, method, ...args),
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: channel => listeners.delete(channel),
  }))
  return { api, remoteInvoke, config, openDialog, untrust: () => { trusted = false } }
}

test('remote frontend reads local packs, selection and Live2D assets even when the server is unavailable', async () => {
  const f = fixture()
  expect((await f.api.getThemePacks())[0]?.id).toBe('local-pack')
  expect(await f.api.getThemePacksDir()).toBe('C:/local/themes')
  expect((await f.api.getSelectedThemePack())?.id).toBe('local-pack')
  expect((await f.api.getThemePack('local-pack'))?.dir).toContain('C:/local')
  expect(await f.api.getThemePackAsset('local-pack', 'model/textures/texture.png')).toHaveProperty('dataUrl')
  expect(f.config.readThemePackAsset).toHaveBeenCalledWith('local-pack', 'model/textures/texture.png')
  await f.api.setSelectedThemePack(null)
  expect(await f.api.getSelectedThemePack()).toBeNull()
  expect(f.remoteInvoke).not.toHaveBeenCalled()
})

test('local imports, selection and deletion deliver changes with removable listeners', async () => {
  const f = fixture()
  const changes = mock(() => {})
  const unsubscribe = f.api.onThemePackChange(changes)
  await f.api.importThemePack()
  expect(f.config.importThemePackFromPath).toHaveBeenCalledWith('C:/downloads/theme')
  await f.api.importThemePackFolder()
  expect(f.openDialog.mock.calls[1]?.[1]).toBe(true)
  expect(f.config.importThemePackFromFolder).toHaveBeenCalledWith('C:/downloads/theme')
  await f.api.setSelectedThemePack('local-pack')
  expect(changes).toHaveBeenLastCalledWith({ packId: 'local-pack' })
  await f.api.deleteThemePack('local-pack')
  expect(changes).toHaveBeenLastCalledWith({ packId: 'local-pack', deleted: true })
  unsubscribe()
  await f.api.setSelectedThemePack(null)
  expect(changes).toHaveBeenCalledTimes(4)
  expect(f.remoteInvoke).not.toHaveBeenCalled()
})

test('untrusted windows cannot access local theme files', async () => {
  const f = fixture()
  f.untrust()
  await expect(f.api.getThemePacks()).rejects.toThrow('Untrusted window')
  expect(f.config.listThemePacks).not.toHaveBeenCalled()
})

test('import cancellation and window invalidation do not write local files', async () => {
  const f = fixture()
  f.openDialog.mockImplementationOnce(async () => ({ canceled: true, filePaths: [] }))
  expect(await f.api.importThemePack()).toBeNull()
  f.openDialog.mockImplementationOnce(async () => { f.untrust(); return { canceled: false, filePaths: ['C:/downloads/theme'] } })
  await expect(f.api.importThemePackFolder()).rejects.toThrow('Untrusted window')
  expect(f.config.importThemePackFromPath).not.toHaveBeenCalled()
  expect(f.config.importThemePackFromFolder).not.toHaveBeenCalled()
})
