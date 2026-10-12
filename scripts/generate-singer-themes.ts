/** Rebuild native singer backgrounds and previews using the local raster standees. */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../themes')
const svg = (width: number, height: number, content: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>\n`.replace(/[ \t]+$/gm, '')

/** Previews embed the local official artwork; no external SVG subresources. */
function singer(kind: 'miku' | 'teto', sakura = false): string {
  const pack = kind === 'teto' ? 'teto-crimson' : sakura ? 'miku-sakura' : 'miku-mint'
  const data = readFileSync(resolve(root, pack, 'assets/character.webp')).toString('base64')
  return `<image width="300" height="460" preserveAspectRatio="xMidYMax meet" href="data:image/webp;base64,${data}"/>`
}

const packs = [
  { id: 'miku-mint', name: '初音未来 · 薄荷声场', nameEn: 'Hatsune Miku · Mint Stage', subtitle: 'MIKU / 01', tagline: '青绿双马尾、薄荷天光与电子声场', accent: '#087d7b', darkAccent: '#60ded3', light: '#e8f7f5', night: '#0c202b', glow: '#47c9c3', kind: 'miku' },
  { id: 'miku-sakura', name: '樱花初音 · 花间序曲', nameEn: 'Sakura Miku · Blossom Prelude', subtitle: 'SAKURA / 01', tagline: '粉樱双马尾、柔和花瓣与春日序曲', accent: '#a13b70', darkAccent: '#f7a7cc', light: '#fff0f5', night: '#291827', glow: '#f19fbb', kind: 'miku', sakura: true },
  { id: 'teto-crimson', name: '重音 Teto · 绯红回响', nameEn: 'Kasane Teto · Crimson Echo', subtitle: 'TETO / 04', tagline: '绯红双钻头、奶油白昼与赤色舞台', accent: '#b33257', darkAccent: '#ff91b0', light: '#fff1e9', night: '#2b1725', glow: '#e4688c', kind: 'teto' },
  { id: 'miku-teto-duet', name: '初音 × 重音 · 双色共鸣', nameEn: 'Miku × Teto · Neon Duet', subtitle: 'MIKU × TETO', tagline: '青绿与绯红交织，双人舞台昼夜共鸣', accent: '#087d7b', darkAccent: '#6de2dc', light: '#edf4fa', night: '#151d30', glow: '#65cfd2', kind: 'miku', duet: true },
] as const

for (const pack of packs) {
  const sakura = 'sakura' in pack
  const duet = 'duet' in pack
  const dir = resolve(root, pack.id)
  mkdirSync(resolve(dir, 'assets'), { recursive: true })
  mkdirSync(resolve(dir, 'preview'), { recursive: true })
  const art = singer(pack.kind, sakura)
  for (const dark of [false, true]) {
    const mode = dark ? 'dark' : 'light'
    const ink = dark ? '#e2eef7' : '#365263'
    const accent = dark ? pack.darkAccent : pack.accent
    const second = duet ? '#e77eaa' : pack.glow
    const bg = `<defs>
      <linearGradient id="base" x2="1" y2="1"><stop stop-color="${dark ? pack.night : pack.light}"/><stop offset="1" stop-color="${dark ? '#0c1320' : '#fffdfb'}"/></linearGradient>
      <radialGradient id="glow"><stop stop-color="${pack.glow}" stop-opacity="${dark ? '.28' : '.25'}"/><stop offset="1" stop-color="${pack.glow}" stop-opacity="0"/></radialGradient>
      <pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" fill="none" stroke="${accent}" stroke-opacity=".06"/></pattern>
    </defs>
    <rect width="1600" height="1000" fill="url(#base)"/>
    <rect width="1600" height="1000" fill="url(#grid)"/>
    <ellipse cx="1450" cy="680" rx="680" ry="680" fill="url(#glow)"/>
    <ellipse cx="160" cy="140" rx="540" ry="500" fill="url(#glow)"/>
    <g fill="none" stroke="${accent}" stroke-opacity=".17"><circle cx="1370" cy="690" r="270"/><circle cx="1370" cy="690" r="300" stroke-dasharray="2 14"/><circle cx="1370" cy="690" r="338"/><path d="M0 890H1600 M0 912H1600"/></g>
    <g fill="${accent}" opacity=".14">${Array.from({ length: 64 }, (_, i) => { const h = 12 + Math.round((Math.sin(i * .6) ** 2 + Math.cos(i * .23) ** 2) * 56); return `<rect x="${i * 26}" y="${942 - h}" width="8" height="${h}" rx="4"/>` }).join('')}</g>
    <g fill="${second}" opacity=".3">${Array.from({ length: 26 }, (_, i) => `<circle cx="${(i * 317 + 140) % 1600}" cy="${(i * 173 + 45) % 850}" r="${i % 3 + 1}"/>`).join('')}</g>
    ${sakura ? `<g fill="#e997b8" opacity=".38">${Array.from({ length: 14 }, (_, i) => `<ellipse cx="${(i * 211 + 80) % 1600}" cy="${(i * 139 + 30) % 820}" rx="5" ry="13" transform="rotate(${i * 29} ${(i * 211 + 80) % 1600} ${(i * 139 + 30) % 820})"/>`).join('')}</g>` : ''}
    <g fill="${ink}" opacity=".22" font-family="sans-serif"><text x="64" y="100" font-size="15" letter-spacing="7">TOKENBIRD / SINGER SERIES</text><text x="1530" y="968" text-anchor="end" font-size="17" letter-spacing="5">${pack.subtitle}</text></g>`
    writeFileSync(resolve(dir, `assets/background-${mode}.svg`), svg(1600, 1000, bg))
    // A self-contained preview: inline artwork avoids relative SVG subresources.
    const pane = dark ? '#18232e' : '#ffffff'
    const preview = `${bg}<g transform="translate(1100 350) scale(1.3)">${art}</g>${duet ? `<g transform="translate(60 410) scale(1.2)">${singer('teto')}</g>` : ''}
      <g fill="${pane}" fill-opacity=".78" stroke="${accent}" stroke-opacity=".15"><rect x="50" y="160" width="260" height="670" rx="26"/><rect x="334" y="160" width="1116" height="670" rx="26"/></g>
      <g fill="${ink}" font-family="sans-serif"><text x="84" y="224" font-size="25" font-weight="600">TokenBird</text><text x="380" y="245" font-size="38" font-weight="600">${pack.subtitle}</text><text x="380" y="285" font-size="16" letter-spacing="4" opacity=".6">YOUR CREATIVE WORKSPACE</text></g>
      <g fill="${accent}" opacity=".17"><rect x="78" y="270" width="204" height="50" rx="12"/><rect x="78" y="345" width="130" height="10" rx="5"/><rect x="78" y="386" width="150" height="10" rx="5"/><rect x="78" y="427" width="114" height="10" rx="5"/><rect x="380" y="330" width="650" height="175" rx="20"/></g>
      <g fill="${ink}" opacity=".25"><rect x="410" y="370" width="420" height="12" rx="6"/><rect x="410" y="404" width="548" height="12" rx="6"/><rect x="410" y="438" width="360" height="12" rx="6"/></g>
      <rect x="380" y="690" width="800" height="92" rx="20" fill="${pane}" fill-opacity=".8" stroke="${accent}" stroke-opacity=".24"/><circle cx="1138" cy="736" r="24" fill="${accent}"/><path d="M1138 746V726M1130 734L1138 726L1146 734" stroke="${pane}" stroke-width="3" fill="none"/>`
    writeFileSync(resolve(dir, `preview/${mode}.svg`), svg(1600, 1000, preview))
  }
  const rgba = (hex: string, opacity: number) => `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${opacity})`
  const colors = {
    supportedModes: ['light', 'dark'], mode: 'scenic',
    background: rgba(pack.light, .62), foreground: '#243544', accent: pack.accent,
    paper: 'rgba(255, 255, 255, 0.83)', navigator: rgba(pack.light, .84), input: 'rgba(255, 255, 255, 0.88)',
    popover: '#fffcfa', popoverSolid: '#fffcfa', info: '#99651b', success: '#24744f', destructive: '#bc3654',
    dark: {
      background: rgba(pack.night, .64), foreground: '#e8eff6', accent: pack.darkAccent,
      paper: rgba(pack.night, .84), navigator: rgba(pack.night, .8), input: rgba(pack.night, .9),
      popover: pack.night, popoverSolid: pack.night, info: '#edc16a', success: '#73d5a4', destructive: '#ff91a5',
    },
    shikiTheme: { light: 'github-light', dark: 'github-dark' },
  }
  const manifest = {
    id: pack.id, name: pack.name, nameEn: pack.nameEn, author: 'TokenBird', version: 2,
    artwork: [
      ...(pack.kind === 'miku' ? [{ artist: 'KEI', credit: 'Art by KEI / © Crypton Future Media, INC. www.piapro.net', sourceUrl: `https://piapro.net/intl/images/ch_img_${sakura ? 'sakuramiku' : 'miku'}.png` }] : []),
      ...(pack.kind === 'teto' || duet ? [{ artist: '坂内 若', credit: '重音テトSV · 坂内 若 / © TWINDRILL', sourceUrl: 'https://kasaneteto.jp/illust-logo/' }] : []),
    ],
    tagline: pack.tagline, description: '官方标准立绘搭配原创声场背景，支持明暗模式与小窗口布局。', tags: ['歌姬', '初音 / 重音', '昼夜', 'SVG'],
    background: { light: 'assets/background-light.svg', dark: 'assets/background-dark.svg' },
    preview: { light: 'preview/light.svg', dark: 'preview/dark.svg' },
    characters: { right: 'assets/character.webp', ...(duet ? { left: 'assets/teto.webp' } : {}) },
    bodyAttr: 'data-tokenbird-singer', stylesheets: ['singer.css'], colors,
    style: { backgroundPosition: 'center', backgroundSize: 'cover', backgroundBlur: 6, borderRadius: '16px', characterHeight: 'clamp(340px, 76vh, 860px)', characterBottom: '-8px', characterOpacity: .96 },
  }
  writeFileSync(resolve(dir, 'theme-pack.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(resolve(dir, 'singer.css'), `/* Native semantic colors follow the light/dark palette in theme-pack.json. */
body[data-tokenbird-singer] {
  --message-user-bg: color-mix(in srgb, var(--accent) 12%, var(--paper));
  --message-tips-bg: var(--paper);
}
body[data-tokenbird-singer] [data-theme-area="sidebar"] {
  background-color: var(--navigator);
}
`)
}
console.log(`Generated ${packs.length} singer theme packs in ${root}`)
