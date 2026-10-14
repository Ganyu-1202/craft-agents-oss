/** Declarative Cubism 3/4 model resources. Older clients ignore this optional field. */
export interface ThemePackLive2D {
  model: string
  position?: 'left' | 'right'
  width?: number
  height?: number
}

export type Live2DAssetReader = (path: string) => Promise<{ dataUrl: string } | null | undefined>

/** Resolve only pack-local references. Model JSON is never allowed to initiate network requests. */
export function resolveLive2DPath(modelPath: string, reference: string): string {
  if (!reference || /[\\:#?\u0000-\u001f]/.test(reference) || reference.startsWith('/') || reference.includes('%')) {
    throw new Error('Live2D resources must be local pack files')
  }
  const parts = [...modelPath.split('/').slice(0, -1), ...reference.split('/')]
  const result: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') throw new Error('Live2D parent paths are not supported')
    result.push(part)
  }
  return result.join('/')
}

/** Convert every supported model dependency to a data URL before entering the isolated renderer. */
export async function prepareLive2DModel(modelPath: string, read: Live2DAssetReader): Promise<Record<string, unknown>> {
  const safeModel = resolveLive2DPath('', modelPath)
  if (!safeModel.endsWith('.model3.json')) throw new Error('Expected a Cubism model3.json file')
  let totalBytes = 0
  const cache = new Map<string, Promise<string>>()
  const asset = (reference: string, extension: RegExp): Promise<string> => {
    const path = resolveLive2DPath(safeModel, reference)
    if (!extension.test(path)) throw new Error('Unsupported Live2D resource type')
    let pending = cache.get(path)
    if (!pending) {
      pending = read(path).then(value => {
        const url = value?.dataUrl
        if (!url || !/^data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+$/.test(url)) throw new Error(`Missing Live2D asset: ${path}`)
        totalBytes += url.length
        if (totalBytes > 32 * 1024 * 1024) throw new Error('Live2D model exceeds resource budget')
        return url
      })
      cache.set(path, pending)
    }
    return pending
  }
  const modelAsset = await read(safeModel)
  if (!modelAsset?.dataUrl || modelAsset.dataUrl.length > 1024 * 1024) throw new Error('Missing or oversized Live2D manifest')
  const encoded = modelAsset.dataUrl.split(',')[1]
  if (!encoded) throw new Error('Invalid Live2D manifest encoding')
  const model = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))))
  if (model.Version !== 3 || !model.FileReferences || typeof model.FileReferences.Moc !== 'string') throw new Error('Unsupported Live2D manifest')
  const input = model.FileReferences
  if (!Array.isArray(input.Textures) || input.Textures.length < 1 || input.Textures.length > 8) throw new Error('Invalid Live2D textures')
  // Reconstruct the file-reference object; unknown vendor fields cannot load external resources.
  const refs: Record<string, unknown> = {
    Moc: await asset(input.Moc, /\.moc3$/),
    Textures: await Promise.all(input.Textures.map((p: string) => asset(p, /\.(png|webp|jpe?g)$/))),
  }
  for (const key of ['Physics', 'Pose', 'DisplayInfo']) {
    if (input[key]) refs[key] = await asset(input[key], /\.json$/)
  }
  if (input.Expressions) {
    if (!Array.isArray(input.Expressions) || input.Expressions.length > 64) throw new Error('Too many Live2D expressions')
    refs.Expressions = await Promise.all(input.Expressions.map(async (e: { Name: string; File: string }) => ({Name: String(e.Name), File: await asset(e.File, /\.exp3\.json$/)})))
  }
  if (input.Motions) {
    if (typeof input.Motions !== 'object' || Array.isArray(input.Motions)) throw new Error('Invalid Live2D motions')
    const groups = Object.entries(input.Motions) as [string, {File: string; FadeInTime?: number; FadeOutTime?: number}[]][]
    if (groups.length > 32 || groups.reduce((n, [, motions]) => n + (Array.isArray(motions) ? motions.length : 1000), 0) > 64) throw new Error('Too many Live2D motions')
    refs.Motions = Object.fromEntries(await Promise.all(groups.map(async ([name, motions]) => [name, await Promise.all(motions.map(async motion => ({
      File: await asset(motion.File, /\.motion3\.json$/),
      ...(Number.isFinite(motion.FadeInTime) ? {FadeInTime: motion.FadeInTime} : {}),
      ...(Number.isFinite(motion.FadeOutTime) ? {FadeOutTime: motion.FadeOutTime} : {}),
    })))])))
  }
  return {Version: 3, url: 'data:application/json,{}', FileReferences: refs, Groups: model.Groups ?? [], HitAreas: model.HitAreas ?? []}
}
