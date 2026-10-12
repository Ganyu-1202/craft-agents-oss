/** Real React/Radix menu interactions with mocked account RPCs.
 * TOKENBIRD_TEST_DOM_MODULE=<happy-dom/lib/index.js> bun test --tsconfig-override ./apps/electron/tsconfig.json ./scripts/tokenbird-sidebar-account.smoke.ts
 */
import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test'

const domModule = process.env.TOKENBIRD_TEST_DOM_MODULE ?? '/tmp/tokenbird-ui-test-tools/node_modules/happy-dom/lib/index.js'
const { Window } = await import(domModule)
const dom = new Window({ url: 'http://sidebar-account.test', settings: { disableJavaScriptEvaluation: true } })
for (const name of ['Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError']) {
  if (!dom[name]) dom[name] = (globalThis as any)[name]
}
for (const name of ['window', 'document', 'navigator', 'Node', 'NodeFilter', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement', 'DocumentFragment', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent', 'CustomEvent', 'MutationObserver', 'ResizeObserver']) {
  Object.defineProperty(globalThis, name, { value: dom[name], configurable: true, writable: true })
}
Object.defineProperty(globalThis, 'getComputedStyle', { value: dom.getComputedStyle.bind(dom), configurable: true })
Object.defineProperty(globalThis, 'requestAnimationFrame', { value: dom.requestAnimationFrame.bind(dom), configurable: true })
Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: dom.cancelAnimationFrame.bind(dom), configurable: true })
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { Provider, createStore } = await import('jotai')
const { sessionMetaMapAtom } = await import('../apps/electron/src/renderer/atoms/sessions')
const toast = { success: mock((_text: string) => {}), error: mock((_text: string) => {}) }
const navigate = mock((_route: string) => {})
let context: any
mock.module('sonner', () => ({ toast }))
mock.module('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, args?: any) => key + (args?.name ? `:${args.name}` : '') }) }))
mock.module('../apps/electron/src/renderer/context/AppShellContext', () => ({ useAppShellContext: () => context, useOptionalAppShellContext: () => context }))
mock.module('../apps/electron/src/renderer/lib/navigate', () => ({ navigate, routes: { view: { settings: (page: string) => `settings/${page}`, allSessions: (id: string) => `chat/${id}` } } }))
// Use the real shared dropdown implementation without loading the full UI barrel.
const dropdown = await import('../packages/ui/src/components/ui/StyledDropdown')
mock.module('../apps/electron/src/renderer/components/ui/styled-dropdown', () => dropdown)
const { SidebarAccountMenu } = await import('../apps/electron/src/renderer/components/app-shell/SidebarAccountMenu')
const { PageSidebar } = await import('../apps/electron/src/renderer/components/app-shell/PageSidebar')
let root: ReturnType<typeof createRoot>
let store: ReturnType<typeof createStore>
let api: any

async function flush() { await act(async () => { await Promise.resolve(); await Bun.sleep(0) }) }
async function render(sessionId: string | null = 'existing') {
  await act(async () => root.render(React.createElement(Provider, { store }, React.createElement(SidebarAccountMenu, { sessionId }))))
  await flush()
}
function element(selector: string): HTMLElement {
  const found = document.querySelector(selector)
  if (!found) throw new Error(`Missing ${selector}: ${document.body.textContent}`)
  return found as HTMLElement
}
async function openMenu() {
  await act(async () => {
    const trigger = element('[data-testid="sidebar-account-trigger"]')
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
  await flush()
  expect(document.querySelector('[role="menu"]')).not.toBeNull()
}
async function click(target: HTMLElement) { await act(async () => target.click()); await flush() }
function item(key: string) {
  const found = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el => el.textContent?.includes(key))
  if (!found) throw new Error(`Missing menu item ${key}: ${document.body.textContent}`)
  return found
}
function button(key: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(el => el.textContent === key)
  if (!found) throw new Error(`Missing dialog button ${key}`)
  return found
}

beforeEach(() => {
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  store = createStore()
  store.set(sessionMetaMapAtom, new Map([['existing', { id: 'existing', workspaceId: 'workspace', llmConnection: 'personal', messageCount: 4 }]]))
  context = {
    activeWorkspaceId: 'workspace', workspaceDefaultLlmConnection: 'work',
    llmConnections: [
      { slug: 'personal', name: 'Personal AI', oauthAccountEmail: 'me@example.com', authType: 'oauth', isAuthenticated: true },
      { slug: 'work', name: 'Work AI', oauthAccountEmail: 'work@example.com', authType: 'oauth', isAuthenticated: true },
      { slug: 'offline', name: 'Signed out AI', authType: 'api_key', isAuthenticated: false },
    ],
    onCreateSession: mock(async () => ({ id: 'new-session' })),
    refreshLlmConnections: mock(async () => {}),
  }
  api = {
    setWorkspaceDefaultLlmConnection: mock(async () => ({ success: true })),
    setDefaultLlmConnection: mock(async () => ({ success: true })),
    logoutLlmConnection: mock(async () => ({ success: true })),
  }
  ;(window as any).electronAPI = api
  navigate.mockClear(); toast.success.mockClear(); toast.error.mockClear()
})
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; await flush() })
afterAll(async () => { await dom.happyDOM.close() })

