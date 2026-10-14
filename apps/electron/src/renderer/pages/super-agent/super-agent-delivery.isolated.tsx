import { expect, mock, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlatformProvider } from '@tokenbird/ui/context'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import type { SuperAgentArtifact, SuperAgentDelivery } from '@tokenbird/shared/super-agent'
import { SuperAgentFileContext } from './SuperAgentFileContext'
import type { SuperAgentText } from './super-agent-ui'
import zh from '@tokenbird/shared/i18n/locales/zh-Hans.json'

// The full Markdown barrel loads Vite-only PDF workers. Keep this mock in its
// own process; production Markdown integration is checked by the renderer build.
mock.module('@/components/markdown', () => ({ Markdown: ({ children }: { children: string }) => <div>{children}</div> }))
const { SuperAgentDeliveryCard } = await import('./SuperAgentDeliveryCard')

const text: SuperAgentText = key => (zh as Record<string, string>)[`superAgent.${key}`] ?? key
const i18n = createInstance()
await i18n.init({ lng: 'zh-Hans', resources: { 'zh-Hans': { translation: zh } }, initAsync: false })
const file: SuperAgentArtifact = { id: 'report', taskId: 'task', path: 'reports/draft.md', description: '阶段报告', sha256: 'a'.repeat(64), revision: 1, updatedAt: 1 }

function find(node: React.ReactNode, predicate: (element: React.ReactElement<any>) => boolean): React.ReactElement<any> | undefined {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return undefined
  if (predicate(node)) return node
  for (const child of React.Children.toArray(node.props.children)) {
    const found = find(child, predicate)
    if (found) return found
  }
}

function render(delivery: SuperAgentDelivery, artifacts = [file], disabled = false) {
  const onOpenFile = mock(() => {})
  const onRevealInFinder = mock(() => {})
  const onReply = mock(() => {})
  let tree: React.ReactNode
  function Capture() {
    tree = SuperAgentDeliveryCard({ delivery, artifacts, disabled, text, onReply, body: '报告已整理，**请确认范围**。' })
    return tree
  }
  const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><PlatformProvider actions={{ onOpenFile, onRevealInFinder }}>
    <SuperAgentFileContext workingDirectory="E:/Team"><Capture /></SuperAgentFileContext>
  </PlatformProvider></I18nextProvider>)
  return { html, tree: tree!, onOpenFile, onRevealInFinder, onReply }
}

test('stage handoffs open and reveal files in the team directory and pass their title to feedback', () => {
  const view = render({ kind: 'stage', title: '初稿确认', artifacts: [file] })
  expect(view.html).toContain('阶段交互')
  expect(view.html).toContain('bg-emerald-50')
  expect(view.html).toContain('dark:bg-emerald-950/40')
  expect(view.html).toContain('报告已整理，**请确认范围**。')
  find(view.tree, e => e.type === 'button')!.props.onClick()
  expect(view.onOpenFile).toHaveBeenCalledWith('E:/Team/reports/draft.md')
  find(view.tree, e => e.props['aria-label'] === '打开文件位置')!.props.onClick()
  expect(view.onRevealInFinder).toHaveBeenCalledWith('E:/Team/reports/draft.md')
  find(view.tree, e => typeof e.props.onClick === 'function' && e.props.children?.[1] === '回复本阶段')!.props.onClick()
  expect(view.onReply).toHaveBeenCalledWith('初稿确认')
})

test('final text deliveries need no file and disable feedback while a request is pending', () => {
  const view = render({ kind: 'final', artifacts: [] }, [], true)
  expect(view.html).toContain('最终交付')
  expect(view.html).toContain('反馈或补充要求')
  expect(view.html).not.toContain('交付产物')
  expect(find(view.tree, e => typeof e.props.onClick === 'function')!.props.disabled).toBe(true)
})

test('historical deliveries mark changed versions and disable unavailable files', () => {
  const delivery: SuperAgentDelivery = { kind: 'stage', artifacts: [file] }
  expect(render(delivery, [{ ...file, sha256: 'b'.repeat(64) }]).html).toContain('文件已更新，打开的是当前版本')
  const unavailable = render(delivery, [])
  expect(unavailable.html).toContain('文件当前不可用')
  expect(find(unavailable.tree, e => e.type === 'button')!.props.disabled).toBe(true)
  expect(find(unavailable.tree, e => e.props['aria-label'] === '打开文件位置')!.props.disabled).toBe(true)
})
