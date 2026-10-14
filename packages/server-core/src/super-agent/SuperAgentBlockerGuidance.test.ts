import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { loadSuperAgentDocument } from '@tokenbird/shared/super-agent'
import { superAgentFixture } from './SuperAgentTestSupport'

test('specific blocker guidance persists, can change independently of notes, and clears when work resumes', async () => {
  const f = await superAgentFixture()
  await f.service.save('alpha', f.config)
  const item = { id: 'plan', title: 'Research', instructions: 'Analyze the selected market', status: 'blocked' as const, priority: 3, note: 'Waiting for region',
    blocker: { kind: 'user' as const, summary: 'Target market is missing', userAction: 'Choose China or the US' } }
  await f.service.command('alpha', { type: 'plan-upsert', item, expectedRevision: 0 })
  expect((await loadSuperAgentDocument(join(f.root, 'alpha'))).state.plans[0]!.blocker).toEqual(item.blocker)
  await f.service.command('alpha', { type: 'plan-upsert', item: { ...item, blocker: { ...item.blocker, userAction: 'Choose the market and time horizon' } }, expectedRevision: 1 })
  expect((await f.service.get('alpha')).state.plans[0]!).toMatchObject({ revision: 2, blocker: { userAction: 'Choose the market and time horizon' } })
  await f.service.command('alpha', { type: 'plan-upsert', item: { ...item, status: 'active' }, expectedRevision: 2 })
  expect((await f.service.get('alpha')).state.plans[0]!.blocker).toBeUndefined()
})

test('a user blocker requires a concrete requested action', async () => {
  const f = await superAgentFixture()
  await f.service.save('alpha', f.config)
  await expect(f.service.command('alpha', { type: 'plan-upsert', expectedRevision: 0, item: {
    title: 'Research', instructions: 'Analyze', status: 'blocked', priority: 3, note: '',
    blocker: { kind: 'user', summary: 'Missing market', userAction: '' },
  } })).rejects.toThrow()
})
