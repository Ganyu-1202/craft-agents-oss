import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as config from '@craft-agent/shared/config'
import * as credentials from '@craft-agent/shared/credentials'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport'
import type { HandlerDeps } from '../handler-deps'
import { registerLlmConnectionsHandlers } from './llm-connections'

afterEach(() => mock.restore())

function harness(authType: config.LlmConnection['authType'] = 'oauth') {
  const connection = { slug: 'chosen', name: 'Chosen account', providerType: 'pi', authType } as config.LlmConnection
  spyOn(config, 'getLlmConnection').mockImplementation(slug => slug === connection.slug ? connection : null)
  spyOn(config, 'getDefaultLlmConnection').mockReturnValue('chosen')
  const deleteCredentials = mock(async (_slug: string) => {})
  spyOn(credentials, 'getCredentialManager').mockReturnValue({ deleteLlmCredentials: deleteCredentials } as never)
  const deleteConfig = spyOn(config, 'deleteLlmConnection')
  const reinitializeAuth = mock(async () => {})
  const notifyStoredCredentialChanges = mock(async (_changes: unknown[]) => ({ sessionIdsNeedingRestart: [] }))
  const push = mock((_channel: string, _target: unknown) => {})
  const handlers = new Map<string, HandlerFn>()
  registerLlmConnectionsHandlers({ handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler) }, push } as unknown as RpcServer, {
    sessionManager: { reinitializeAuth, notifyStoredCredentialChanges },
    platform: { logger: { error() {} } }, oauthFlowStore: {},
  } as unknown as HandlerDeps)
  const logout = (slug = 'chosen') => handlers.get(RPC_CHANNELS.llmConnections.LOGOUT)!({ clientId: 'test' } as RequestContext, slug)
  return { logout, deleteCredentials, deleteConfig, reinitializeAuth, notifyStoredCredentialChanges, push }
}

describe('connection sign out', () => {
  test.each(['oauth', 'api_key', 'api_key_with_endpoint', 'iam_credentials', 'service_account_file'] as const)(
    'clears only the selected %s account and preserves config', async authType => {
      const h = harness(authType)
      await expect(h.logout()).resolves.toEqual({ success: true })
      expect(h.deleteCredentials.mock.calls).toEqual([['chosen']])
      expect(h.deleteConfig).not.toHaveBeenCalled()
      expect(h.notifyStoredCredentialChanges.mock.calls).toEqual([[
        ['llm_api_key', 'llm_oauth', 'llm_iam', 'llm_service_account'].map(type => ({ op: 'delete', id: { type, connectionSlug: 'chosen' } })),
      ]])
      expect(h.reinitializeAuth).toHaveBeenCalledTimes(1)
      expect(h.push.mock.calls).toEqual([[RPC_CHANNELS.llmConnections.CHANGED, { to: 'all' }]])
    },
  )
  test('does not delete credentials for a missing connection', async () => {
    const h = harness()
    await expect(h.logout('missing')).resolves.toMatchObject({ success: false })
    expect(h.deleteCredentials).not.toHaveBeenCalled()
    expect(h.push).not.toHaveBeenCalled()
  })
  test.each(['none', 'environment'] as const)('rejects %s authentication without mutating it', async authType => {
    const h = harness(authType)
    await expect(h.logout()).resolves.toMatchObject({ success: false })
    expect(h.deleteCredentials).not.toHaveBeenCalled()
  })
  test('reports credential deletion failures without exposing details or broadcasting success', async () => {
    const h = harness()
    h.deleteCredentials.mockRejectedValue(new Error('private-credential-details'))
    const result = await h.logout()
    expect(result).toEqual({ success: false, error: 'Failed to clear connection credentials' })
    expect(h.notifyStoredCredentialChanges).not.toHaveBeenCalled()
    expect(h.push).not.toHaveBeenCalled()
  })
})
