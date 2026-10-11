import { resolve } from 'node:path';
import { headlessRuntimePlugin } from './build/headless-runtime.ts';

const runtime = headlessRuntimePlugin();
const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, 'src/index.ts')],
  outdir: resolve(import.meta.dir, 'dist'),
  target: 'bun',
  format: 'esm',
  external: ['koffi'],
  plugins: [runtime.plugin],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
runtime.assertApplied();
console.log('Built headless Pi agent server');
