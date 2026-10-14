import { act } from 'react'
import { createRoot } from 'react-dom/client'
import i18next from 'i18next'
import { initReactI18next, I18nextProvider } from 'react-i18next'
import en from '../../../../../../packages/shared/src/i18n/locales/en.json'
import StudioCanvas from './StudioCanvas'
import { AppShellProvider, type AppShellContextType } from '@/context/AppShellContext'
import { ModalProvider } from '@/context/ModalContext'
import { putStudioSession, setActiveStudioSessionId } from './studio-sessions'
import { createLayer, drawImageOnLayer, rawLayer, rasterizeRegion } from './canvas-engine'
import { deserializeLayers, serializeLayer } from './canvas-photoshop'

declare global { interface Window { runImageEditChecks: () => Promise<string[]> } }

/** Exercise the production request -> candidate -> tiled canvas -> undo path in Chromium. */
window.runImageEditChecks = async () => {
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
  const checks: string[] = []
  const i18n = i18next.createInstance()
  await i18n.use(initReactI18next).init({ lng: 'en', keySeparator: false, resources: { en: { translation: en } } })
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  sessionStorage.setItem('tokenbird.studio.imageSetupDismissed', '1')
  const art = document.createElement('canvas'); art.width = 1200; art.height = 300
  const ctx = art.getContext('2d')!, pixels = ctx.createImageData(1200, 300)
  for (let i = 0; i < pixels.data.length; i += 4) pixels.data.set([i / 4 % 2 ? 20 : 240, 90, 170, 255], i)
  ctx.putImageData(pixels, 0, 0)
  const original = createLayer('Original'); original.offset = { x: 7, y: -9 }
  const bounds = { x: -200, y: -100, width: 1200, height: 300 }
  drawImageOnLayer(original, art, bounds)
  const data = JSON.stringify({ version: 1, activeId: original.id, layers: [serializeLayer(original)] })
  await putStudioSession({ id: 'image-edit-fixture', mode: 'canvas', title: 'Image edit', updatedAt: Date.now() }, data)
  setActiveStudioSessionId('canvas', 'image-edit-fixture')
  let command: ((input: Record<string, unknown>) => Promise<unknown>) | undefined
  const patchAlpha = 128
  window.electronAPI = {
    listLlmConnectionsWithStatus: async () => [{ slug: 'image-fixture', name: 'Image fixture', authType: 'api_key', piAuthProvider: 'openai', isAuthenticated: true, models: ['gpt-image-1'] }],
    onLlmConnectionsChanged: () => () => {},
    onStudioCanvasRequest: (callback: typeof command) => { command = callback; return () => {} },
    generateStudioImage: async (input: { imageBase64: string; maskBase64: string }) => {
      const decode = async (base64: string) => { const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode(); return image }
      const output = document.createElement('canvas'); output.width = output.height = 1254
      const context = output.getContext('2d')!
      context.drawImage(await decode(input.imageBase64), 0, 0, 1254, 1254)
      const mask = document.createElement('canvas'); mask.width = mask.height = 1254
      mask.getContext('2d')!.drawImage(await decode(input.maskBase64), 0, 0, 1254, 1254)
      const returned = context.getImageData(0, 0, 1254, 1254), alpha = mask.getContext('2d')!.getImageData(0, 0, 1254, 1254)
      for (let i = 0; i < returned.data.length; i += 4) if (alpha.data[i + 3] === 0) returned.data.set([255, 40, 10, patchAlpha], i)
      context.putImageData(returned, 0, 0)
      return { imageBase64: output.toDataURL('image/png').split(',')[1], mimeType: 'image/png' }
    },
  } as unknown as typeof window.electronAPI
  const node = document.createElement('div'); node.style.cssText = 'width:1200px;height:800px'; document.body.appendChild(node)
  const root = createRoot(node)
  const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 80)) })
  const invoke = async (input: Record<string, unknown>) => { let result: unknown; await act(async () => { result = await command!(input) }); return result }
  const exportPixels = async (rect = bounds) => {
    const saved = await invoke({ action: 'save_project', outputPath: 'fixture.tbcanvas' }) as { base64: string }
    const project = JSON.parse(atob(saved.base64))
    const layers = await deserializeLayers(project.layers)
    return rasterizeRegion(layers.map(rawLayer), rect, rect.width, rect.height).getContext('2d')!.getImageData(0, 0, rect.width, rect.height)
  }
  try {
    await act(async () => root.render(<I18nextProvider i18n={i18n}><ModalProvider><AppShellProvider value={{ llmConnections: [] } as unknown as AppShellContextType}><StudioCanvas onOpenAiSettings={() => {}} /></AppShellProvider></ModalProvider></I18nextProvider>))
    await settle(); await settle()
    await invoke({ action: 'set_parameters', connectionSlug: 'image-fixture', model: 'gpt-image-1', count: 1 })
    await settle()
    await invoke({ action: 'set_selection', ...bounds })
    const result = await invoke({ action: 'generate', mode: 'inpaint', prompt: 'Edit fixture' }) as { status: string }
    assert(result.status === 'applied', 'Inpaint candidate did not apply')
    const edited = await exportPixels()
    for (let i = 3; i < edited.data.length; i += 4) assert(edited.data[i] === 255, 'Translucent response punched a hole in opaque artwork')
    for (let x = 0; x < bounds.width; x++) {
      const i = x * 4
      assert(edited.data.slice(i, i + 4).join() === pixels.data.slice(i, i + 4).join(), 'Protected native pixels were resampled')
    }
    checks.push('1254px translucent provider result preserves opaque artwork and exact native boundary pixels across offset tiles')
    await invoke({ action: 'undo' })
    assert((await exportPixels()).data.every((v, i) => v === pixels.data[i]), 'Undo did not restore the exact source')
    await invoke({ action: 'redo' })
    assert((await exportPixels()).data.every((v, i) => v === edited.data[i]), 'Redo changed the edit result')
    checks.push('edit undo and redo restore every pixel')
    await invoke({ action: 'undo' })
    const expansion = { ...bounds, width: 1600 }
    await invoke({ action: 'set_selection', ...expansion })
    const expanded = await invoke({ action: 'generate', mode: 'outpaint', prompt: 'Expansion fixture' }) as { status: string }
    assert(expanded.status === 'applied', 'Outpaint candidate did not apply')
    const output = await exportPixels(expansion)
    assert(output.data[(150 * 1600 + 1300) * 4 + 3] === patchAlpha, 'Outpaint discarded generated blank pixels')
    for (let y = 0; y < 300; y++) for (let x = 0; x < 1150; x++) for (let c = 0; c < 4; c++) {
      assert(output.data[(y * 1600 + x) * 4 + c] === pixels.data[(y * 1200 + x) * 4 + c], 'Outpaint resampled protected artwork')
    }
    checks.push('outpaint preserves original colors and detail while filling the blank area')
    return checks
  } finally { await act(async () => root.unmount()); node.remove() }
}
