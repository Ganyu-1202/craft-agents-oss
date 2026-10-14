import { afterEach, describe, expect, it } from 'bun:test';
import { clearNativeCodexBinaryCache, resolveNativeCodexBinary, resolveCodexPackageExecutable } from './binary-resolver.ts';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, platform, arch } from 'node:os';
import { join } from 'node:path';

afterEach(() => clearNativeCodexBinaryCache());

describe('resolveNativeCodexBinary', () => {
  it('resolves an npm command shim to the platform binary without running the shell', () => {
    const root = mkdtempSync(join(tmpdir(), 'tokenbird-codex-shim-'));
    try {
      const targets: Record<string, string> = { 'win32-x64': 'x86_64-pc-windows-msvc', 'win32-arm64': 'aarch64-pc-windows-msvc',
        'linux-x64': 'x86_64-unknown-linux-musl', 'linux-arm64': 'aarch64-unknown-linux-musl',
        'darwin-x64': 'x86_64-apple-darwin', 'darwin-arm64': 'aarch64-apple-darwin' };
      const target = targets[`${platform()}-${arch()}`]!;
      const packageRoot = join(root, 'node_modules', '@openai', 'codex');
      const platformRoot = join(root, 'node_modules', '@openai', `codex-${platform()}-${arch()}`);
      const binary = join(platformRoot, 'vendor', target, 'bin', platform() === 'win32' ? 'codex.exe' : 'codex');
      mkdirSync(packageRoot, { recursive: true });
      mkdirSync(join(platformRoot, 'vendor', target, 'bin'), { recursive: true });
      writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@openai/codex' }));
      writeFileSync(join(platformRoot, 'package.json'), '{}');
      writeFileSync(binary, 'fixture');
      const shim = join(root, 'codex.cmd');
      writeFileSync(shim, 'must never be executed');
      expect(resolveCodexPackageExecutable(shim)).toBe(binary);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('returns null when no candidate exists', () => {
    expect(resolveNativeCodexBinary({ env: { PATH: '', TOKENBIRD_CODEX_PATH: 'Z:\\missing\\codex.exe' }, useCache: false })).toBeNull();
  });

  it('rejects untested protocol versions by default', () => {
    expect(resolveNativeCodexBinary({ env: { PATH: '', TOKENBIRD_CODEX_PATH: process.execPath }, useCache: false })).toBeNull();
  });

  it('allows an explicit untested-version escape hatch', () => {
    const result = resolveNativeCodexBinary({
      env: { PATH: '', TOKENBIRD_CODEX_PATH: process.execPath, TOKENBIRD_CODEX_ALLOW_UNTESTED: '1' },
      useCache: false,
    });
    expect(result?.path).toBe(process.execPath);
    expect(result?.testedProtocol).toBe(false);
  });

  it('invalidates cached detection when an explicit path changes', () => {
    const env = { PATH: '', TOKENBIRD_CODEX_PATH: process.execPath, TOKENBIRD_CODEX_ALLOW_UNTESTED: '1' };
    expect(resolveNativeCodexBinary({ env })?.path).toBe(process.execPath);
    expect(resolveNativeCodexBinary({ env: { ...env, TOKENBIRD_CODEX_PATH: 'Z:\\missing\\codex.exe' } })).toBeNull();
  });
});
