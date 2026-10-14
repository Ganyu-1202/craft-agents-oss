import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { importThemePackFromPath } from '../theme-pack-archive.ts';

const originalConfigDir = process.env.TOKENBIRD_CONFIG_DIR;
const directories: string[] = [];
afterEach(() => {
  if (originalConfigDir === undefined) delete process.env.TOKENBIRD_CONFIG_DIR;
  else process.env.TOKENBIRD_CONFIG_DIR = originalConfigDir;
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function archive(files: Record<string, string>, name = 'sample.zip') {
  const dir = mkdtempSync(join(tmpdir(), 'theme-zip-test-'));
  directories.push(dir);
  process.env.TOKENBIRD_CONFIG_DIR = join(dir, 'config');
  const path = join(dir, name);
  writeFileSync(path, zipSync(Object.fromEntries(Object.entries(files).map(([key, value]) => [key, strToU8(value)]))));
  return { path, dir };
}

describe('ZIP theme pack import', () => {
  it('installs a root native pack and preserves artwork and Live2D resources', () => {
    const { path } = archive({
      'theme-pack.json': JSON.stringify({ name: '中文主题' }),
      'background.png': 'artwork',
      'model/model.model3.json': '{}',
      'model/model.moc3': 'model',
      '__MACOSX/._theme-pack.json': 'metadata',
    }, 'my-theme.ZIP');
    const pack = importThemePackFromPath(path)!;
    expect(pack.id).toBe('my-theme');
    expect(pack.manifest.name).toBe('中文主题');
    expect(readFileSync(join(pack.dir, 'background.png'), 'utf8')).toBe('artwork');
    expect(readFileSync(join(pack.dir, 'model/model.moc3'), 'utf8')).toBe('model');
    expect(existsSync(join(pack.dir, '__MACOSX'))).toBe(false);
    expect(importThemePackFromPath(pack.dir)?.id).toBe(pack.id);
  });

  it('recognizes a wrapped DSH skin and installs only the pack directory', () => {
    const { path } = archive({
      'release/my-skin/skin.json': JSON.stringify({ id: 'zip-skin', name: 'Skin' }),
      'release/my-skin/assets/day.webp': 'day',
      'release/my-skin/lib/client.js': 'throw new Error("must not execute")',
      'README.md': 'outside pack',
    });
    const pack = importThemePackFromPath(path)!;
    expect(pack.id).toBe('zip-skin');
    expect(readFileSync(join(pack.dir, 'assets/day.webp'), 'utf8')).toBe('day');
    expect(existsSync(join(pack.dir, 'README.md'))).toBe(false);
  });

  it('rejects ambiguous packs and missing or malformed manifests', () => {
    const fixtures: Record<string, string>[] = [
      { 'one/theme-pack.json': '{"name":"One"}', 'two/skin.json': '{}' },
      { 'README.md': 'not a theme' },
      { 'theme-pack.json': '{invalid' },
    ];
    for (const files of fixtures) {
      const { path, dir } = archive(files);
      expect(() => importThemePackFromPath(path)).toThrow();
      expect(existsSync(join(dir, 'config/theme-packs/sample'))).toBe(false);
    }
  });

  it('rejects unsafe paths before installation', () => {
    for (const name of ['../outside', '/absolute', 'C:/outside', 'folder\\..\\outside', 'assets/CON.png', 'assets/file:stream']) {
      const { path, dir } = archive({ 'theme-pack.json': '{"id":"safe","name":"Safe"}', [name]: 'payload' });
      expect(() => importThemePackFromPath(path)).toThrow('unsafe file path');
      expect(existsSync(join(dir, 'config/theme-packs/safe'))).toBe(false);
      expect(existsSync(join(dir, 'outside'))).toBe(false);
    }
  });

  it('rejects case-colliding files and corrupt ZIP data', () => {
    const { path } = archive({ 'theme-pack.json': '{"name":"Sample"}', 'art.png': 'one', 'ART.png': 'two' });
    expect(() => importThemePackFromPath(path)).toThrow('duplicate file paths');
    writeFileSync(path, 'not a ZIP');
    expect(() => importThemePackFromPath(path)).toThrow();
  });

  it('rejects inflated declared sizes before decompression', () => {
    const { path } = archive({ 'theme-pack.json': '{"name":"Sample"}' });
    const bytes = readFileSync(path);
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(513 * 1024 * 1024, central + 24);
    writeFileSync(path, bytes);
    expect(() => importThemePackFromPath(path)).toThrow('512 MB');
  });
});
