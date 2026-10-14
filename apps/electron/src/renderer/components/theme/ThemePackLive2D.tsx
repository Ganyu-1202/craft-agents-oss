import { useEffect, useRef, useState } from 'react'
import type { ThemePack } from '@config/theme-pack'
import { prepareLive2DModel } from '@config/theme-pack-live2d'

export function ThemePackLive2D({ pack, fallback }: { pack: ThemePack; fallback?: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [source, setSource] = useState('')
  const [ready, setReady] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const model = pack.manifest.live2d
  const width = Math.max(180, Math.min(640, Number(model?.width) || 380))
  const height = Math.max(180, Math.min(720, Number(model?.height) || 400))
  const side = model?.position === 'left' ? 'left' : 'right'

  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(motion.matches)
    motion.addEventListener('change', update)
    return () => motion.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setSource('')
    setDisabled(false)
    if (model && !reducedMotion) {
      void Promise.all([
        prepareLive2DModel(model.model, async path => await window.electronAPI?.getThemePackAsset?.(pack.id, path)),
        import('./live2d/frame-source'),
      ]).then(([data, runtime]) => {
        if (!cancelled) setSource(runtime.createLive2DFrame(data))
      }).catch(error => {
        console.warn('[theme-live2d] Using static artwork:', error)
        if (!cancelled) setDisabled(true)
      })
    }
    return () => { cancelled = true }
  }, [pack.id, model, reducedMotion])

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      if (event.data?.type === 'tokenbird:live2d:ready') {
        setReady(true)
        frame.current?.contentWindow?.postMessage({type: 'tokenbird:live2d:pause', paused: document.hidden}, '*')
      }
      if (event.data?.type === 'tokenbird:live2d:error') { setReady(false); setDisabled(true) }
    }
    const visibility = () => frame.current?.contentWindow?.postMessage({type: 'tokenbird:live2d:pause', paused: document.hidden}, '*')
    window.addEventListener('message', receive)
    document.addEventListener('visibilitychange', visibility)
    return () => { window.removeEventListener('message', receive); document.removeEventListener('visibilitychange', visibility) }
  }, [])

  // A timed-out or unsupported renderer always keeps the existing static standee visible.
  useEffect(() => {
    if (!source || ready || disabled) return
    const timeout = setTimeout(() => setDisabled(true), 20000)
    return () => clearTimeout(timeout)
  }, [source, ready, disabled])

  const active = ready && !disabled && !reducedMotion
  return <>
    {fallback && !active ? <img data-char={side} alt="" src={fallback} /> : null}
    {source && !disabled && !reducedMotion ? <iframe
      ref={frame} title="Live2D theme character" sandbox="allow-scripts"
      srcDoc={source} aria-hidden="true" tabIndex={-1}
      style={{position: 'absolute', [side]: 0, bottom: 'var(--theme-pack-char-bottom, 8px)',
        width: `min(${width}px, 48vw)`, height: `min(${height}px, 62vh)`, border: 0, colorScheme: 'normal',
        opacity: active ? 'calc(var(--theme-pack-char-opacity, .96) * var(--theme-character-opacity, 1))' : 0,
        transform: 'scale(var(--theme-character-scale, 1))', transformOrigin: `${side} bottom`, pointerEvents: 'none'}}
    /> : null}
  </>
}
