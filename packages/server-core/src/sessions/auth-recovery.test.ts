import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as config from '@tokenbird/shared/config'
import { SessionManager, createManagedSession } from './SessionManager'

afterEach(() => mock.restore())
const tick = () => new Promise(resolve => setImmediate(resolve))

function fixture() {
  spyOn(config, 'getLlmConnection').mockReturnValue({ slug: 'oauth', authType: 'oauth' } as never)
  const sm: any = new SessionManager()
  const managed: any = createManagedSession({ id: 'task', llmConnection: 'oauth' },
    { id: 'ws', rootPath: 'C:/dummy', name: 'Test' } as never, { messagesLoaded: true })
  managed.messages = [{ id: 'original-user', role: 'user', content: 'continue task', timestamp: 1 }]
  managed.lastSentMessage = 'continue task'
  managed.lastSentAttachments = [{ name: 'attachment' }]
  managed.lastSentOptions = { skillSlugs: ['test'] }
  managed.isProcessing = true
  managed.agent = { refreshOAuthCredentials: mock(async () => {}) }
  sm.sessions.set(managed.id, managed)
  sm.sendEvent = mock(() => {})
  sm.disposeManagedAgentRuntime = mock(async () => { managed.agent = null })
  sm.sendMessage = mock(async () => {})
  sm.onProcessingStopped = mock(async () => { managed.isProcessing = false })
  return { sm, managed }
}

describe('OAuth task recovery', () => {
  test('awaits forced renewal before disposal and retries the original user message with attachments', async () => {
    const { sm, managed } = fixture()
    let release!: () => void
    const refresh = mock(() => new Promise<void>(resolve => { release = resolve }))
    managed.agent.refreshOAuthCredentials = refresh
    expect(sm.attemptAuthRetry('task', managed, 'ws')).toBe(true)
    await tick()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(sm.sendMessage).not.toHaveBeenCalled()
    expect(sm.disposeManagedAgentRuntime).not.toHaveBeenCalled()
    release()
    await tick()
    expect(sm.sendMessage).toHaveBeenCalledWith('task', 'continue task', managed.lastSentAttachments,
      undefined, managed.lastSentOptions, 'original-user', true)
    expect(managed.messages).toHaveLength(1)
    expect(managed.authRetryInProgress).toBe(false)
  })

  test('failed renewal requests login; successful login resumes once, including hidden task sessions', async () => {
    const { sm, managed } = fixture()
    managed.hidden = true
    managed.agent.refreshOAuthCredentials = mock(async () => { throw new Error('Your login has expired. Please sign in again to continue.') })
    sm.attemptAuthRetry('task', managed, 'ws')
    await tick()
    expect(sm.sendMessage).not.toHaveBeenCalled()
    expect(sm.sendEvent.mock.calls.at(-1)[0].error.code).toBe('expired_oauth_token')
    expect(managed.isProcessing).toBe(false)
    sm.resumeAfterAuthentication('other')
    expect(sm.sendMessage).not.toHaveBeenCalled()
    sm.resumeAfterAuthentication('oauth')
    sm.resumeAfterAuthentication('oauth')
    await tick()
    expect(sm.sendMessage).toHaveBeenCalledTimes(1)
    expect(managed.pendingAuthResume).toBeUndefined()
  })

  test('temporary refresh failures do not request login or replay with the rejected token', async () => {
    const { sm, managed } = fixture()
    managed.agent.refreshOAuthCredentials = mock(async () => { throw new Error('OAuth token refresh failed: network error. Please try again.') })
    sm.attemptAuthRetry('task', managed, 'ws')
    await tick()
    expect(managed.pendingAuthResume).toBeUndefined()
    expect(sm.sendMessage).not.toHaveBeenCalled()
    expect(sm.sendEvent.mock.calls.at(-1)[0].error.actions.some((a: any) => a.action === 'reauth')).toBe(false)
  })

  test('cancelling a paused task prevents login from resuming it', async () => {
    const { sm, managed } = fixture()
    managed.authRetryAttempted = true
    expect(sm.attemptAuthRetry('task', managed, 'ws')).toBe(false)
    managed.isProcessing = false
    await sm.cancelProcessing('task')
    sm.resumeAfterAuthentication('oauth')
    await tick()
    expect(sm.sendMessage).not.toHaveBeenCalled()
  })

  test('a superseding turn prevents an in-flight renewal from replaying the old task', async () => {
    const { sm, managed } = fixture()
    let release!: () => void
    managed.agent.refreshOAuthCredentials = mock(() => new Promise<void>(resolve => { release = resolve }))
    sm.attemptAuthRetry('task', managed, 'ws')
    await tick()
    managed.processingGeneration++
    managed.pendingAuthResume = undefined
    release()
    await tick()
    expect(sm.sendMessage).not.toHaveBeenCalled()
  })

  test('authentication pauses conductor completion and keeps queued follow-ups', async () => {
    const { sm, managed } = fixture()
    managed.authRetryAttempted = true
    sm.attemptAuthRetry('task', managed, 'ws')
    managed.messageQueue = [{ message: 'follow-up', messageId: 'queued' }]
    // Exercise the real stop path with external persistence/browser work stubbed.
    delete sm.onProcessingStopped
    sm.persistSession = mock(() => {})
    sm.markOrphanedBackgroundTasks = mock(() => {})
    sm.getBrowserPaneManagerForSession = () => null
    const completion = mock(() => {})
    sm.onSessionComplete(completion)
    sm.processNextQueuedMessage = mock(() => {})
    sm.resumeAfterAuthentication('oauth') // Login can finish before the trailing complete event.
    expect(sm.sendMessage).not.toHaveBeenCalled()
    await sm.onProcessingStopped('task', 'error')
    expect(completion).not.toHaveBeenCalled()
    expect(sm.processNextQueuedMessage).not.toHaveBeenCalled()
    expect(managed.messageQueue).toHaveLength(1)
    await tick()
    expect(sm.sendMessage).toHaveBeenCalledTimes(1)
  })
})
