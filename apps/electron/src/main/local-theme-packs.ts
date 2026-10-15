import type { NativeAuthorityEvent } from './native-window-authority'
import { LOCAL_THEME_PACK_IPC, LOCAL_THEME_PACK_METHODS } from '../shared/local-theme-packs'

type PackChange = { packId: string | null; imported?: boolean; deleted?: boolean }
type PackConfig = Pick<typeof import('@tokenbird/shared/config'),
  'listThemePacks' | 'getThemePacksDir' | 'loadThemePack' | 'getSelectedThemePackId' |
  'setSelectedThemePackId' | 'readThemePackAsset' | 'importThemePackFromPath' |
  'importThemePackFromFolder' | 'deleteThemePack'>

export function registerLocalThemePacks(
  ipc: { handle(channel: string, handler: (event: NativeAuthorityEvent, method: string, ...args: unknown[]) => Promise<unknown>): void },
  deps: {
    assertSender(event: NativeAuthorityEvent): unknown
    config(): Promise<PackConfig>
    openDialog(event: NativeAuthorityEvent, folder: boolean): Promise<{ canceled: boolean; filePaths: string[] }>
    broadcast(change: PackChange): void
  },
) {
  ipc.handle(LOCAL_THEME_PACK_IPC, async (event, method, ...args) => {
    deps.assertSender(event)
    if (!(LOCAL_THEME_PACK_METHODS as readonly string[]).includes(method)) throw new Error('Unknown theme pack operation')
    const config = await deps.config()
    deps.assertSender(event)
    const packId = () => {
      if (typeof args[0] !== 'string' || !args[0]) throw new Error('Invalid theme pack ID')
      return args[0]
    }
    switch (method) {
      case 'getThemePacks': return config.listThemePacks()
      case 'getThemePacksDir': return config.getThemePacksDir()
      case 'getThemePack': return config.loadThemePack(packId())
      case 'getSelectedThemePack': {
        const id = config.getSelectedThemePackId()
        return id ? config.loadThemePack(id) : null
      }
      case 'setSelectedThemePack': {
        const id = args[0] === null ? null : packId()
        config.setSelectedThemePackId(id)
        deps.broadcast({ packId: id })
        return
      }
      case 'getThemePackAsset': {
        if (typeof args[1] !== 'string') throw new Error('Invalid theme pack asset')
        return config.readThemePackAsset(packId(), args[1])
      }
      case 'importThemePack':
      case 'importThemePackFolder': {
        const folder = method === 'importThemePackFolder'
        const result = await deps.openDialog(event, folder)
        deps.assertSender(event)
        if (result.canceled || !result.filePaths.length) return null
        const pack = folder ? config.importThemePackFromFolder(result.filePaths[0]!) : config.importThemePackFromPath(result.filePaths[0]!)
        if (pack) deps.broadcast({ packId: pack.id, imported: true })
        return pack
      }
      case 'deleteThemePack': {
        const id = packId()
        const deleted = config.deleteThemePack(id)
        if (deleted) deps.broadcast({ packId: id, deleted: true })
        return deleted
      }
    }
  })
}
