import { expect, test } from 'bun:test';
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('standalone layout with hoisted Zod 4 preserves every canonical tool parameter', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'tokenbird-packaged-schemas-'));
  let processHandle: ReturnType<typeof Bun.spawn> | undefined;
  try {
    // Standalone distributions copy src and root node_modules, without the
    // workspace's nested Zod 3 installation. Reproduce that exact resolution.
    cpSync(import.meta.dir, join(directory, 'src'), { recursive: true });
    symlinkSync(resolve(import.meta.dir, '../../..', 'node_modules'), join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(join(directory, 'probe.ts'), `
      import { z } from 'zod';
      import { SESSION_TOOL_DEFS, getToolDefsAsJsonSchema } from './src/tool-defs.ts';
      const tools = getToolDefsAsJsonSchema();
      console.log(JSON.stringify({ hoistedZod4: !!z.string()._zod, tools: tools.map(tool => ({
        name: tool.name, schema: tool.inputSchema,
        expectedFields: Object.keys(SESSION_TOOL_DEFS.find(def => def.name === tool.name)!.inputSchema.shape),
      })) }));
    `);
    const probe = Bun.spawn([process.execPath, join(directory, 'probe.ts')], {
      cwd: directory, env: { ...process.env, TOKENBIRD_CONFIG_DIR: join(directory, 'config') }, stdout: 'pipe', stderr: 'pipe',
    });
    processHandle = probe;
    const [stdout, stderr, code] = await Promise.all([new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.hoistedZod4).toBe(true);
    for (const tool of result.tools) {
      expect(tool.schema.type).toBe('object');
      expect(Object.keys(tool.schema.properties ?? {})).toEqual(tool.expectedFields);
    }
    const saved = result.tools.find((tool: any) => tool.name === 'saved_credentials').schema;
    expect(saved.required).toContain('action');
    expect(saved.properties.action.enum).toContain('request');
    expect(saved.properties.kind.enum).toContain('api-key');
  } finally {
    if (processHandle && processHandle.exitCode === null) { processHandle.kill(); await processHandle.exited; }
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);
