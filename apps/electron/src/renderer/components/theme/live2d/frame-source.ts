import core from './live2dcubismcore.min.js?raw'
import pixi from './pixi.min.js?raw'
import cubism from './cubism4.min.js?raw'
import player from './player.js?raw'

export function createLive2DFrame(model: Record<string, unknown>): string {
  const script = (value: string) => `<script>${value.replace(/<\/script/gi, '<\\/script')}</script>`
  const data = JSON.stringify(model).replace(/</g, '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; connect-src data: blob:; worker-src blob:"><style>html,body{margin:0;overflow:hidden;background:transparent}canvas{display:block;width:100vw;height:100vh}</style></head><body><canvas></canvas><script type="application/json" id="model-data">${data}</script>${script(core)}${script(pixi)}${script(cubism)}${script(player)}</body></html>`
}
