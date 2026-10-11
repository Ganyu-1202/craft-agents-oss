import { expect, test } from 'bun:test'
import { WsRpcServer } from '@craft-agent/server-core/transport'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { localCloudApi } from './local-cloud'

test('remote viewing discovers devices and renews tickets using the phone local RPC identity', async () => {
  const previousWindow = globalThis.window
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0, requireAuth: true, validateToken: async token => token === 'phone-local-secret' })
  let tickets = 0
  server.handle(RPC_CHANNELS.cloud.LIST_DEVICES, async () => [{ id: 'pc-a', name: 'My PC', online: true }])
  server.handle(RPC_CHANNELS.cloud.CONNECT_DEVICE, async (_ctx, id: string) => ({ url: `wss://cloud.example/v1/connect/${id}`, token: `ticket-${++tickets}` }))
  await server.listen()
  let local: ReturnType<typeof localCloudApi> | undefined
  try {
    Object.assign(globalThis, { window: {
      electronAPI: { listCloudDevices: () => { throw new Error('Must not use the viewed PC account') } },
      CraftAgentAndroid: { getLocalServerConnection: () => JSON.stringify({ url: `ws://127.0.0.1:${server.port}`, token: 'phone-local-secret' }) },
    } })
    local = localCloudApi('remote')
    expect((await local.api.listCloudDevices())[0]?.name).toBe('My PC')
    expect((await local.api.connectCloudDevice('pc-a')).token).toBe('ticket-1')
    expect((await local.api.connectCloudDevice('pc-a')).token).toBe('ticket-2')
    Object.assign(window.CraftAgentAndroid!, { getLocalServerConnection: () => '{}' })
    expect(() => localCloudApi('remote')).toThrow('请先进入本机服务器')
  } finally {
    local?.close()
    await server.close()
    Object.assign(globalThis, { window: previousWindow })
  }
})
