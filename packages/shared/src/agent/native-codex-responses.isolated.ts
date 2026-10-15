import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveNativeCodexBinary } from '../codex/binary-resolver.ts';
import { createCodexBackend, createConfigFromConnection } from './backend/factory.ts';
import { tokenNestGroupHeaderValue } from '../utils/tokennest-headers.ts';
import { NativeCodexAgent } from './native-codex-agent.ts';
import type { BackendConfig } from './backend/types.ts';
import { getCredentialManager } from '../credentials/index.ts';
import { SecureStorageBackend } from '../credentials/backends/secure-storage.ts';
import { setSessionExecutionPolicy, clearSessionExecutionPolicy } from './core/session-execution-policy.ts';

const binary = resolveNativeCodexBinary({ useCache: false });

for (const authType of ['api_key_with_endpoint', 'oauth', 'none'] as const) {
  (binary ? test : test.skip)(`native Codex routes ${authType} Responses, host tools and utility queries to an isolated custom endpoint`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'tokenbird-codex-responses-'));
    const configDir = join(root, 'config'); mkdirSync(configDir);
    const previousConfig = process.env.TOKENBIRD_CONFIG_DIR;
    process.env.TOKENBIRD_CONFIG_DIR = configDir;
    const manager = getCredentialManager();
    const state = manager as unknown as Record<string, unknown>;
    const previousManager = Object.fromEntries(['backends', 'writeBackend', 'initialized', 'initPromise'].map(key => [key, state[key]]));
    const backend = new SecureStorageBackend(join(configDir, 'credentials.enc'));
    manager.configureBackend(backend);
    const slug = `responses-${authType}`;
    const id = { type: authType === 'oauth' ? 'llm_oauth' as const : 'llm_api_key' as const, connectionSlug: slug };
    if (authType !== 'none') await backend.set(id, { value: 'fixture-key-one', ...(authType === 'oauth' ? {} : { expiresAt: Date.now() + 3600000 }) });
    const requests: Array<{ path: string; authorization: string | null; group: string | null; body: Record<string, unknown> }> = [];
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      const entry = { path: new URL(request.url).pathname, authorization: request.headers.get('Authorization'),
        group: request.headers.get('X-TokenNest-Group'), body: await request.json() as Record<string, unknown> };
      requests.push(entry);
      const index = requests.length;
      const item = index === 1
        ? { type: 'function_call', id: 'fc-1', call_id: 'read-1', name: 'tokenbird__Read', arguments: JSON.stringify({ file_path: join(root, 'input.txt') }) }
        : { type: 'message', id: `msg-${index}`, role: 'assistant', content: [{ type: 'output_text', text: 'Custom Responses finished.', annotations: [] }] };
      const response = { id: `resp-${index}`, object: 'response', status: 'completed', output: [item],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 } } };
      const events = [{ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item: { ...item, ...(item.type === 'function_call' ? { arguments: '' } : {}) } },
        { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response }];
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
    } });
    const sessionId = `custom-${authType}`;
    setSessionExecutionPolicy(sessionId, { nodeId: 'worker', role: 'worker', rootPath: root,
      readFiles: true, writeFiles: false, runPrograms: false, browser: false, allowSources: [], allowSubagents: false });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(root, 'input.txt'), 'Read through TokenBird');
    const baseConfig: BackendConfig = { provider: 'pi', providerType: 'pi_compat', agentRuntime: 'codex', authType,
      connectionSlug: slug, model: 'gpt-5.2-codex', isHeadless: true,
      runtime: { baseUrl: `${server.url}v1`, piAuthProvider: 'openai',
        customEndpoint: { api: authType === 'oauth' ? 'openai-completions' : 'openai-responses' },
        ...(authType === 'oauth' ? { oauthProvider: 'tokennest' } : {}), customHeaders: { 'X-TokenNest-Group': 'fixture-group' } },
      workspace: { id: 'test', name: 'Test', slug: 'test', rootPath: root, createdAt: 1 },
      session: { id: sessionId, workspaceRootPath: root, workingDirectory: root, createdAt: 1, lastUsedAt: 1, permissionMode: 'allow-all' },
    };
    const config = authType === 'oauth' ? createConfigFromConnection({ slug, name: 'TokenNest', providerType: 'pi_compat', agentRuntime: 'codex',
      authType, piAuthProvider: 'openai', oauthProvider: 'tokennest', baseUrl: `${server.url}v1`,
      customEndpoint: { api: 'openai-completions' }, channelGroup: '中文分组', createdAt: 1 }, baseConfig) : baseConfig;
    const agent = createCodexBackend(config, binary!) as NativeCodexAgent;
    const proxies = Object.fromEntries(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'].map(key => [key, process.env[key]]));
    Object.assign(process.env, { HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: '127.0.0.1,localhost,::1' });
    try {
      expect(agent).toBeInstanceOf(NativeCodexAgent);
      expect((await agent.postInit()).authInjected).toBe(true);
      const events = [];
      for await (const event of agent['chatImpl']('Read input.txt and finish.')) events.push(event);
      expect(events.filter(event => event.type === 'error' || event.type === 'typed_error')).toEqual([]);
      expect(events.some(event => event.type === 'tool_result' && !event.isError && event.result.includes('Read through TokenBird'))).toBe(true);
      expect(events.some(event => event.type === 'text_complete' && event.text.includes('Custom Responses'))).toBe(true);
      expect(requests).toHaveLength(2);
      if (authType !== 'none') await backend.set(id, { value: 'fixture-key-two', ...(authType === 'oauth' ? {} : { expiresAt: Date.now() + 3600000 }) });
      const nextEvents = [];
      for await (const event of agent['chatImpl']('Finish another turn.')) nextEvents.push(event);
      expect(nextEvents.filter(event => event.type === 'error' || event.type === 'typed_error')).toEqual([]);
      expect(requests).toHaveLength(3);
      expect((await agent.queryLlm({ prompt: 'Finish a utility query.' })).text).toContain('Custom Responses');
      expect(requests).toHaveLength(4);
      const expectedGroup = authType === 'oauth' ? tokenNestGroupHeaderValue('中文分组') : 'fixture-group';
      expect(requests.every(entry => entry.path === '/v1/responses' && entry.group === expectedGroup)).toBe(true);
      expect(requests.slice(0, 2).map(entry => entry.authorization)).toEqual(Array(2).fill(authType === 'none' ? null : 'Bearer fixture-key-one'));
      expect(requests.slice(2).map(entry => entry.authorization)).toEqual(Array(2).fill(authType === 'none' ? null : 'Bearer fixture-key-two'));
      // No key or global OpenAI login is written to this controlled Codex home.
      const env = await agent['buildCodexEnvironment']();
      expect(existsSync(join(env!.CODEX_HOME!, 'auth.json'))).toBe(false);
      expect(readFileSync(join(env!.CODEX_HOME!, 'config.toml'), 'utf8')).not.toContain('fixture-key');
      if (authType !== 'none') {
        await backend.delete(id);
        const denied = [];
        for await (const event of agent['chatImpl']('Do not send without credentials.')) denied.push(event);
        expect(denied.some(event => event.type === 'typed_error' && event.error.code === (authType === 'oauth' ? 'expired_oauth_token' : 'invalid_credentials'))).toBe(true);
        expect(requests).toHaveLength(4);
      }
    } finally {
      await agent.disposeForRestart(); clearSessionExecutionPolicy(sessionId); server.stop(true);
      Object.assign(manager, previousManager);
      if (previousConfig === undefined) delete process.env.TOKENBIRD_CONFIG_DIR; else process.env.TOKENBIRD_CONFIG_DIR = previousConfig;
      for (const [key, value] of Object.entries(proxies)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await rm(root, { recursive: true, force: true });
    }
  }, 45000);
}
