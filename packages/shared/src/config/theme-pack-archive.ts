import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { importThemePackFromFolder, type ThemePack } from './theme-pack.ts';

const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

function archivePath(name: string): string {
  const normalized = name.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = normalized.split('/');
  if (!normalized || parts.some(part => !part || part === '.' || part === '..'
    || /[:\x00-\x1f]/.test(part) || /[. ]$/.test(part)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('Theme pack ZIP contains an unsafe file path');
  }
  return parts.join('/');
}

/** Import one native/DSH pack, either a directory or a ZIP with an optional wrapper directory. */
export function importThemePackFromPath(sourcePath: string): ThemePack | null {
  const info = statSync(sourcePath);
  if (info.isDirectory()) return importThemePackFromFolder(sourcePath);
  if (!info.isFile() || extname(sourcePath).toLowerCase() !== '.zip') {
    throw new Error('Select a ZIP theme pack or a theme pack folder');
  }
  if (info.size > MAX_ARCHIVE_BYTES) throw new Error('Theme pack ZIP exceeds 128 MB');

  let totalBytes = 0;
  let entryCount = 0;
  const seen = new Set<string>();
  const entries = unzipSync(readFileSync(sourcePath), { filter(file) {
    const path = archivePath(file.name);
    if (path.split('/').includes('__MACOSX') || basename(path) === '.DS_Store') return false;
    if (++entryCount > MAX_ENTRIES) throw new Error('Theme pack ZIP contains too many files');
    totalBytes += file.originalSize;
    if (totalBytes > MAX_EXTRACTED_BYTES) throw new Error('Extracted theme pack exceeds 512 MB');
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error('Theme pack ZIP contains duplicate file paths');
    seen.add(key);
    return true;
  } });

  const roots = new Set<string>();
  for (const name of Object.keys(entries)) {
    const path = archivePath(name);
    if (basename(path) === 'theme-pack.json' || basename(path) === 'skin.json') roots.add(dirname(path));
  }
  const packRoot = roots.has('.') ? '.' : roots.size === 1 ? [...roots][0]! : null;
  if (packRoot === null) {
    throw new Error(roots.size ? 'ZIP must contain only one theme pack' : 'ZIP is missing theme-pack.json or skin.json');
  }

  const staging = mkdtempSync(join(tmpdir(), 'tokenbird-theme-import-'));
  // Keep the ZIP basename as the fallback pack ID instead of the random staging name.
  const extracted = join(staging, basename(sourcePath, extname(sourcePath)));
  try {
    for (const [name, data] of Object.entries(entries)) {
      const path = archivePath(name);
      if (name.endsWith('/') || name.endsWith('\\')) continue;
      const target = join(extracted, ...path.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
    }
    const pack = importThemePackFromFolder(join(extracted, packRoot));
    if (!pack) throw new Error('Theme pack manifest is invalid');
    return pack;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
