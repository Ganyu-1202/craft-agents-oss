import { WsRpcClient } from '../../../electron/src/transport/client'
import { buildClientApi } from '../../../electron/src/transport/build-api'
import { CHANNEL_MAP } from '../../../electron/src/transport/channel-map'
import type { ElectronAPI } from '../../../electron/src/shared/types'

/** Account discovery always uses this phone's credentials, even while viewing a PC. */
export function localCloudApi(connectionMode: 'local' | 'remote'): { api: ElectronAPI; close: () => void } {
  if (connectionMode === 'local') return { api: window.electronAPI, close: () => {} }
  const connection = JSON.parse(window.TokenBirdAgentAndroid?.getLocalServerConnection?.() ?? '{}') as { url?: string; token?: string }
  if (!connection.url || !/^ws:\/\/127\.0\.0\.1:\d+$/.test(connection.url) || !connection.token) {
    throw new Error('请先进入本机服务器并登录 TokenNest，再查找同账号设备。')
  }
  const client = new WsRpcClient(connection.url, { token: connection.token, autoReconnect: false, requestTimeout: 20_000 })
  return { api: buildClientApi(client, CHANNEL_MAP), close: () => client.destroy() }
}
