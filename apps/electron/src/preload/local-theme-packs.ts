import { LOCAL_THEME_PACK_IPC, LOCAL_THEME_PACK_CHANGED, LOCAL_THEME_PACK_METHODS } from '../shared/local-theme-packs'
import type { ElectronAPI } from '../shared/types'

export function createLocalThemePackApi(ipc: {
  invoke(channel: string, ...args: unknown[]): Promise<any>
  on(channel: string, listener: (event: any, payload: any) => void): unknown
  removeListener(channel: string, listener: (event: any, payload: any) => void): unknown
}) {
  const api = Object.fromEntries(LOCAL_THEME_PACK_METHODS.map(method => [
    method, (...args: unknown[]) => ipc.invoke(LOCAL_THEME_PACK_IPC, method, ...args),
  ]))
  const onThemePackChange: ElectronAPI['onThemePackChange'] = callback => {
    const listener = (_event: unknown, payload: Parameters<typeof callback>[0]) => callback(payload)
    ipc.on(LOCAL_THEME_PACK_CHANGED, listener)
    return () => { ipc.removeListener(LOCAL_THEME_PACK_CHANGED, listener) }
  }
  return { ...api, onThemePackChange }
}
