/** Fetch/Node headers use ByteString values; TokenNest reads UTF-8 wire bytes.
 * Apply once when constructing headers, retaining the original ID in config. */
export function tokenNestGroupHeaderValue(group: string): string {
  return Buffer.from(group, 'utf8').toString('latin1');
}
