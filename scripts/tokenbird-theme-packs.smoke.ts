/** Real Chromium rendering of ThemeProvider + production CSS, isolated profile. */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build, loadConfigFromFile } from 'vite'
import * as esbuild from 'esbuild'
import { loadThemePack, readThemePackAsset } from '../packages/shared/src/config/theme-pack'

const root = mkdtempSync(join(tmpdir(), 'tokenbird-theme-packs-'))
const rendererRoot = resolve(import.meta.dir, '../apps/electron/src/renderer')
const fixture = mkdtempSync(join(rendererRoot, '.tmp-theme-pack-smoke-'))
const packIds = ['miku-mint', 'miku-sakura', 'teto-crimson', 'miku-teto-duet', 'style-galaxy', 'vscode-plus']
const packs = packIds.map(id => loadThemePack(id)!)
const presetDir = resolve(import.meta.dir, '../apps/electron/resources/themes')
const presets = readdirSync(presetDir).filter(file => file.endsWith('.json')).map(file => ({ id: file.replace('.json', ''), path: resolve(presetDir, file), theme: JSON.parse(readFileSync(resolve(presetDir, file), 'utf8')) }))
// Freeze the existing Haze background locally; the renderer check is offline.
const haze = presets.find(preset => preset.id === 'haze')!
haze.theme.backgroundImage = `data:image/webp;base64,${readFileSync(resolve(presetDir, 'haze-background.webp')).toString('base64')}`
assert.ok(packs.every(Boolean))
const assets: Record<string, unknown> = {}
for (const pack of packs) {
  const refs = [...Object.values(pack.manifest.background ?? {}), ...Object.values(pack.manifest.preview ?? {}), ...Object.values(pack.manifest.characters ?? {})]
  for (const ref of refs) assets[`${pack.id}/${ref}`] = readThemePackAsset(pack.id, ref)
}
writeFileSync(join(fixture, 'fixtures.json'), JSON.stringify({ packs, assets, presets }))
writeFileSync(join(fixture, 'index.html'), '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="theme-pack-character-stage"></div><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>')
writeFileSync(join(fixture, 'entry.tsx'), `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider, useTheme} from '../context/ThemeContext';
import {ThemePresetGallery} from '../components/settings/ThemePresetGallery';
import {ThemePresentationSettings} from '../components/settings/ThemePresentationSettings';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import translations from '../../../../../packages/shared/src/i18n/locales/zh-Hans.json';
import '../index.css';
import data from './fixtures.json';
if (!sessionStorage.getItem('fixture-initialized')) {localStorage.clear();localStorage.setItem('tokenbird-chat-opacity', '0.72');sessionStorage.setItem('fixture-initialized','true');}
i18n.use(initReactI18next).init({lng:'zh-Hans',resources:{'zh-Hans':{translation:translations}},initImmediate:false});
let listener;
window.electronAPI = {
  getColorTheme: async () => 'default', getSelectedThemePack: async () => null,
  getThemePacks: async () => data.packs,
  loadPresetTheme: async id => data.presets.find(preset => preset.id === id) ?? null,
  getThemePack: async id => { await new Promise(r => setTimeout(r, id === 'miku-mint' ? 65 : 0)); return data.packs.find(p => p.id === id) ?? null; },
  setSelectedThemePack: async () => {}, onThemePackChange: cb => {listener = cb; return () => {listener = null}},
  getThemePackAsset: async (id, ref) => data.assets[id + '/' + ref] ?? null,
};
function Screen() {
  const theme = useTheme();
  window.fixture = {
    panelOpacity: theme.setChatPanelOpacity, bubbleOpacity: theme.setChatOpacity, select: theme.setThemePack, mode: theme.setMode, preset: theme.setColorTheme, presentation: theme.setPresentation, reset: theme.resetPresentation,
    color: value => {const span = document.createElement('span');span.style.color = value;document.body.appendChild(span);const result = getComputedStyle(span).color;span.remove();return result;},
    notify: id => listener?.({packId: id}),
    snapshot: () => ({panelOpacity: theme.chatPanelOpacity, bubbleOpacity: theme.chatOpacity, id: theme.themePackId, active: theme.activeThemePack?.id, preset: theme.effectiveColorTheme, presentation: theme.presentation, dark: theme.isDark, scenic: theme.isScenic, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), bg: document.documentElement.style.getPropertyValue('--background-image'), characters: [...document.querySelectorAll('#theme-pack-character-stage img')].map(img => ({width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height, loaded: img.complete && img.naturalWidth > 0})), shiki: theme.shikiTheme}),
    gallery: () => window.showGallery(true),
  };
  const [gallery, showGallery] = React.useState(false);
  window.showGallery = showGallery;
  if(gallery) return <div style={{padding:28,maxWidth:1000,margin:'auto',height:'100vh',overflowY:'auto',color:'var(--foreground)'}}><h1 style={{fontSize:24,fontWeight:600,marginBottom:24}}>外观 · 配色主题</h1><ThemePresetGallery themes={data.presets} selected={theme.themePackId?null:theme.colorTheme} dark={theme.isDark} onSelect={id=>{theme.setThemePack(null);theme.setColorTheme(id)}}/><ThemePresentationSettings/></div>;
  const compact = window.innerWidth <= 768;
  return <div style={{padding:compact?12:24, display:'grid', gridTemplateColumns:compact?'minmax(0,1fr)':'210px minmax(0,1fr)', gap:18, height:'100vh', color:'var(--foreground)'}}>
    <aside data-theme-area="sidebar" className="shadow-middle" style={{display:compact?'none':'block',borderRadius:18,padding:20,background:'var(--navigator)'}}>
      <h2 style={{fontSize:22,fontWeight:600}}>词元鸟</h2><p style={{opacity:.55,margin:'8px 0 30px'}}>TokenBird</p>
      {['新建会话','所有会话','标签','数据源','工具','技能','设置'].map((label,i)=><div key={label} style={{padding:'12px',margin:'4px 0',borderRadius:10,background:i===1?'color-mix(in srgb, var(--accent) 12%, transparent)':'transparent',color:i===1?'var(--accent)':'inherit'}}>{label}</div>)}
    </aside>
    <main data-panel-role="content" data-theme-area="chat" className="shadow-middle" style={{minWidth:0,borderRadius:18,padding:compact?16:26,display:'flex',flexDirection:'column',gap:20}}>
      <header style={{display:'flex',justifyContent:'space-between',borderBottom:'1px solid color-mix(in srgb,var(--foreground) 10%,transparent)',paddingBottom:16}}><strong>{theme.themePackName ?? '默认主题'}</strong><span style={{opacity:.5}}>创作工作台</span></header>
      <div style={{marginLeft:'auto',padding:'14px 22px',borderRadius:16,background:'var(--message-user-bg)'}}>一起创作下一段旋律吧。</div>
      <div className="theme-message-assistant-bubble" style={{padding:22,borderRadius:16,maxWidth:620}}><h3 style={{fontWeight:600,marginBottom:12}}>灵感，从这里开始</h3><p>青绿与绯红交织，让每一次对话都有自己的色彩。</p><p style={{opacity:.55,marginTop:12}}>明暗配色 · 自适应立绘 · 原创矢量背景</p></div>
      <div data-theme-area="chat" className="input-container shadow-middle" style={{padding:20,marginTop:'auto',height:128}}><p style={{opacity:.45}}>输入消息…</p><div style={{display:'flex',justifyContent:'flex-end',marginTop:26}}><button className="bg-primary" style={{borderRadius:12,padding:'8px 18px',color:'var(--popover-solid)'}}>发送</button></div></div>
    </main>
  </div>;
}
createRoot(document.getElementById('root')).render(<ThemeProvider defaultMode="light"><Screen/></ThemeProvider>);
`)
try {
  const config = await loadConfigFromFile({ command: 'build', mode: 'production' }, resolve(import.meta.dir, '../apps/electron/vite.config.ts'))
  assert.ok(config)
  await build({ ...config.config, configFile: false, root: fixture, publicDir: false, logLevel: 'warn',
    build: { outDir: join(root, 'renderer'), emptyOutDir: true, sourcemap: false, rollupOptions: { input: join(fixture, 'index.html') } },
  })
} finally {
  // fixture is created directly under the known renderer root by mkdtempSync.
  assert.equal(resolve(fixture, '..'), rendererRoot)
  rmSync(fixture, { recursive: true, force: true })
}
const report = join(root, 'result.json')
writeFileSync(join(root, 'main.ts'), `
import {app,BrowserWindow} from 'electron';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
app.setPath('userData', ${JSON.stringify(join(root, 'profile'))});
const errors = []; const checks = [];
app.whenReady().then(async () => {
  const win = new BrowserWindow({show:false,width:1400,height:900,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});
  win.webContents.on('console-message', (_event,level,message) => {if(level===3) errors.push(message)});
  const js = code => win.webContents.executeJavaScript(code);
  const wait = async condition => {for(let i=0;i<120;i++){if(await js(condition))return;await new Promise(r=>setTimeout(r,25));}throw new Error('Timed out: '+condition)};
  try {
    await win.loadFile(${JSON.stringify(join(root, 'renderer/index.html'))});
    await wait('!!window.fixture');
    // Existing combined opacity migrates to the independent panel control.
    await wait('fixture.snapshot().panelOpacity===0.72 && fixture.snapshot().bubbleOpacity===0.72');
    await js('fixture.bubbleOpacity(0.8)');
    await wait('fixture.snapshot().panelOpacity===0.72 && fixture.snapshot().bubbleOpacity===0.8');
    await Promise.all([new Promise(resolve => win.webContents.once('did-finish-load', resolve)), Promise.resolve(win.reload())]);
    await wait('!!window.fixture && fixture.snapshot().panelOpacity===0.72 && fixture.snapshot().bubbleOpacity===0.8');
    await js('fixture.panelOpacity(0.35)');
    await wait('fixture.snapshot().panelOpacity===0.35 && fixture.snapshot().bubbleOpacity===0.8');
    await Promise.all([new Promise(resolve => win.webContents.once('did-finish-load', resolve)), Promise.resolve(win.reload())]);
    await wait('!!window.fixture && fixture.snapshot().panelOpacity===0.35 && fixture.snapshot().bubbleOpacity===0.8');
    // A late response from an older selection must not replace the current pack.
    await js("fixture.select('miku-mint');fixture.select('teto-crimson')");
    await wait("fixture.snapshot().active==='teto-crimson' && fixture.snapshot().bg.includes('data:image')");
    await new Promise(r=>setTimeout(r,100));
    assert.equal((await js('fixture.snapshot()')).active,'teto-crimson');
    await js("fixture.select('miku-mint');fixture.bubbleOpacity(0.8)");
    await wait("fixture.snapshot().active==='miku-mint'");
    for (const mode of ['light', 'dark']) {
      await js('fixture.mode('+JSON.stringify(mode)+')');
      await wait('fixture.snapshot().dark==='+JSON.stringify(mode==='dark'));
      for (const opacity of [0, 0.35, 1]) {
        await js('fixture.panelOpacity('+opacity+')');
        await wait('getComputedStyle(document.documentElement).getPropertyValue("--tokenbird-chat-panel-opacity").trim()==='+JSON.stringify(opacity*100+'%'));
        const rendered = await js("(() => {const panel=document.querySelector('[data-panel-role=content]');const input=document.querySelector('.input-container');return {background:getComputedStyle(panel).backgroundColor,expected:fixture.color('color-mix(in srgb, var(--background) '+fixture.snapshot().panelOpacity*100+'%, transparent)'),texture:Number(getComputedStyle(panel,'::before').opacity),inputTexture:Number(getComputedStyle(input,'::before').opacity),textOpacity:getComputedStyle(panel.querySelector('header')).opacity,panelOpacity:getComputedStyle(panel).opacity,bubble:fixture.snapshot().bubbleOpacity}})()");
        assert.equal(rendered.background, rendered.expected);
        assert.ok(Math.abs(rendered.texture - opacity*0.9)<0.001, JSON.stringify(rendered));
        assert.ok(Math.abs(rendered.inputTexture - 0.8*0.9)<0.001);
        assert.equal(rendered.textOpacity, '1');
        assert.equal(rendered.panelOpacity, '1');
        assert.equal(rendered.bubble, 0.8);
      }
    }
    await js('fixture.panelOpacity(0.15);fixture.bubbleOpacity(0.8)');
    await wait('fixture.snapshot().panelOpacity===0.15');
    writeFileSync(${JSON.stringify(join(root, 'transparent-chat.png'))},(await win.webContents.capturePage()).toPNG());
    await js('fixture.panelOpacity(1);fixture.bubbleOpacity(1)');
    for (const pack of ${JSON.stringify(packs)}) {
      for (const mode of ['light','dark']) {
        await js('fixture.mode('+JSON.stringify(mode)+');fixture.select('+JSON.stringify(pack.id)+')');
        await wait('fixture.snapshot().active==='+JSON.stringify(pack.id)+' && fixture.snapshot().dark==='+JSON.stringify(mode==='dark'));
        const expectedAccent = mode==='dark' ? pack.manifest.colors.dark?.accent ?? pack.manifest.colors.accent : pack.manifest.colors.accent;
        const accent = await js('fixture.color('+JSON.stringify(expectedAccent)+')');
        await wait('fixture.snapshot().accent==='+JSON.stringify(accent));
        if(pack.manifest.background) await wait("fixture.snapshot().bg.includes('data:image')");
        if(pack.manifest.characters) await wait("fixture.snapshot().characters.length > 0 && fixture.snapshot().characters.every(c=>c.loaded)");
        const state = await js('fixture.snapshot()');
        assert.equal(state.id,pack.id); assert.equal(state.dark,mode==='dark'); assert.equal(state.accent,accent);
        assert.equal(await js("document.documentElement.classList.contains('"+mode+"')"),true);
        if(pack.source==='native') assert.equal(state.shiki,mode==='dark'?'github-dark':'github-light');
        // Verify the background's CSS specificity and older primary utilities.
        const palette = mode==='dark'?{...pack.manifest.colors,...pack.manifest.colors.dark}:pack.manifest.colors;
        assert.equal(await js("getComputedStyle(document.documentElement).getPropertyValue('--background').trim()"),await js('fixture.color('+JSON.stringify(palette.background)+')'));
        const primary = await js("getComputedStyle(document.querySelector('.bg-primary')).backgroundColor");
        assert.ok(primary!=='rgba(0, 0, 0, 0)' || await js("getComputedStyle(document.querySelector('.bg-primary')).backgroundImage!=='none'"));
        checks.push({pack:pack.id,mode,...state,primary});
        await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        await new Promise(r=>setTimeout(r,80));
        writeFileSync(${JSON.stringify(root)}+'/'+pack.id+'-'+mode+'.png',(await win.webContents.capturePage()).toPNG());
      }
    }
    await js('fixture.select(null)');
    for(const preset of ${JSON.stringify(presets.map(preset => ({...preset,theme:{...preset.theme,backgroundImage:preset.id==='haze'?'fixture':preset.theme.backgroundImage}})))}) {
      for(const mode of ['light','dark']) {
        const dark = preset.theme.supportedModes?.length===1 ? preset.theme.supportedModes[0]==='dark' : mode==='dark';
        const palette = dark ? {...preset.theme,...preset.theme.dark} : preset.theme;
        await js('fixture.mode('+JSON.stringify(mode)+');fixture.preset('+JSON.stringify(preset.id)+')');
        await wait('fixture.snapshot().preset==='+JSON.stringify(preset.id)+' && fixture.snapshot().dark==='+dark);
        const accent = await js('fixture.color('+JSON.stringify(palette.accent)+')');
        await wait('fixture.snapshot().accent==='+JSON.stringify(accent));
        assert.equal(await js("getComputedStyle(document.documentElement).getPropertyValue('--background').trim()"),await js('fixture.color('+JSON.stringify(palette.background)+')'));
        assert.equal(await js("getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()"),palette.paper);
        assert.equal((await js('fixture.snapshot()')).shiki,dark?preset.theme.shikiTheme.dark:preset.theme.shikiTheme.light);
        checks.push({preset:preset.id,mode,dark,accent});
      }
    }
    await js("fixture.preset('default');fixture.mode('light');fixture.select('miku-mint')");
    await wait("fixture.snapshot().active==='miku-mint'");
    await js('fixture.presentation({showCharacters:false,backgroundDim:0.45,glassBlur:12,characterScale:1.2})');
    await wait('fixture.snapshot().presentation.showCharacters===false');
    assert.equal(await js("getComputedStyle(document.getElementById('theme-pack-character-stage')).display"),'none');
    assert.equal(await js("getComputedStyle(document.documentElement).getPropertyValue('--theme-glass-blur').trim()"),'12px');
    await js("fixture.select('teto-crimson')");
    await wait("fixture.snapshot().active==='teto-crimson'");
    assert.equal((await js('fixture.snapshot()')).presentation.showCharacters,true);
    await js("fixture.select('miku-mint')");
    await wait("fixture.snapshot().active==='miku-mint'");
    assert.equal((await js('fixture.snapshot()')).presentation.showCharacters,false);
    await js('fixture.reset()');
    await wait('fixture.snapshot().presentation.showCharacters===true');
    win.setSize(480,780);
    await js("fixture.mode('light');fixture.select('miku-teto-duet')");
    await wait("fixture.snapshot().active==='miku-teto-duet' && fixture.snapshot().characters.length===2 && fixture.snapshot().characters.every(c=>c.loaded)");
    const compact = await js('fixture.snapshot()');
    assert.ok(compact.characters.every(c=>c.width<=480*.48+1 && c.height<=780*.62+1));
    writeFileSync(${JSON.stringify(join(root, 'compact.png'))},(await win.webContents.capturePage()).toPNG());
    await js('fixture.select(null)');
    await wait('!fixture.snapshot().active && !fixture.snapshot().bg');
    assert.equal(await js("document.body.hasAttribute('data-tokenbird-singer')"),false);
    assert.equal(await js("document.getElementById('tokenbird-theme-pack-css')===null"),true);
    assert.equal(await js("document.documentElement.hasAttribute('data-theme-pack')"),false);
    win.setSize(1100,1000);
    await js('fixture.gallery()');
    await wait("document.querySelectorAll('button[aria-pressed]').length===15");
    await js("[...document.querySelectorAll('button[aria-pressed]')].find(button=>button.textContent.includes('Nord')).click()");
    await wait("fixture.snapshot().preset==='nord'");
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    writeFileSync(${JSON.stringify(join(root, 'preset-gallery.png'))},(await win.webContents.capturePage()).toPNG());
    await js("fixture.select('miku-mint')");
    await wait("fixture.snapshot().active==='miku-mint'");
    await wait("document.querySelector('[role=switch]')!==null");
    await js("document.querySelector('[role=switch]').click()");
    await wait('fixture.snapshot().presentation.showCharacters===false');
    writeFileSync(${JSON.stringify(join(root, 'theme-controls.png'))},(await win.webContents.capturePage()).toPNG());
    assert.equal(errors.length,0,errors.join(' | '));
    writeFileSync(${JSON.stringify(report)},JSON.stringify({success:true,checks,compact,rapidSwitch:true,cleanup:true,preferences:true,gallery:true,controls:true,chatOpacity:true,errors},null,2));
    win.destroy();app.exit(0);
  } catch(error) {
    const snapshot = await js('window.fixture?.snapshot()').catch(()=>null);
    writeFileSync(${JSON.stringify(report)},JSON.stringify({success:false,error:String(error),stack:error.stack,snapshot,checks,errors},null,2));
    win.destroy();app.exit(1);
  }
});
`)
await esbuild.build({ entryPoints: [join(root, 'main.ts')], outfile: join(root, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], nodePaths: [resolve(import.meta.dir, '../node_modules')] })
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = Bun.spawn([resolve(import.meta.dir, '../node_modules/electron/dist/electron.exe'), join(root, 'main.cjs')], { env, stdout: 'pipe', stderr: 'pipe', windowsHide: true })
const timeout = setTimeout(() => child.kill(), 60_000)
const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
clearTimeout(timeout)
const result = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : { success: false, error: stderr }
console.log(JSON.stringify({ root, code, ...result, checks: result.checks?.map(({ bg, ...check }: any) => check) }, null, 2))
assert.equal(code, 0, result.error ?? stderr)
assert.equal(result.success, true)
