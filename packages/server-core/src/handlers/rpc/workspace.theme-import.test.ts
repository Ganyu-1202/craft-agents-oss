import { afterEach, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { RPC_CHANNELS } from '@tokenbird/shared/protocol';
import type { HandlerDeps } from '../handler-deps';
import type { RpcServer } from '../../transport';
import { registerWorkspaceCoreHandlers } from './workspace';

const previousConfig = process.env.TOKENBIRD_CONFIG_DIR;
const dirs: string[] = [];
afterEach(() => {
  if (previousConfig === undefined) delete process.env.TOKENBIRD_CONFIG_DIR;
  else process.env.TOKENBIRD_CONFIG_DIR = previousConfig;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function serverWithDialog(result: { canceled: boolean; filePaths: string[] }) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const server = {
    handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler),
    invokeClient: mock(async () => result),
    push: mock(() => {}),
  };
  registerWorkspaceCoreHandlers(server as unknown as RpcServer, { sessionManager: {} } as HandlerDeps);
  return { handlers, server };
}

test('theme import selects a ZIP, installs it and notifies clients', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'theme-import-rpc-'));
  dirs.push(dir);
  process.env.TOKENBIRD_CONFIG_DIR = join(dir, 'config');
  const path = join(dir, 'test.zip');
  writeFileSync(path, zipSync({ 'pack/theme-pack.json': strToU8('{"id":"rpc-pack","name":"RPC pack"}') }));
  const { handlers, server } = serverWithDialog({ canceled: false, filePaths: [path] });
  const pack = await handlers.get(RPC_CHANNELS.theme.IMPORT_PACK)!({ clientId: 'desktop' });
  expect(pack.id).toBe('rpc-pack');
  expect(server.invokeClient).toHaveBeenCalledWith('desktop', 'client:openFileDialog', {
    properties: ['openFile'], title: 'Import Theme Pack', filters: [{ name: 'Theme Pack ZIP', extensions: ['zip'] }],
  });
  expect(server.push).toHaveBeenCalled();
});

test('cancelling theme import has no install notification and folder import remains available', async () => {
  const { handlers, server } = serverWithDialog({ canceled: true, filePaths: [] });
  expect(await handlers.get(RPC_CHANNELS.theme.IMPORT_PACK)!({ clientId: 'desktop' })).toBeNull();
  expect(await handlers.get(RPC_CHANNELS.theme.IMPORT_PACK_FOLDER)!({ clientId: 'desktop' })).toBeNull();
  expect(server.invokeClient).toHaveBeenLastCalledWith('desktop', 'client:openFileDialog', {
    properties: ['openDirectory'], title: 'Select Theme Pack Folder',
  });
  expect(server.push).not.toHaveBeenCalled();
});
