import { describe, expect, it } from 'bun:test';
import { customCodexTransport, CODEX_CUSTOM_API_KEY_ENV } from './custom-transport.ts';
import { nativeCodexTransportCompatible } from '../agent-plugins/frameworks.ts';

describe('native Codex Responses routing', () => {
  it('keeps secrets out of configuration and targets the exact provider URL', () => {
    const result = customCodexTransport({ baseUrl: 'https://gateway.example/v1/responses/', customHeaders: { 'X-TokenNest-Group': 'group', 'X-Private': 'header-secret' } }, 'key-secret')!;
    expect(result.env[CODEX_CUSTOM_API_KEY_ENV]).toBe('key-secret');
    expect(result.configArgs.join(' ')).toContain('base_url="https://gateway.example/v1"');
    expect(result.configArgs.join(' ')).not.toContain('key-secret');
    expect(result.configArgs.join(' ')).not.toContain('header-secret');
    expect(result.env.OPENAI_API_KEY).toBe('');
    expect(result.configArgs.join(' ')).toContain('requires_openai_auth=false');
  });
  it('requires a Responses protocol and keeps ChatGPT OAuth off third-party endpoints', () => {
    const base = { baseUrl: 'https://gateway.example/v1', authType: 'api_key' as const };
    expect(nativeCodexTransportCompatible({ ...base, customEndpoint: { api: 'openai-responses' } })).toBe(true);
    expect(nativeCodexTransportCompatible({ ...base, customEndpoint: { api: 'openai-completions' } })).toBe(false);
    expect(nativeCodexTransportCompatible({ ...base, customEndpoint: { api: 'openai-responses' }, authType: 'oauth' })).toBe(false);
    expect(nativeCodexTransportCompatible({ ...base, customEndpoint: { api: 'openai-completions' }, authType: 'oauth', oauthProvider: 'tokennest' })).toBe(true);
  });
  it('rejects credentials embedded in URLs and reserved headers', () => {
    expect(() => customCodexTransport({ baseUrl: 'https://secret@gateway.example/v1' })).toThrow('without credentials');
    expect(() => customCodexTransport({ baseUrl: 'file:///tmp/provider' })).toThrow('HTTP(S)');
    expect(() => customCodexTransport({ baseUrl: 'https://gateway.example/v1', customHeaders: { Authorization: 'secret' } })).toThrow('reserved');
  });
});
