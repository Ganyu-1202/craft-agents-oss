/** Declarative Harness palette bridge. No browser or Node dependencies. */
import type { ThemeOverrides, ThemeFile } from './theme.ts'
import type { ThemePackManifest } from './theme-pack.ts'
import { DEFAULT_THEME_PACK_STYLE, type ThemePackStyle } from './theme-pack-style.ts'

const COLOR_ALIASES = {
  background: ['--bg-base', '--background'],
  foreground: ['--text-primary', '--color-text-1', '--foreground'],
  accent: ['--color-primary', '--brand', '--primary', '--accent'],
  paper: ['--bg-1', '--color-bg-1', '--paper'],
  navigator: ['--bg-2', '--color-bg-2', '--navigator'],
  input: ['--fill-0', '--bg-1', '--input'],
  popover: ['--dialog-fill-0', '--bg-1', '--popover'],
  popoverSolid: ['--dialog-fill-0', '--bg-base', '--popover-solid'],
  success: ['--success'],
  info: ['--warning', '--info'],
  destructive: ['--danger', '--destructive'],
} as const

/** Read only shell-level rules, avoiding component overrides and executing JS. */
export function extractDshPalette(css: string, bodyAttr?: string): ThemeOverrides {
  const light: Record<string, string> = {}
  const dark: Record<string, string> = {}
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = rule[1]!.trim().split(',').map(selector => selector.trim())
    const shellSelectors = selectors.filter(selector => {
      if (bodyAttr && !selector.includes(`[${bodyAttr}]`)) return false
      return /^(?:body|html|:root)(?:\[[\w-]+(?:=[^\]]+)?\]|\.[\w-]+)*$/.test(selector)
    })
    if (!shellSelectors.length) continue
    const declarations = [...rule[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)(?:;|$)/g)]
    for (const selector of shellSelectors) {
      const target = /data-ds-dark-theme|\.dark(?:\b|$)/.test(selector) ? dark : light
      for (const declaration of declarations) target[declaration[1]!] = declaration[2]!.replace(/\s*!important\s*$/, '').trim()
    }
  }
  const map = (variables: Record<string, string>) => {
    const result: ThemeOverrides = {}
    const resolve = (value: string, seen = new Set<string>()): string | undefined => {
      const reference = value.match(/^var\((--[\w-]+)(?:,\s*(.+))?\)$/)
      if (!reference) return /var\(|[{};]/.test(value) ? undefined : value
      const name = reference[1]!
      if (seen.has(name)) return undefined
      seen.add(name)
      const next = variables[name] ?? reference[2]
      return next ? resolve(next, seen) : undefined
    }
    for (const [key, aliases] of Object.entries(COLOR_ALIASES)) {
      for (const alias of aliases) {
        const value = variables[alias] && resolve(variables[alias]!)
        if (value) { result[key as keyof typeof COLOR_ALIASES] = value; break }
      }
    }
    return result
  }
  const result = map(light)
  if (Object.keys(dark).length) result.dark = map({ ...light, ...dark })
  return result
}

/** A pack supplies its own mode policy; legacy scenic presets retain theirs. */
export function resolveThemeAppearance(preset: ThemeFile | null, pack: ThemePackManifest | null, requested: 'light' | 'dark') {
  const isScenic = pack
    ? Boolean(pack.background?.light || pack.background?.dark || pack.backgroundImage)
    : preset?.mode === 'scenic' && Boolean(preset.backgroundImage)
  const supportedModes = pack ? pack.colors?.supportedModes : preset?.supportedModes
  const legacyScenic = isScenic && !pack
  const fallbackScenic = isScenic && pack && !supportedModes && !pack.background?.light
  const resolvedMode = supportedModes?.length === 1 ? supportedModes[0]! : legacyScenic || fallbackScenic ? 'dark' : requested
  return { isScenic, isDark: resolvedMode === 'dark' }
}

/** Nested dark overrides merge independently from the light palette. */
export function mergeThemePackColors(preset: ThemeFile | null, pack: ThemePackManifest | null): ThemeOverrides {
  const colors = pack?.colors
  return colors ? { ...preset, ...colors, dark: { ...preset?.dark, ...colors.dark } } : preset ?? {}
}

export function resolveThemePackStyle(style?: ThemePackStyle): Required<ThemePackStyle> {
  const merged = { ...DEFAULT_THEME_PACK_STYLE, ...style }
  merged.chatTextureSize = style?.chatTextureSize ?? style?.textureSize ?? DEFAULT_THEME_PACK_STYLE.chatTextureSize
  merged.sidebarTextureSize = style?.sidebarTextureSize ?? style?.textureSize ?? DEFAULT_THEME_PACK_STYLE.sidebarTextureSize
  merged.chatTexturePosition = style?.chatTexturePosition ?? style?.texturePosition ?? DEFAULT_THEME_PACK_STYLE.chatTexturePosition
  merged.sidebarTexturePosition = style?.sidebarTexturePosition ?? style?.texturePosition ?? DEFAULT_THEME_PACK_STYLE.sidebarTexturePosition
  for (const key of ['chatOpacity', 'sidebarOpacity', 'characterOpacity'] as const) {
    merged[key] = Number.isFinite(merged[key]) ? Math.max(0, Math.min(1, merged[key])) : DEFAULT_THEME_PACK_STYLE[key]
  }
  merged.backgroundBlur = Number.isFinite(merged.backgroundBlur) ? Math.max(0, Math.min(40, merged.backgroundBlur)) : 0
  return merged
}
