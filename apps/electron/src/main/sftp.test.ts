import { describe, expect, it } from 'bun:test'
import { isRemotePathWithinRoot } from './sftp'

describe('isRemotePathWithinRoot', () => {
  it('accepts paths inside a configured root', () => {
    expect(isRemotePathWithinRoot('/srv/tokenbird/file.zip', '/srv/tokenbird')).toBe(true)
    expect(isRemotePathWithinRoot('/srv/tokenbird', '/srv/tokenbird')).toBe(true)
  })

  it('rejects sibling and traversal-normalized paths', () => {
    expect(isRemotePathWithinRoot('/srv/tokenbird-other/file.zip', '/srv/tokenbird')).toBe(false)
    expect(isRemotePathWithinRoot('/srv/tokenbird/../secret.txt', '/srv/tokenbird')).toBe(false)
  })

  it('allows absolute paths when the configured root is the filesystem root', () => {
    expect(isRemotePathWithinRoot('/var/backups/file.zip', '/')).toBe(true)
  })
})
