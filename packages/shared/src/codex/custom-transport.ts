import type { BackendRuntimePayload } from '../agent/backend/internal/driver-types.ts';

export const CODEX_CUSTOM_PROVIDER = 'tokenbird_responses';
export const CODEX_CUSTOM_API_KEY_ENV = 'TOKENBIRD_CODEX_UPSTREAM_KEY';

/** Credentials live in the child's environment, never command arguments or TOML files. */
export function customCodexTransport(runtime: BackendRuntimePayload, credential?: string): {
  env: Record<string, string>; configArgs: string[];
} | undefined {
  if (!runtime.baseUrl) return undefined;
  const url = new URL(runtime.baseUrl.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Codex Responses base URL must be an HTTP(S) URL without credentials, query parameters or a fragment.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/responses$/, '');
  const env: Record<string, string> = { OPENAI_API_KEY: '', CODEX_API_KEY: '', [CODEX_CUSTOM_API_KEY_ENV]: credential ?? '' };
  const configArgs = ['-c', `model_provider=${JSON.stringify(CODEX_CUSTOM_PROVIDER)}`,
    '-c', 'features.enable_request_compression=false',
    '-c', 'shell_environment_policy.exclude=["TOKENBIRD_CODEX_UPSTREAM_KEY","TOKENBIRD_CODEX_HEADER_*"]'];
  const provider: Record<string, string | boolean | Record<string, string>> = {
    name: 'TokenBird Responses', base_url: url.toString().replace(/\/$/, ''), wire_api: 'responses',
    requires_openai_auth: false,
    ...(credential ? { env_key: CODEX_CUSTOM_API_KEY_ENV } : {}),
  };
  const headers: Record<string, string> = {};
  for (const [index, [name, value]] of Object.entries(runtime.customHeaders ?? {}).entries()) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) {
      throw new Error('Codex Responses headers must use valid HTTP header names and single-line values.');
    }
    if (/^(authorization|proxy-authorization|host|content-length)$/i.test(name)) {
      throw new Error(`Codex Responses header is reserved: ${name}`);
    }
    const key = `TOKENBIRD_CODEX_HEADER_${index}`;
    // Pi stores TokenNest headers as ByteString text for fetch; Rust's native
    // HTTP client encodes strings as UTF-8, so restore the original group ID.
    env[key] = runtime.oauthProvider === 'tokennest' && name.toLowerCase() === 'x-tokennest-group'
      ? Buffer.from(value, 'latin1').toString('utf8') : value;
    headers[name] = key;
  }
  if (Object.keys(headers).length) provider.env_http_headers = headers;
  for (const [key, value] of Object.entries(provider)) {
    const toml = typeof value === 'object'
      ? `{${Object.entries(value).map(([name, entry]) => `${JSON.stringify(name)}=${JSON.stringify(entry)}`).join(',')}}`
      : JSON.stringify(value);
    configArgs.push('-c', `model_providers.${CODEX_CUSTOM_PROVIDER}.${key}=${toml}`);
  }
  return { env, configArgs };
}
