import { describe, expect, test } from 'bun:test'
import { isSessionTooSmallToCompact } from '../message-notice'

describe('compaction warning classification', () => {
  test('recognizes the raw refusal in current and persisted errors', () => {
    expect(isSessionTooSmallToCompact({ content: 'Nothing to compact (session too small)' })).toBe(true)
    expect(isSessionTooSmallToCompact({ content: 'An unknown error occurred', errorOriginal: 'Error: Nothing to compact (session too small)' })).toBe(true)
    expect(isSessionTooSmallToCompact({ content: 'Compaction failed', errorDetails: ['Raw error: Nothing to compact (session too small)'] })).toBe(true)
  })

  test('keeps real compaction failures as errors', () => {
    for (const content of ['Compaction failed: network error', 'Context window exceeded', 'Nothing to compact (invalid session)', '']) {
      expect(isSessionTooSmallToCompact({ content })).toBe(false)
    }
  })
})
