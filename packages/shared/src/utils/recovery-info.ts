/** Provider recovery notices describe continued work, not a user interruption.
 * Also recognizes older saved messages that predate the retrying status tag. */
export function isRecoveryInfo(content: string): boolean {
  return /^(?:Recovered after \d+ retr(?:y|ies)\b|Reconnecting\b|Restoring conversation context\b|Session expired, restoring context\b|Conversation sync failed, restoring context\b|Request failed, retrying with context\b|Branch point was compacted on server, retrying\b|Branch (?:source unavailable on this machine|fork failed), restoring context\b)/i.test(content.trim())
}
