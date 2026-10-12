import { describe, expect, it } from 'bun:test'
import { extractDshPalette, mergeThemePackColors, resolveThemeAppearance, resolveThemePackStyle } from '../theme-pack-compat'
import { loadThemePack, readThemePackAsset } from '../theme-pack'

describe('Harness palette compatibility', () => {
  it('maps only shell declarations, resolves aliases and preserves distinct dark colors', () => {
    const colors = extractDshPalette(`
      body[data-dsh-test] { --primary: #087d7b; --text-primary: #243544; --bg-base: #fff; --bg-1: #fafafa; --warning: #99651b; --danger: #bc3654; --dialog-fill-0: var(--bg-1); }
      body[data-dsh-test] .button { --primary: red; }
      body[data-other] { --bg-base: red; }
      body[data-dsh-test][data-ds-dark-theme] { --primary: #60ded3; --text-primary: #e8eff6; --bg-base: #0c202b; --bg-1: #18232e; }
    `, 'data-dsh-test')
    expect(colors.accent).toBe('#087d7b')
    expect(colors.background).toBe('#fff')
    expect(colors.foreground).toBe('#243544')
    expect(colors.info).toBe('#99651b')
    expect(colors.destructive).toBe('#bc3654')
    expect(colors.popoverSolid).toBe('#fafafa')
    expect(colors.dark?.accent).toBe('#60ded3')
    expect(colors.dark?.popoverSolid).toBe('#18232e')
  })

  it('does not recurse on cyclic variables or execute code', () => {
    expect(extractDshPalette('body { --primary: var(--brand); --brand: var(--primary); }').accent).toBeUndefined()
    expect(extractDshPalette('body { --primary: var(--missing, #fff); }').accent).toBe('#fff')
  })

  it('bridges both shipped DSH skins into native semantic colors', () => {
    expect(loadThemePack('style-galaxy')?.manifest.colors?.background).toContain('244, 243, 251')
    expect(loadThemePack('style-galaxy')?.manifest.colors?.dark?.background).toContain('8, 8, 22')
    expect(loadThemePack('vscode-plus')?.manifest.colors?.accent).toBe('#007acc')
    expect(loadThemePack('vscode-plus')?.manifest.colors?.dark?.background).toBeDefined()
  })
})

describe('theme appearance', () => {
  it('allows scenic packs to follow light/dark, independently of a dark-only preset', () => {
    const pack = { name: 'Day / night', background: { light: 'day.svg', dark: 'night.svg' } }
    expect(resolveThemeAppearance({ supportedModes: ['dark'] }, pack, 'light')).toEqual({ isScenic: true, isDark: false })
    expect(resolveThemeAppearance(null, pack, 'dark').isDark).toBe(true)
  })

  it('honors explicit single-mode packs and retains legacy scenic behavior', () => {
    expect(resolveThemeAppearance(null, { name: 'Light', colors: { supportedModes: ['light'] } }, 'dark').isDark).toBe(false)
    expect(resolveThemeAppearance(null, { name: 'Night', background: { dark: 'night.svg' } }, 'light').isDark).toBe(true)
    expect(resolveThemeAppearance({ mode: 'scenic', backgroundImage: 'old.jpg' }, null, 'light').isDark).toBe(true)
    expect(resolveThemeAppearance({ supportedModes: ['dark'] }, null, 'light').isDark).toBe(true)
  })

  it('merges partial dark palettes without losing preset colors', () => {
    const theme = mergeThemePackColors({ accent: '#123', dark: { background: '#111', accent: '#456' } }, { name: 'Pack', colors: { accent: '#abc', dark: { accent: '#def' } } })
    expect(theme.dark).toEqual({ background: '#111', accent: '#def' })
    expect(theme.accent).toBe('#abc')
  })

  it('inherits global texture settings and clamps invalid numeric style values', () => {
    const style = resolveThemePackStyle({ textureSize: 'cover', texturePosition: 'left bottom', chatOpacity: 2, characterOpacity: NaN, backgroundBlur: -1 })
    expect(style.chatTextureSize).toBe('cover')
    expect(style.sidebarTexturePosition).toBe('left bottom')
    expect(style.chatOpacity).toBe(1)
    expect(style.characterOpacity).toBe(.92)
    expect(style.backgroundBlur).toBe(0)
  })
})

describe('bundled singer series', () => {
  for (const id of ['miku-mint', 'miku-sakura', 'teto-crimson', 'miku-teto-duet']) {
    it(`${id} ships complete light/dark artwork, colors, previews and standees`, () => {
      const pack = loadThemePack(id)!
      expect(pack?.location).toBe('builtin')
      expect(pack?.source).toBe('native')
      expect(pack.manifest.colors?.supportedModes).toEqual(['light', 'dark'])
      expect(pack.manifest.customCss).toContain('--message-user-bg')
      expect(pack.manifest.scripts).toBeUndefined()
      for (const ref of [...Object.values(pack.manifest.background!), ...Object.values(pack.manifest.preview!), ...Object.values(pack.manifest.characters!)]) {
        expect(readThemePackAsset(id, ref)?.mimeType).toBe(ref.endsWith('.webp') ? 'image/webp' : 'image/svg+xml')
      }
    })
  }
})
