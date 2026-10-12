import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

test('delivery cards resolve team files, route feedback, and show version availability', () => {
  const result = spawnSync(process.execPath, ['test', join(import.meta.dir, 'super-agent-delivery.isolated.tsx')], {
    cwd: resolve(import.meta.dir, '../../../..'), encoding: 'utf8', timeout: 30_000,
  })
  if (result.status !== 0) throw new Error(result.error?.message ?? `${result.stdout}\n${result.stderr}`)
  expect(result.status).toBe(0)
})
