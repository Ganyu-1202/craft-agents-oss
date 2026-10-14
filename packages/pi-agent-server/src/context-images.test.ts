import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent } from '@earendil-works/pi-coding-agent';
import { serializeConversation } from '@earendil-works/pi-coding-agent';
import { ContextImageReducer, contextImagesExtension, textizeImages } from './context-images';

const image = (id: string): ImageContent => ({ type: 'image', data: Buffer.from(id.repeat(2000)).toString('base64'), mimeType: 'image/png' });
const user = (id: string): AgentMessage => ({ role: 'user', timestamp: 1, content: [{ type: 'text', text: `Inspect attachments/${id}.png` }, image(id)] });
const tool = (id: string): AgentMessage => ({ role: 'toolResult', timestamp: 1, toolCallId: id, toolName: 'screenshot', isError: false, content: [{ type: 'text', text: id }, image(id)] });
const blocks = (message: AgentMessage) => (message as { content: Array<{ type: string; text?: string; data?: string }> }).content;

describe('history image context', () => {
  it('keeps all original images when context is small', async () => {
    const messages = [user('a'), user('b'), user('c')];
    const reducer = new ContextImageReducer(async () => { throw new Error('unexpected resize'); });
    expect(await reducer.reduce(messages, { pressure: 0.2 })).toEqual(messages);
  });

  it('reduces older uploads, preserves recent uploads and sources, and reuses cached outputs', async () => {
    let calls = 0;
    const reducer = new ContextImageReducer(async () => {
      calls++;
      return { data: 'small', mimeType: 'image/jpeg', width: 768, height: 384, originalWidth: 2048, originalHeight: 1024, wasResized: true };
    });
    const messages = [user('a'), user('b'), user('c'), user('d')];
    const original = structuredClone(messages);
    const output = await reducer.reduce(messages, { pressure: 0.7 });
    expect(blocks(output[0]!)[1]?.data).toBe('small');
    expect(blocks(output[0]!)[0]?.text).toContain('attachments/a.png');
    expect(output.slice(-2)).toEqual(messages.slice(-2));
    expect(messages).toEqual(original);
    await reducer.reduce(structuredClone(messages), { pressure: 0.7 });
    expect(calls).toBe(2);
  });

  it('textizes oldest images at high pressure, preserving the newest two turns', async () => {
    const reducer = new ContextImageReducer(async () => null);
    const messages = ['a', 'b', 'c', 'd', 'e', 'f'].map(user);
    const output = await reducer.reduce(messages, { pressure: 0.9 });
    expect(blocks(output[0]!)[1]?.text).toContain('Historical image');
    expect(blocks(output[0]!)[1]?.text).toContain('not an OCR transcription');
    expect(output.slice(-2)).toEqual(messages.slice(-2));
    const imminent = await reducer.reduce(messages, { pressure: 1 });
    expect(blocks(imminent[3]!)[1]?.type).toBe('text');
  });

  it('reduces screenshots within long tool turns while retaining tool call identities', async () => {
    const messages = [user('a'), ...['s1', 's2', 's3', 's4', 's5', 's6'].map(tool)];
    const output = await new ContextImageReducer(async () => null).reduce(messages, { pressure: 1 });
    expect(output[0]).toEqual(messages[0]);
    expect(blocks(output[1]!)[1]?.type).toBe('text');
    expect((output[1] as { toolCallId: string }).toolCallId).toBe('s1');
    expect(output.slice(-2)).toEqual(messages.slice(-2));
  });

  it('falls back to originals if optional resizing is unavailable and honors cancellation', async () => {
    const messages = ['a', 'b', 'c'].map(user);
    const reducer = new ContextImageReducer(async () => { throw new Error('decoder unavailable'); });
    expect(await reducer.reduce(messages, { pressure: 0.7 })).toEqual(messages);
    await expect(reducer.reduce(messages, { pressure: 0.7, signal: AbortSignal.abort() })).rejects.toThrow();
  });

  it('really shrinks a historical bitmap and preserves its aspect ratio', async () => {
    const buffer = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#937acf' } }).png().toBuffer();
    const messages = [user('a'), user('b'), user('c')];
    (messages[0] as { content: unknown[] }).content[1] = { type: 'image', data: buffer.toString('base64'), mimeType: 'image/png' };
    const output = await new ContextImageReducer().reduce(messages, { pressure: 0.7 });
    const reduced = Buffer.from(blocks(output[0]!)[1]!.data!, 'base64');
    const metadata = await sharp(reduced).metadata();
    expect(metadata.width).toBe(768);
    expect(metadata.height).toBe(384);
    expect(reduced.length).toBeLessThanOrEqual(96 * 1024);
  });

  it('preserves a generated visual description and reuses it for compact summaries', async () => {
    let descriptions = 0;
    const reducer = new ContextImageReducer(async () => ({ data: 'small', mimeType: 'image/jpeg', width: 384, height: 384,
      originalWidth: 1024, originalHeight: 1024, wasResized: true }), async (_image, context) => {
      descriptions++;
      expect(context).toContain('attachments/a.png');
      return 'A diagram with three connected boxes labeled Input, Compact, and Output.';
    });
    const messages = ['a', 'b', 'c'].map(user);
    const output = await reducer.reduce(messages, { pressure: 1 });
    expect(blocks(output[0]!)[1]?.text).toContain('Visual summary: A diagram');
    const summary = await reducer.textize([messages[0]!], new AbortController().signal, { remaining: 3 });
    expect(blocks(summary[0]!)[1]?.text).toContain('Input, Compact, and Output');
    expect(descriptions).toBe(1);
  });

  it('retains a reduced image if captioning fails before exhausting the context budget', async () => {
    const reducer = new ContextImageReducer(async () => ({ data: 'small', mimeType: 'image/jpeg', width: 384, height: 384,
      originalWidth: 1024, originalHeight: 1024, wasResized: true }), async () => null);
    const output = await reducer.reduce(['a', 'b', 'c', 'd', 'e'].map(user), { pressure: 0.9 });
    expect(blocks(output[0]!)[1]?.type).toBe('image');
    expect(blocks(output[0]!)[1]?.data).toBe('small');
  });

  it('keeps image records in compact summaries without altering original history', async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    await contextImagesExtension({ reserveTokens: 16384 })({ on: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) } as unknown as ExtensionAPI);
    for (const reason of ['manual', 'threshold', 'overflow']) {
      const original = [user('diagram')];
      const event = { reason, signal: new AbortController().signal, preparation: {
        messagesToSummarize: original, turnPrefixMessages: original,
      } } as SessionBeforeCompactEvent;
      await handlers.get('session_before_compact')!(event);
      const serialized = serializeConversation(event.preparation.messagesToSummarize as any);
      expect(serialized).toContain('Historical image');
      expect(serialized).toContain('attachments/diagram.png');
      expect(blocks(original[0]!)[1]?.type).toBe('image');
      expect(event.preparation.turnPrefixMessages).toEqual(textizeImages(original));
    }
  });

  it('uses the configured compact budget and downscales retained images after compact', async () => {
    let pressure = -1;
    let after = false;
    const reducer = { reduce: async (messages: AgentMessage[], options: { pressure: number; afterCompaction?: boolean }) => {
      pressure = options.pressure; after = !!options.afterCompaction; return messages;
    } } as ContextImageReducer;
    const handlers = new Map<string, (...args: any[]) => any>();
    await contextImagesExtension({ tokenLimit: 20_000, reserveTokens: 16_384, reducer })({ on: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) } as unknown as ExtensionAPI);
    const ctx = { getContextUsage: () => ({ tokens: 14_000, contextWindow: 128_000 }), model: { contextWindow: 128_000 } } as ExtensionContext;
    await handlers.get('context')!({ messages: [user('a')] }, ctx);
    expect(pressure).toBe(0.7);
    handlers.get('session_compact')!();
    await handlers.get('context')!({ messages: [user('a')] }, ctx);
    expect(after).toBe(true);
  });
});
