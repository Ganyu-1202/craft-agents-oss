/** Adapt the bundled Harness skins to TokenBird's actual panels and palette. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { convertDshSkinToManifest } from '../packages/shared/src/config/theme-pack'

for (const id of ['style-galaxy', 'vscode-plus']) {
  const dir = resolve(import.meta.dir, '../themes', id)
  const original = convertDshSkinToManifest(JSON.parse(readFileSync(resolve(dir, 'skin.json'), 'utf8')), dir)
  const { customCss: _css, scripts: _scripts, source: _source, bodyAttr: _attr, ...metadata } = original
  const galaxy = id === 'style-galaxy'
  const manifest = {
    ...metadata, id, version: 2,
    name: galaxy ? '星云 Galaxy' : 'VS Code Light+ / Dark+',
    tagline: galaxy ? '柔紫天光与深空星尘，昼夜双模式' : '清晰的编辑器层次、经典蓝调与昼夜配色',
    description: galaxy ? '原生星云背景与磨砂面板，完整覆盖侧栏、对话和输入框。' : '适配词元鸟的经典编辑器主题，完整覆盖侧栏、卡片和输入框。',
    colors: { ...original.colors, mode: galaxy ? 'scenic' : 'solid', supportedModes: ['light', 'dark'] },
    style: { backgroundBlur: 8, borderRadius: '14px', backgroundPosition: 'center', backgroundSize: 'cover' },
    bodyAttr: `data-tokenbird-${id}`, stylesheets: ['tokenbird.css'],
    ...(galaxy ? { background: { light: 'assets/nebula-light.svg', dark: 'assets/nebula-dark.svg' } } : {}),
  }
  if (galaxy) {
    mkdirSync(resolve(dir, 'assets'), { recursive: true })
    for (const dark of [false, true]) {
      const background = dark ? '#080816' : '#f4f3fb'
      const glow = dark ? '#a58cff' : '#b6a5ed'
      const stars = Array.from({ length: 90 }, (_, i) => `<circle cx="${(i * 443 + 34) % 1600}" cy="${(i * 167 + 21) % 1000}" r="${i % 4 === 0 ? 1.8 : .8}" opacity="${i % 3 === 0 ? .7 : .25}"/>`).join('')
      writeFileSync(resolve(dir, `assets/nebula-${dark ? 'dark' : 'light'}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><defs><radialGradient id="violet"><stop stop-color="${glow}" stop-opacity=".4"/><stop offset="1" stop-color="${background}" stop-opacity="0"/></radialGradient><radialGradient id="blue"><stop stop-color="#70bbdc" stop-opacity=".18"/><stop offset="1" stop-color="${background}" stop-opacity="0"/></radialGradient></defs><rect width="1600" height="1000" fill="${background}"/><ellipse cx="1280" cy="320" rx="680" ry="600" fill="url(#violet)"/><ellipse cx="300" cy="900" rx="800" ry="660" fill="url(#blue)"/><g fill="${glow}">${stars}</g><path d="M1190 200L1280 150" stroke="${glow}" stroke-opacity=".3" stroke-width="2"/></svg>\n`)
    }
    Object.assign(manifest.colors, { background: 'rgba(244, 243, 251, .7)', navigator: 'rgba(234, 232, 246, .85)', paper: 'rgba(250, 249, 254, .9)', input: 'rgba(250, 249, 254, .94)' })
    Object.assign(manifest.colors.dark!, { background: 'rgba(8, 8, 22, .68)', navigator: 'rgba(15, 15, 36, .88)', paper: 'rgba(21, 21, 50, .86)', input: 'rgba(21, 21, 50, .94)' })
  }
  writeFileSync(resolve(dir, 'theme-pack.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(resolve(dir, 'tokenbird.css'), `/* Native adaptation: use the actual TokenBird surface hooks. */
body[data-tokenbird-${id}] {
  --message-user-bg: color-mix(in srgb, var(--accent) 12%, var(--paper));
  --message-tips-bg: var(--paper);
}
body[data-tokenbird-${id}] [data-theme-area="sidebar"] {
  background-color: var(--navigator);
  box-shadow: inset 2px 0 color-mix(in srgb, var(--accent) 30%, transparent);
}
body[data-tokenbird-${id}] .input-container {
  background-color: var(--input);
  border-radius: 14px;
}
`)
}
console.log('Completed Galaxy and VS Code native theme packs')
