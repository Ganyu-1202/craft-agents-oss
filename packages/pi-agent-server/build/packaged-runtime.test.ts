import { expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { headlessRuntimePlugin } from './headless-runtime.ts';
import { tokenNestGroupHeaderValue } from '../../shared/src/utils/tokennest-headers.ts';

it('keeps a Chinese group through packaged Pi JSONL initialization and streaming inference', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-packaged-group-'));
  const group = '大肥鱼清仓大甩卖';
  let received = '';
  const server = createServer((req, res) => {
    received = Buffer.from(String(req.headers['x-tokennest-group']), 'latin1').toString('utf8');
    req.resume();
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: {"id":"test","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const runtime = headlessRuntimePlugin();
    const build = await Bun.build({
      entrypoints: [resolve(import.meta.dir, '../src/index.ts')],
      outdir: dir, target: 'bun', format: 'esm', external: ['koffi'], plugins: [runtime.plugin],
    });
    expect(build.success).toBe(true);
    runtime.assertApplied();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    child = spawn(process.execPath, ['--no-install', join(dir, 'index.js')], {
      cwd: dir, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '', NO_PROXY: '127.0.0.1,localhost' },
    });
    const processChild = child;
    const errors: string[] = [];
    let finished = false;
    let reply = '';
    let stderr = '';
    processChild.stderr!.on('data', data => { stderr = (stderr + data).slice(-4096); });
    const send = (message: unknown) => processChild.stdin!.write(JSON.stringify(message) + '\n');
    const exit = new Promise<number | null>((resolve, reject) => {
      processChild.once('error', reject);
      processChild.once('exit', resolve);
    });
    const lines = createInterface({ input: processChild.stdout! });
    lines.on('line', line => {
      const message = JSON.parse(line);
      if (message.type === 'ready') send({ type: 'prompt', id: 'test', message: 'hello', systemPrompt: 'Reply ok' });
      if (message.type === 'error') errors.push(message.message);
      if (message.type === 'event' && message.event.type === 'agent_end') {
        finished = true;
        for (const item of message.event.messages ?? []) {
          if (item.errorMessage) errors.push(item.errorMessage);
          if (item.role === 'assistant') reply = item.content.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('');
        }
        send({ type: 'shutdown' });
      }
    });
    send({
      type: 'init', apiKey: 'local-test', model: 'gpt-4o',
      piAuth: { provider: 'openai', credential: { type: 'api_key', key: 'local-test' } },
      cwd: dir, workspaceRootPath: dir, sessionId: 'probe', sessionPath: join(dir, 'session'),
      workingDirectory: dir, plansFolderPath: dir, interactionOnly: true, browserToolOnly: true,
      baseUrl: `http://127.0.0.1:${address.port}/v1`, customEndpoint: { api: 'openai-completions' },
      customModels: ['gpt-4o'], customHeaders: { 'X-TokenNest-Group': tokenNestGroupHeaderValue(group) },
    });
    const timer = setTimeout(() => processChild.kill(), 20_000);
    try {
      expect(await exit).toBe(0);
      expect(errors).toEqual([]);
      expect(finished, stderr).toBe(true);
      expect(reply).toBe('ok');
      expect(received).toBe(group);
    } finally { clearTimeout(timer); lines.close(); }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
