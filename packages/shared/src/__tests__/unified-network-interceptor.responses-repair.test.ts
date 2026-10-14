import { beforeAll, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toolMetadataStore } from '../interceptor-common.ts';

let repairResponsesHistoryInPlace: typeof import('../unified-network-interceptor.ts').repairResponsesHistoryInPlace;
let validateOpenAiResponsesBody: typeof import('../unified-network-interceptor.ts').validateOpenAiResponsesBody;
let interceptedFetch: typeof import('../unified-network-interceptor.ts').interceptedFetch;

function callPair(id: string): Array<Record<string, unknown>> {
  return [
    { type: 'function_call', call_id: id, name: 'ls', arguments: '{}' },
    { type: 'function_call_output', call_id: id, output: 'result' },
  ];
}

describe('unified-network-interceptor responses-history repair (#613)', () => {
  beforeAll(async () => {
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    const mod = await import('../unified-network-interceptor.ts');
    repairResponsesHistoryInPlace = mod.repairResponsesHistoryInPlace;
    validateOpenAiResponsesBody = mod.validateOpenAiResponsesBody;
    interceptedFetch = mod.interceptedFetch;
  });

  it('synthesizes a deterministic call_id when function_call is missing one', () => {
    const input: Array<Record<string, unknown>> = [
      { type: 'function_call', name: 'ls', arguments: '{"path":"/tmp"}' },
    ];
    const result = repairResponsesHistoryInPlace(input);
    expect(result.synthesizedCallIds).toBe(1);
    expect(result.droppedOrphans).toBe(0);
    expect(typeof input[0]!.call_id).toBe('string');
    expect((input[0]!.call_id as string).startsWith('repaired_')).toBe(true);
  });

  it('synthesizes a stable call_id given the same name + arguments', () => {
    const a: Array<Record<string, unknown>> = [
      { type: 'function_call', name: 'ls', arguments: '{"x":1}' },
    ];
    const b: Array<Record<string, unknown>> = [
      { type: 'function_call', name: 'ls', arguments: '{"x":1}' },
    ];
    repairResponsesHistoryInPlace(a);
    repairResponsesHistoryInPlace(b);
    expect(a[0]!.call_id).toBe(b[0]!.call_id);
  });

  it('drops function_call_output entries that reference unknown call_ids', () => {
    const input: Array<Record<string, unknown>> = [
      { type: 'function_call', call_id: 'call_1', name: 'ls', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_ghost', output: 'orphan' },
      { type: 'function_call_output', call_id: 'call_1', output: 'real' },
    ];
    const result = repairResponsesHistoryInPlace(input);
    expect(result.droppedOrphans).toBe(1);
    expect(input.length).toBe(2);
    expect((input[1] as { call_id: string }).call_id).toBe('call_1');
  });

  it('keeps function_call_output that references a synthesized call_id', () => {
    // Pi SDK drops call_id on the function_call but the output still has one;
    // repair must synthesize for the call AND link the output.
    const input: Array<Record<string, unknown>> = [
      { type: 'function_call', name: 'ls', arguments: '{}' },
      { type: 'function_call_output', call_id: 'should_be_dropped', output: 'orphan' },
    ];
    const result = repairResponsesHistoryInPlace(input);
    expect(result.synthesizedCallIds).toBe(1);
    // output gets dropped because its call_id doesn't match the synthesized one
    expect(result.droppedOrphans).toBe(1);
    expect(input.length).toBe(1);
  });

  it('is a no-op when history is already well-formed', () => {
    const input: Array<Record<string, unknown>> = [
      { type: 'function_call', call_id: 'call_1', name: 'ls', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'a' },
    ];
    const result = repairResponsesHistoryInPlace(input);
    expect(result.synthesizedCallIds).toBe(0);
    expect(result.droppedOrphans).toBe(0);
    expect(input.length).toBe(2);
  });

  it('produces a body that passes validation after repair (end-to-end)', () => {
    const input: Array<Record<string, unknown>> = [
      { type: 'function_call', name: 'ls', arguments: '{}' },
      { type: 'function_call_output', call_id: 'orphan', output: 'gone' },
    ];
    repairResponsesHistoryInPlace(input);
    expect(() => validateOpenAiResponsesBody({ input })).not.toThrow();
  });

  it('shortens a 222-character ID and preserves its matching result', () => {
    const input = callPair('x'.repeat(222));
    const result = repairResponsesHistoryInPlace(input);
    expect(result.normalizedCallIds).toBe(1);
    expect(result.droppedOrphans).toBe(0);
    expect(input).toHaveLength(2);
    expect((input[0]!.call_id as string).length).toBeLessThanOrEqual(64);
    expect(input[1]!.call_id).toBe(input[0]!.call_id);
    expect(() => validateOpenAiResponsesBody({ input })).not.toThrow();
  });

  it('keeps long IDs with the same prefix distinct, stable, and idempotent', () => {
    const original = [...callPair('x'.repeat(221) + 'a'), ...callPair('x'.repeat(221) + 'b')];
    const input = structuredClone(original);
    const replay = structuredClone(original);
    repairResponsesHistoryInPlace(input);
    repairResponsesHistoryInPlace(replay);
    expect(input).toEqual(replay);
    expect(input[0]!.call_id).not.toBe(input[2]!.call_id);
    expect(input[1]!.call_id).toBe(input[0]!.call_id);
    expect(input[3]!.call_id).toBe(input[2]!.call_id);
    const snapshot = structuredClone(input);
    expect(repairResponsesHistoryInPlace(input).normalizedCallIds).toBe(0);
    expect(input).toEqual(snapshot);
  });

  it('preserves valid IDs at the 64-character boundary', () => {
    const input = callPair('x'.repeat(64));
    const original = structuredClone(input);
    expect(repairResponsesHistoryInPlace(input).normalizedCallIds).toBe(0);
    expect(input).toEqual(original);
    expect(() => validateOpenAiResponsesBody({ input })).not.toThrow();
  });

  it('bounds synthesized IDs even when the tool name is long', () => {
    const input: Array<Record<string, unknown>> = [
      { type: 'function_call', name: 'tool'.repeat(60), arguments: '{}' },
    ];
    repairResponsesHistoryInPlace(input);
    expect((input[0]!.call_id as string).length).toBeLessThanOrEqual(64);
  });

  it('does not collide with an existing valid ID', () => {
    const longId = 'x'.repeat(222);
    const reserved = `call_${createHash('sha256').update(longId).update('\0' + '0').digest('hex').slice(0, 48)}`;
    const input = [...callPair(longId), ...callPair(reserved)];
    repairResponsesHistoryInPlace(input);
    expect(input[0]!.call_id).not.toBe(reserved);
    expect(input[1]!.call_id).toBe(input[0]!.call_id);
    expect(input[2]!.call_id).toBe(reserved);
    expect(() => validateOpenAiResponsesBody({ input })).not.toThrow();
  });

  it('normalizes custom tool call IDs and their output references together', () => {
    const input: Array<Record<string, unknown>> = [
      { type: 'custom_tool_call', call_id: 'x'.repeat(222), name: 'custom', input: 'test' },
      { type: 'custom_tool_call_output', call_id: 'x'.repeat(222), output: 'result' },
    ];
    repairResponsesHistoryInPlace(input);
    expect((input[0]!.call_id as string).length).toBeLessThanOrEqual(64);
    expect(input[1]!.call_id).toBe(input[0]!.call_id);
  });

  it('rejects oversized IDs in preflight without exposing the ID', () => {
    const longId = 'private'.repeat(32);
    expect(() => validateOpenAiResponsesBody({ input: callPair(longId) })).toThrow('exceeds 64 characters (224)');
    try {
      validateOpenAiResponsesBody({ input: callPair(longId) });
    } catch (error) {
      expect((error as Error).message).not.toContain(longId);
      expect((error as { code: string }).code).toBe('call_id_too_long');
    }
  });

  it('sends bounded matching IDs on the wire while retaining stored tool metadata', async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), 'tokenbird-call-id-'));
    const longId = 'wire-id'.repeat(31) + '12345'; // exactly 222 characters
    let outgoing: { input: Array<Record<string, unknown>> } | undefined;
    const fetcher = (async (_url: unknown, init?: RequestInit) => {
      outgoing = JSON.parse(init!.body as string);
      return Response.json({ output: [] });
    }) as unknown as typeof fetch;
    toolMetadataStore.setSessionDir(sessionDir);
    try {
      toolMetadataStore.set(longId, { intent: 'Inspect files', displayName: 'List Files', timestamp: Date.now() });
      const response = await interceptedFetch('https://host/v1/responses', {
        method: 'POST',
        body: JSON.stringify({ model: 'test', input: callPair(longId) }),
      }, fetcher);
      expect(response.status).toBe(200);
      expect(outgoing!.input).toHaveLength(2);
      const [call, output] = outgoing!.input;
      expect((call!.call_id as string).length).toBeLessThanOrEqual(64);
      expect(output!.call_id).toBe(call!.call_id);
      expect(output!.output).toBe('result');
      expect(JSON.parse(call!.arguments as string)).toEqual({
        _intent: 'Inspect files', _displayName: 'List Files',
      });
      expect(() => validateOpenAiResponsesBody(outgoing!)).not.toThrow();
    } finally {
      toolMetadataStore.delete(longId);
      toolMetadataStore.setSessionDir('');
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });
});
