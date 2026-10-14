import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { headlessRuntimePlugin } from '../packages/pi-agent-server/build/headless-runtime';

const root = resolve(import.meta.dir, '..');
const directory = await mkdtemp(join(tmpdir(), 'tokenbird-packaged-images-'));
try {
  const bitmap = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#937acf' } }).png().toBuffer();
  await writeFile(join(directory, 'source.png'), bitmap);
  await writeFile(join(directory, 'entry.ts'), `
import fs from 'node:fs';
import { ContextImageReducer } from ${JSON.stringify(join(root, 'packages/pi-agent-server/src/context-images.ts'))};
const read = fs.readFileSync.bind(fs);
fs.readFileSync = ((path, ...options) => {
  if (String(path).endsWith('photon_rs_bg.wasm')) {
    const error = new Error('No external image runtime assets in an installed bundle'); error.code = 'ENOENT'; throw error;
  }
  return read(path, ...options);
});
const image = { type: 'image', mimeType: 'image/png', data: read(new URL('./source.png', import.meta.url)).toString('base64') };
const messages = ['old', 'previous', 'current'].map(text => ({role: 'user', timestamp: 1, content: [{type: 'text', text}, image]}));
const result = await new ContextImageReducer().reduce(messages, {pressure: 0.7});
const reduced = result[0].content[1];
if (reduced.data === image.data) throw new Error('Packaged reducer did not resize historical pixels');
if (result[1].content[1].data !== image.data || result[2].content[1].data !== image.data) throw new Error('Recent images changed');
console.log(JSON.stringify({passed: true, originalBytes: Buffer.from(image.data, 'base64').length, reducedBytes: Buffer.from(reduced.data, 'base64').length}));
`);
  const runtime = headlessRuntimePlugin();
  const build = await Bun.build({ entrypoints: [join(directory, 'entry.ts')], outdir: directory,
    target: 'bun', format: 'esm', plugins: [runtime.plugin], external: ['koffi'] });
  if (!build.success) throw new AggregateError(build.logs, 'Failed to build isolated image runtime');
  runtime.assertApplied();
  const child = Bun.spawn([process.execPath, join(directory, 'entry.js')], { cwd: directory, stdout: 'pipe', stderr: 'pipe' });
  const timeout = setTimeout(() => child.kill(), 30_000);
  const [code, output, errors] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]).finally(() => clearTimeout(timeout));
  if (errors) process.stderr.write(errors);
  if (code !== 0) throw new Error(`Isolated image runtime exited with ${code}`);
  console.log(output.trim());
} finally { await rm(directory, { recursive: true, force: true }); }