test('shows the focused chat account, opens by keyboard, and navigates to AI settings', async () => {
  await render()
  expect(element('[data-testid="sidebar-account-trigger"]').textContent).toContain('me@example.com')
  expect(element('[data-testid="sidebar-account-trigger"]').textContent).toContain('Personal AI')
  await openMenu()
  expect(element('[data-testid="sidebar-account-offline"]').getAttribute('data-disabled')).not.toBeNull()
  await click(item('sidebar.account.settings'))
  expect(navigate.mock.calls).toEqual([['settings/ai']])
})

test('switches the workspace default and opens a new chat with the explicit connection', async () => {
  await render(); await openMenu(); await click(element('[data-testid="sidebar-account-work"]'))
  expect(api.setWorkspaceDefaultLlmConnection.mock.calls).toEqual([['workspace', 'work']])
  expect(api.setDefaultLlmConnection).not.toHaveBeenCalled()
  expect(context.onCreateSession.mock.calls).toEqual([['workspace', { llmConnection: 'work' }]])
  expect(navigate.mock.calls).toEqual([['chat/new-session']])
  expect(store.get(sessionMetaMapAtom).get('existing')?.llmConnection).toBe('personal')
})

test('outside a chat shows and changes the workspace default without creating a chat', async () => {
  await render(null)
  expect(element('[data-testid="sidebar-account-trigger"]').textContent).toContain('work@example.com')
  await openMenu(); await click(element('[data-testid="sidebar-account-personal"]'))
  expect(api.setWorkspaceDefaultLlmConnection.mock.calls).toEqual([['workspace', 'personal']])
  expect(context.onCreateSession).not.toHaveBeenCalled()
})

test('TokenNest shows its username in the card and switch menu, and hides it after logout', async () => {
  Object.assign(context.llmConnections[1], { oauthProvider: 'tokennest', oauthAccountUsername: '星河用户' })
  await render(null)
  expect(element('[data-testid="sidebar-account-trigger"]').textContent).toContain('星河用户')
  expect(element('[data-testid="sidebar-account-trigger"]').textContent).toContain('Work AI')
  await openMenu()
  expect(element('[data-testid="sidebar-account-work"]').textContent).toContain('星河用户')
  await click(item('sidebar.account.settings'))
  context.llmConnections[1].isAuthenticated = false
  await render(null)
  expect(element('[data-testid="sidebar-account-trigger"]').textContent).not.toContain('星河用户')
  await openMenu()
  expect(element('[data-testid="sidebar-account-work"]').textContent).not.toContain('星河用户')
})

test('TokenNest without profile data falls back to its connection name', async () => {
  Object.assign(context.llmConnections[1], { oauthProvider: 'tokennest', oauthAccountEmail: undefined })
  await render(null)
  expect(element('[data-testid="sidebar-account-trigger"]').textContent).toContain('Work AI')
})

test('canvas, mindmap, and super-agent sidebars include the shared account card on desktop and in the drawer', async () => {
  Object.assign(context.llmConnections[1], { oauthProvider: 'tokennest', oauthAccountUsername: '星河用户' })
  for (const title of ['canvas', 'mindmap', 'super-agent']) {
    for (const compact of [false, true]) {
      await act(async () => root.render(React.createElement(Provider, { store }, React.createElement(PageSidebar, {
        title, compact, visible: true, open: true, onOpenChange: () => {}, onToggle: () => {},
      }, React.createElement('nav', null, title)))))
      await flush()
      expect(element('[data-testid="sidebar-account-trigger"]').textContent).toContain('星河用户')
      expect(document.querySelectorAll('[data-testid="sidebar-account-trigger"]').length).toBe(1)
    }
  }
})

test('failed switches show a retry error without opening a chat or claiming success', async () => {
  api.setWorkspaceDefaultLlmConnection.mockResolvedValue({ success: false })
  await render(); await openMenu(); await click(element('[data-testid="sidebar-account-work"]'))
  expect(context.onCreateSession).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledWith('sidebar.account.switchFailed')
  expect(toast.success).not.toHaveBeenCalled()
})

test('sign out requires confirmation, cancel preserves credentials, and confirmation targets only the account', async () => {
  await render(); await openMenu(); await click(item('sidebar.account.signOut'))
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(api.logoutLlmConnection).not.toHaveBeenCalled()
  await click(button('common.cancel'))
  expect(api.logoutLlmConnection).not.toHaveBeenCalled()
  await openMenu(); await click(item('sidebar.account.signOut'))
  await click(button('sidebar.account.signOut'))
  expect(api.logoutLlmConnection.mock.calls).toEqual([['personal']])
  expect(context.refreshLlmConnections).toHaveBeenCalledTimes(1)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

test('signed out and empty states offer sign in and add account without exposing an old identity', async () => {
  context.llmConnections[0].isAuthenticated = false
  await render()
  expect(element('[data-testid="sidebar-account-trigger"]').textContent).not.toContain('me@example.com')
  await openMenu()
  expect(item('sidebar.account.signIn')).toBeDefined()
  expect([...document.querySelectorAll('[role="menuitem"]')].some(el => el.textContent?.includes('sidebar.account.signOut'))).toBe(false)
  await click(item('sidebar.account.signIn'))
  context.llmConnections = []; context.workspaceDefaultLlmConnection = undefined
  await render(null)
  expect(element('[data-testid="sidebar-account-trigger"]').textContent).toContain('sidebar.account.noAccount')
})
