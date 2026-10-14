import { describe, expect, it } from 'bun:test';
import { NativeCodexAppServerClient } from './native-app-server-client.ts';
import { Writable } from 'node:stream';

describe('NativeCodexAppServerClient routing', () => {
  it('rejects failed writes promptly and allows later requests to be written', async () => {
    const client = new NativeCodexAppServerClient({ codexPath: 'unused', workDir: process.cwd() });
    const internal = client as unknown as { child: unknown; pending: Map<string, unknown> };
    const failed = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('broken pipe')); } });
    failed.on('error', () => undefined);
    internal.child = { stdin: failed };
    await expect(client.request('thread/start', {})).rejects.toThrow('broken pipe');
    expect(internal.pending.size).toBe(0);
    internal.child = { stdin: new Writable({ write(chunk, _encoding, callback) {
      const request = JSON.parse(String(chunk));
      client.routeIncomingForTest({ jsonrpc: '2.0', id: request.id, result: { ok: true } });
      callback();
    } }) };
    expect(await client.request<{ ok: boolean }>('thread/start', {})).toEqual({ ok: true });
    expect(internal.pending.size).toBe(0);
  });

  it('routes notifications and server requests separately', () => {
    const client = new NativeCodexAppServerClient({ codexPath: 'unused', workDir: process.cwd() });
    const notifications: Array<[string, unknown]> = [];
    const requests: Array<{ id: string | number; method: string; params: unknown }> = [];
    client.on('notification', (method, params) => notifications.push([method, params]));
    client.on('serverRequest', request => requests.push(request));

    client.routeIncomingForTest({ jsonrpc: '2.0', method: 'turn/started', params: { threadId: 't1' } });
    client.routeIncomingForTest({ jsonrpc: '2.0', id: '7', method: 'item/tool/call', params: { tool: 'demo' } });

    expect(notifications).toEqual([['turn/started', { threadId: 't1' }]]);
    expect(requests).toEqual([{ id: '7', method: 'item/tool/call', params: { tool: 'demo' } }]);
  });
});
