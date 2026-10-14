import { describe, it, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveScriptRuntime } from './resolve-script-runtime.ts';

describe('resolveScriptRuntime', () => {
  it.skipIf(process.platform !== 'win32')('resolves the shared Windows Bun without an app-local duplicate or env override', () => {
    const previousBun = process.env.TOKENBIRD_BUN;
    delete process.env.TOKENBIRD_BUN;
    const root = mkdtempSync(join(tmpdir(), 'tokenbird-shared-bun-'));
    const resourcesBase = join(root, 'resources', 'app');
    const bunPath = join(root, 'resources', 'vendor', 'bun', 'bun.exe');
    mkdirSync(join(root, 'resources', 'vendor', 'bun'), { recursive: true });
    mkdirSync(resourcesBase, { recursive: true });
    writeFileSync(bunPath, '');

    try {
      expect(resolveScriptRuntime('bun', { isPackaged: true, resourcesBasePath: resourcesBase })).toEqual({
        command: bunPath,
        argsPrefix: [],
        source: 'bundled',
      });
    } finally {
      if (previousBun === undefined) delete process.env.TOKENBIRD_BUN;
      else process.env.TOKENBIRD_BUN = previousBun;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('prefers TOKENBIRD_UV for python3', () => {
    const prev = process.env.TOKENBIRD_UV;
    process.env.TOKENBIRD_UV = '/tmp/custom-uv';

    try {
      const resolved = resolveScriptRuntime('python3', { isPackaged: false });
      expect(resolved.command).toBe('/tmp/custom-uv');
      expect(resolved.argsPrefix).toEqual(['run', '--python', '3.12']);
      expect(resolved.source).toBe('env');
    } finally {
      if (prev === undefined) delete process.env.TOKENBIRD_UV;
      else process.env.TOKENBIRD_UV = prev;
    }
  });

  it('prefers bundled uv when env is missing', () => {
    const prevUv = process.env.TOKENBIRD_UV;
    delete process.env.TOKENBIRD_UV;

    const base = mkdtempSync(join(tmpdir(), 'runtime-resolver-'));
    const uvPath = join(base, 'resources', 'bin', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'uv.exe' : 'uv');
    mkdirSync(join(base, 'resources', 'bin', `${process.platform}-${process.arch}`), { recursive: true });
    writeFileSync(uvPath, '');

    try {
      const resolved = resolveScriptRuntime('python3', { isPackaged: true, resourcesBasePath: base });
      expect(resolved.command).toBe(uvPath);
      expect(resolved.source).toBe('bundled');
    } finally {
      if (prevUv === undefined) delete process.env.TOKENBIRD_UV;
      else process.env.TOKENBIRD_UV = prevUv;
    }
  });

  it('blocks PATH fallback in packaged mode', () => {
    const prevUv = process.env.TOKENBIRD_UV;
    const prevBase = process.env.TOKENBIRD_RESOURCES_BASE;
    const prevRoot = process.env.TOKENBIRD_APP_ROOT;
    delete process.env.TOKENBIRD_UV;
    delete process.env.TOKENBIRD_RESOURCES_BASE;
    delete process.env.TOKENBIRD_APP_ROOT;

    try {
      expect(() => resolveScriptRuntime('python3', { isPackaged: true })).toThrow(
        'packaged app'
      );
    } finally {
      if (prevUv === undefined) delete process.env.TOKENBIRD_UV;
      else process.env.TOKENBIRD_UV = prevUv;
      if (prevBase === undefined) delete process.env.TOKENBIRD_RESOURCES_BASE;
      else process.env.TOKENBIRD_RESOURCES_BASE = prevBase;
      if (prevRoot === undefined) delete process.env.TOKENBIRD_APP_ROOT;
      else process.env.TOKENBIRD_APP_ROOT = prevRoot;
    }
  });

  it('rejects bare TOKENBIRD_NODE command in packaged mode', () => {
    const prev = process.env.TOKENBIRD_NODE;
    process.env.TOKENBIRD_NODE = 'node';

    try {
      expect(() => resolveScriptRuntime('node', { isPackaged: true })).toThrow(
        'do not allow PATH-based runtime resolution'
      );
    } finally {
      if (prev === undefined) delete process.env.TOKENBIRD_NODE;
      else process.env.TOKENBIRD_NODE = prev;
    }
  });

  it('prefers TOKENBIRD_BUN for bun in dev', () => {
    const prev = process.env.TOKENBIRD_BUN;
    process.env.TOKENBIRD_BUN = '/tmp/custom-bun';

    try {
      const resolved = resolveScriptRuntime('bun', { isPackaged: false });
      expect(resolved.command).toBe('/tmp/custom-bun');
      expect(resolved.argsPrefix).toEqual([]);
      expect(resolved.source).toBe('env');
    } finally {
      if (prev === undefined) delete process.env.TOKENBIRD_BUN;
      else process.env.TOKENBIRD_BUN = prev;
    }
  });
});
