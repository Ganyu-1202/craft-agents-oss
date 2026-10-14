import { act } from 'react'
import { createRoot } from 'react-dom/client'
import i18next from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import en from '../../../../../../packages/shared/src/i18n/locales/en.json'
import type { StudioWorkEvent } from '@tokenbird/shared/protocol'
import StudioMindMap from './StudioMindMap'

declare global { interface Window { runMindMapWorkChecks: () => Promise<string[]> } }
window.runMindMapWorkChecks = async () => {
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
  const i18n = i18next.createInstance()
  await i18n.use(initReactI18next).init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  let listener: ((event: StudioWorkEvent) => void) | undefined
  let request: { requestId: string } | undefined
  let finish!: (result: unknown) => void
  let reject!: (error: Error) => void
  let cancelled = ''
  window.electronAPI = {
    onStudioWorkEvent: (callback: (event: StudioWorkEvent) => void) => { listener = callback; return () => { listener = undefined } },
    generateStudioMindMap: async (input: { requestId: string }) => { request = input; return new Promise((resolve, fail) => { finish = resolve; reject = fail }) },
    cancelStudioText: async (id: string) => { cancelled = id; reject(new Error('Studio request cancelled')) },
  } as unknown as typeof window.electronAPI
  const node = document.createElement('div'); document.body.appendChild(node)
  const root = createRoot(node)
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
  try {
    await act(async () => root.render(<I18nextProvider i18n={i18n}><StudioMindMap /></I18nextProvider>))
    const frame = node.querySelector('iframe')!
    frame.src = 'about:blank'
    await settle()
    frame.contentWindow!.postMessage = (data: string) => {
      const message = JSON.parse(data)
      if (message.action === 'export') queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
        source: frame.contentWindow, data: JSON.stringify({ event: 'export', xml: '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1"/></root></mxGraphModel></diagram></mxfile>', message }),
      })))
    }
    await act(async () => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: '{"event":"init"}' })))
    const input = node.querySelector('textarea')!
    const send = async () => {
      request = undefined
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Explain the diagram')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => (node.querySelector('[aria-label="Send message"]') as HTMLButtonElement).click())
      await settle()
      assert((request as { requestId: string } | undefined)?.requestId, 'Request has no correlation ID')
    }
    await send()
    await act(async () => listener!({ requestId: 'another-request', type: 'tool', tool: 'read_project_file', detail: 'wrong-file', status: 'running' }))
    assert(!node.textContent!.includes('wrong-file'), 'Progress leaked from another request')
    await act(async () => listener!({ requestId: request!.requestId, type: 'tool', tool: 'read_project_file', detail: 'schema.sql', status: 'running' }))
    assert(node.textContent!.includes('Read file') && node.textContent!.includes('schema.sql'), 'Tool progress is not visible while running')
    await act(async () => listener!({ requestId: request!.requestId, type: 'output', phase: 'receiving', characters: 42, text: 'partial' }))
    assert(node.textContent!.includes('42 characters'), 'Incremental output is not visible')
    await act(async () => finish({ mode: 'ask', summary: 'The schema contains users.' }))
    assert(node.textContent!.includes('The schema contains users.') && node.textContent!.includes('schema.sql'), 'Completed answer lost its work history')
    await send()
    const stop = Array.from(node.querySelectorAll('button')).find(button => button.textContent === 'Stop response')!
    await act(async () => stop.click())
    await settle()
    assert(cancelled === request!.requestId, 'Stop did not cancel the active request')
    assert(!node.querySelector('[role="alert"]') && !node.textContent!.includes('Edit failed'), 'User cancellation became an error')
    assert(node.textContent!.includes('stopped'), 'Stopped state was not displayed')
    return ['live tool and output progress', 'request isolation', 'work history retained with answer', 'stop cancels generation without a failure alert']
  } finally { await act(async () => root.unmount()); node.remove() }
}
