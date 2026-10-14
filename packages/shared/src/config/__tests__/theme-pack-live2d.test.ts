import { describe, expect, it } from 'bun:test'
import { prepareLive2DModel, resolveLive2DPath } from '../theme-pack-live2d'

const encoded = (value: unknown) => ({dataUrl: `data:application/json;base64,${Buffer.from(JSON.stringify(value)).toString('base64')}`})
const basic = {Version: 3, FileReferences: {Moc: 'body.moc3', Textures: ['body.png']}}

describe('native Live2D pack resource boundary', () => {
  it('accepts local nested Unicode names and rejects network, traversal and encoded references', () => {
    expect(resolveLive2DPath('model/main.model3.json', '动作/待机.motion3.json')).toBe('model/动作/待机.motion3.json')
    for (const value of ['../secret', 'https://host/a.png', 'data:image/png;base64,a', '/etc/passwd', 'C:\\a', '%2e%2e/a', 'a?b', 'a#b']) {
      expect(() => resolveLive2DPath('model/main.model3.json', value)).toThrow()
    }
  })

  it('preloads all model resources as data and strips unsupported external references and sound', async () => {
    const calls: string[] = []
    const model = {...basic, FileReferences: {...basic.FileReferences, Unknown: 'https://evil.test/', Motions: {idle: [{File: 'idle.motion3.json', Sound: 'https://evil.test/sound.mp3'}]}}}
    const prepared = await prepareLive2DModel('model/main.model3.json', async path => {
      calls.push(path)
      return path.endsWith('model3.json') ? encoded(model) : {dataUrl: 'data:application/octet-stream;base64,AA=='}
    })
    expect(calls.sort()).toEqual(['model/main.model3.json', 'model/body.moc3', 'model/body.png', 'model/idle.motion3.json'].sort())
    expect(JSON.stringify(prepared)).not.toContain('evil.test')
    expect(JSON.stringify(prepared)).not.toContain('Sound')
    expect((prepared.FileReferences as any).Moc).toStartWith('data:')
  })

  it('rejects missing and oversized dependencies so the renderer can fall back', async () => {
    await expect(prepareLive2DModel('main.model3.json', async path => path.endsWith('model3.json') ? encoded(basic) : null)).rejects.toThrow('Missing')
    await expect(prepareLive2DModel('main.model3.json', async path => path.endsWith('model3.json') ? encoded(basic) : {dataUrl: 'data:image/png;base64,' + 'A'.repeat(33 * 1024 * 1024)})).rejects.toThrow('budget')
  })

  it('rejects external textures, malformed and excessive motion groups', async () => {
    for (const changes of [{Textures: ['https://evil.test/t.png']}, {Motions: []}, {Motions: {idle: Array.from({length: 65}, () => ({File: 'idle.motion3.json'}))}}]) {
      await expect(prepareLive2DModel('main.model3.json', async path => path.endsWith('model3.json') ? encoded({...basic, FileReferences: {...basic.FileReferences, ...changes}}) : {dataUrl: 'data:image/png;base64,AA=='})).rejects.toThrow()
    }
  })
})
