/** Browser-safe presentation preferences, stored independently for each theme. */
import type { ThemeFile, ThemeColors, SurfaceColors } from './theme'

export interface ThemePresentation {
  backgroundDim: number
  glassBlur: number
  showCharacters: boolean
  characterOpacity: number
  characterScale: number
}

export function normalizeThemePresentation(value: Partial<ThemePresentation> | undefined, defaults?: Partial<ThemePresentation>): ThemePresentation {
  const base = { backgroundDim: .18, glassBlur: 8, showCharacters: true, characterOpacity: 1, characterScale: 1, ...defaults }
  const finite = (key: keyof ThemePresentation, min: number, max: number) => {
    const number = value?.[key]
    return typeof number === 'number' && Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : base[key] as number
  }
  return {
    backgroundDim: finite('backgroundDim', 0, .8), glassBlur: finite('glassBlur', 0, 24),
    characterOpacity: finite('characterOpacity', 0, 1), characterScale: finite('characterScale', .5, 1.5),
    showCharacters: typeof value?.showCharacters === 'boolean' ? value.showCharacters : base.showCharacters,
  }
}

/** Existing unmodified presets gain new surfaces without overwriting custom colors. */
export function completeBundledPreset(theme: ThemeFile, bundled: ThemeFile | undefined): ThemeFile {
  if (!bundled) return theme
  const keys: (keyof ThemeColors)[] = ['background', 'foreground', 'accent', 'info', 'success', 'destructive']
  if (keys.some(key => theme[key] !== bundled[key] || theme.dark?.[key] !== bundled.dark?.[key])) return theme
  return { ...bundled, ...theme,
    ...(theme.backgroundImage && bundled.backgroundImageAliases?.includes(theme.backgroundImage) ? { backgroundImage: bundled.backgroundImage } : {}),
    dark: { ...bundled.dark, ...theme.dark } }
}

export function getThemePreviewPalette(theme: ThemeFile, dark: boolean): ThemeColors & SurfaceColors {
  const useDark = theme.supportedModes?.length === 1 ? theme.supportedModes[0] === 'dark' : dark
  const colors = useDark ? { ...theme, ...theme.dark } : theme
  const background = colors.background ?? (useDark ? '#1e1d21' : '#faf9fb')
  return { ...colors, background, paper: colors.paper ?? background, navigator: colors.navigator ?? background, input: colors.input ?? background, foreground: colors.foreground ?? (useDark ? '#f5f5f7' : '#1a1625'), accent: colors.accent ?? '#8b5cf6' }
}
