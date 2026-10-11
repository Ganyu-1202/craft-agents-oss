import { tokenNestGroupHeaderValue } from '../../shared/src/utils/tokennest-headers.ts';

/** Restore ByteString storage after JSONL decoding. Bun's Headers.append can
 * reject non-ASCII values carried in UTF-16 string storage even when every
 * code unit fits in a byte. Do not re-encode an already encoded group ID. */
export function normalizeCustomHeaderValues(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name,
    name.toLowerCase() === 'x-tokennest-group'
      ? (/[^\x00-\xff]/.test(value)
        ? tokenNestGroupHeaderValue(value)
        : Buffer.from(value, 'latin1').toString('latin1'))
      : value,
  ]));
}
