import { dirname, join, resolve } from 'node:path'
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { headlessRuntimePlugin } from '../../../packages/pi-agent-server/build/headless-runtime.ts'

/** Android owns clipboard access through WebView; Pi's desktop native loader
 * must never run here. Bun Android can spin while resolving its absent addon
 * before the JSONL server even starts listening for the init message. */
const outdir = process.argv[2]
if (!outdir) throw new Error('Usage: bun build-pi-runtime.ts <output-directory>')
const runtime = headlessRuntimePlugin()

const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, '../../../packages/pi-agent-server/src/index.ts')],
  outdir: resolve(outdir),
  target: 'bun',
  format: 'esm',
  splitting: true,
  naming: { entry: 'index.js', chunk: 'chunks/[name]-[hash].[ext]' },
  // Jiti loads its Babel compiler lazily. Inlining that compiler into the
  // startup module would include a compiler that ordinary chat never uses.
  external: ['koffi', '@anthropic-ai/claude-agent-sdk', 'jiti'],
  plugins: [runtime.plugin],
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
runtime.assertApplied()
const sdkEntry = Bun.resolveSync('@earendil-works/pi-coding-agent', import.meta.dir)
let jitiRoot = dirname(Bun.resolveSync('jiti', dirname(sdkEntry)))
while (!existsSync(join(jitiRoot, 'package.json'))
  || JSON.parse(readFileSync(join(jitiRoot, 'package.json'), 'utf8')).name !== 'jiti') {
  const parent = dirname(jitiRoot)
  if (parent === jitiRoot) throw new Error('Cannot find the Pi SDK Jiti package')
  jitiRoot = parent
}
const jitiDest = join(resolve(outdir), 'node_modules/jiti')
mkdirSync(dirname(jitiDest), { recursive: true })
cpSync(jitiRoot, jitiDest, { recursive: true })
console.log(`Built Android Pi runtime (${result.outputs.length} files)`)
