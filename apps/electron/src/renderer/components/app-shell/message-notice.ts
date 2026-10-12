/** Recognize the benign Pi compaction refusal, including persisted unknown errors. */
export function isSessionTooSmallToCompact(message: {
  content: string
  errorOriginal?: string
  errorDetails?: string[]
}): boolean {
  return [message.content, message.errorOriginal, ...(message.errorDetails ?? [])]
    .some(text => text != null && /\bnothing to compact\s*\(session too small\)/i.test(text))
}
