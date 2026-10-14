import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'tokenbird-native-codex-policy-'));
mkdirSync(join(root, 'codex-home'));
const previousConfig = process.env.TOKENBIRD_CONFIG_DIR;
process.env.TOKENBIRD_CONFIG_DIR = join(root, 'config');
mkdirSync(process.env.TOKENBIRD_CONFIG_DIR, { recursive: true });
const { NativeCodexAgent } = await import('./native-codex-agent.ts');
const { AbortReason } = await import('./backend/types.ts');
const { NativeCodexAppServerClient } = await import('../codex/native-app-server-client.ts');
const { resolveNativeCodexBinary } = await import('../codex/binary-resolver.ts');
const { codexHostExecutionArgs } = await import('../codex/host-execution.ts');
const { setSessionExecutionPolicy, clearSessionExecutionPolicy, setSessionPolicyPermissionHandler,
  setSessionOperationRecorder } = await import('./core/session-execution-policy.ts');
const binary = resolveNativeCodexBinary({ useCache: false });
afterAll(() => {
  if (previousConfig === undefined) delete process.env.TOKENBIRD_CONFIG_DIR;
  else process.env.TOKENBIRD_CONFIG_DIR = previousConfig;
});

// Real installed app-server + local deterministic Responses endpoint. No provider credentials or internet.
(binary ? test : test.skip)('native Codex executes gated host tools without exposing native filesystem or shell tools', async () => {
  const requests: Array<{ tools?: Array<{ type: string; name?: string; tools?: Array<{ name: string }> }> }> = [];
  const approvals: string[] = [];
  const operations: string[] = [];
  const sessionId = 'native-codex-policy';
  const work = join(root, 'workspace'); mkdirSync(work);
  const written = join(work, 'result.txt');
  const inheritedMcpMarker = join(root, 'inherited-mcp-started.txt');
  const inheritedScript = `require('node:fs').writeFileSync(${JSON.stringify(inheritedMcpMarker)}, 'must not start'); setInterval(() => {}, 1000)`;
  writeFileSync(join(root, 'codex-home', 'config.toml'), `[mcp_servers.inherited]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ["-e", ${JSON.stringify(inheritedScript)}]\n`);
  mkdirSync(join(work, '.codex'));
  writeFileSync(join(work, '.codex', 'config.toml'), readFileSync(join(root, 'codex-home', 'config.toml')));
  writeFileSync(join(root, 'codex-home', 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'local-fixture-only' }));
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (!new URL(request.url).pathname.endsWith('/responses')) return new Response('{}', { status: 404 });
    requests.push(await request.json() as (typeof requests)[number]);
    const index = requests.length;
    const item = index === 1
      ? { type: 'function_call', id: 'fc-1', call_id: 'write-1', name: 'tokenbird__Write', arguments: JSON.stringify({ file_path: written, content: 'native loop, approved host write' }) }
      : index === 2
        ? { type: 'function_call', id: 'fc-2', call_id: 'write-2', name: 'tokenbird__Write', arguments: JSON.stringify({ file_path: join(root, 'outside.txt'), content: 'must be denied' }) }
        : { type: 'message', id: 'msg-1', role: 'assistant', content: [{ type: 'output_text', text: 'Finished native execution.', annotations: [] }] };
    const response = { id: `resp-${index}`, object: 'response', status: 'completed', output: [item],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 } } };
    const events = [
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, ...(item.type === 'function_call' ? { arguments: '' } : {}) } },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response },
    ];
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
      { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  setSessionExecutionPolicy(sessionId, { nodeId: 'worker', role: 'worker', rootPath: work,
    readFiles: true, writeFiles: true, runPrograms: false, browser: false, allowSources: [], allowSubagents: false, actionGates: true });
  setSessionPolicyPermissionHandler(sessionId, async request => { approvals.push(request.scope.target); return request.scope.target === written; });
  setSessionOperationRecorder(sessionId, async request => { operations.push(request.invocationId); });
  const agent = new NativeCodexAgent({ provider: 'pi', providerType: 'pi', agentRuntime: 'codex', authType: 'none',
    model: 'gpt-5.2-codex', isHeadless: true,
    workspace: { id: 'test', name: 'Test', slug: 'test', rootPath: work, createdAt: 1 },
    session: { id: sessionId, workspaceRootPath: work, workingDirectory: work, createdAt: 1, lastUsedAt: 1, permissionMode: 'allow-all' } }, binary!);
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = join(root, 'codex-home');
  let env: Record<string, string> | undefined;
  try { env = await agent['buildCodexEnvironment'](); }
  finally {
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
  }
  expect(env!.CODEX_HOME).not.toBe(join(root, 'codex-home'));
  expect(JSON.parse(readFileSync(join(env!.CODEX_HOME!, 'auth.json'), 'utf8')).OPENAI_API_KEY).toBe('local-fixture-only');
  const client = new NativeCodexAppServerClient({ codexPath: binary!.path, workDir: env!.CODEX_HOME!, requestTimeoutMs: 10_000,
    // This fixture serves only localhost; inherited proxies must not reroute its requests.
    env: { ...env, HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: '127.0.0.1,localhost,::1' }, configArgs: [...codexHostExecutionArgs(),
      '-c', 'model_provider="fixture"', '-c', `model_providers.fixture={name="fixture",base_url="${server.url}v1",wire_api="responses",requires_openai_auth=false}`,
      '-c', 'features.enable_request_compression=false',
    ] });
  try {
    await client.connect();
    agent['client'] = client; agent['clientHostExecution'] = true; agent['authenticated'] = true;
    client.on('notification', (method, params) => agent['handleNotification'](method, params));
    client.on('serverRequest', request => { void agent['handleServerRequest'](client, request); });
    const events = [];
    const timeout = setTimeout(() => agent.forceAbort(AbortReason.UserStop), 25_000);
    try { for await (const event of agent['chatImpl']('Execute the fixture task.')) events.push(event); }
    finally { clearTimeout(timeout); }
    expect(events.filter(event => event.type === 'error' || event.type === 'typed_error')).toEqual([]);
    expect(events.some(event => event.type === 'text_complete' && event.text.includes('Finished'))).toBe(true);
    expect(requests).toHaveLength(3);
    const names = requests.flatMap(request => request.tools?.flatMap(tool => tool.type === 'namespace' ? tool.tools?.map(child => child.name) ?? [] : [tool.name ?? tool.type]) ?? []);
    expect(names).toContain('tokenbird__Write');
    for (const forbidden of ['exec_command', 'write_stdin', 'shell', 'shell_command', 'apply_patch', 'view_image', 'web_search', 'spawn_agent']) expect(names).not.toContain(forbidden);
    expect(readFileSync(written, 'utf8')).toBe('native loop, approved host write');
    expect(existsSync(join(root, 'outside.txt'))).toBe(false);
    expect(existsSync(inheritedMcpMarker)).toBe(false);
    expect(approvals).toContain(written);
    expect(operations).toEqual(['codex-write-1']);
  } finally {
    await agent.disposeForRestart(); server.stop(true); clearSessionExecutionPolicy(sessionId);
  }
}, 40_000);
