import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NATIVE_CREDENTIAL_IPC } from '@craft-agent/shared/credentials/native-types'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { CHANNEL_MAP } from '../channel-map'

const nativeMethods = {
  getNativeCredentialStatus: 'STATUS',
  listNativeCredentials: 'LIST',
  applyNativeCredentialChanges: 'APPLY',
  migrateNativeCredentials: 'MIGRATE',
} as const

describe('native credential preload boundary', () => {
  it('routes remote management to approval protected RPC and keeps migration native', () => {
    const preload = readFileSync(resolve(import.meta.dir, '../../preload/bootstrap.ts'), 'utf8')
    for (const [method, channel] of Object.entries(nativeMethods)) {
      const declaration = preload.split('\n').find(line => line.startsWith(`;(api as ElectronAPI).${method} =`))
      expect(declaration).toBeDefined()
      expect(declaration).toContain(`NATIVE_CREDENTIAL_IPC.${channel}`)
      if (channel !== 'MIGRATE') expect(declaration).toContain(`RPC_CHANNELS.credentials.${channel}`)
      else expect(declaration).toContain('ipcRenderer.invoke')
      expect(declaration).not.toContain('workspaceId')
    }
  })

  it('never exposes native IPC channels through the public transport', () => {
    const rpcChannels = JSON.stringify(RPC_CHANNELS)
    for (const channel of Object.values(NATIVE_CREDENTIAL_IPC)) {
      expect(Object.values(CHANNEL_MAP).some(entry => entry.channel === channel)).toBe(false)
      expect(rpcChannels).not.toContain(channel)
    }
    expect('migrateNativeCredentials' in CHANNEL_MAP).toBe(false)
  })
})
