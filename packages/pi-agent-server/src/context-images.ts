import { createHash } from 'node:crypto';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent } from '@earendil-works/pi-ai';
import { estimateTokens, resizeImage, type ExtensionFactory } from '@earendil-works/pi-coding-agent';

type Resize = typeof resizeImage;
export type DescribeImage = (image: ImageContent, context: string, signal?: AbortSignal) => Promise<string | null>;
type CachedImage = { image: ImageContent; edge: number } | { text: string };

function imageId(image: ImageContent): string {
  return createHash('sha256').update(image.mimeType).update(image.data).digest('hex').slice(0, 16);
}

function imageRecord(image: ImageContent, id: string, description?: string): string {
  return `[Historical image ${id}: ${image.mimeType}, approximately ${Math.floor(image.data.length * 3 / 4)} bytes. ` +
    (description ? `Visual summary: ${description}\n` : '') +
    'Visual data omitted to reduce context. Preserve the associated request, file/source references and any observations already recorded in the conversation. ' +
    (description ? 'The visual summary may omit fine details; ' : 'This record is not an OCR transcription or a description of unseen details; ') +
    're-read the original attachment or tool source when visual details are needed.]';
}

/** Text records for the SDK summary serializer, which otherwise drops images silently. */
export function textizeImages(messages: AgentMessage[], records?: Map<string, string>): AgentMessage[] {
  return messages.map(message => {
    if (!('content' in message) || !Array.isArray(message.content)) return message;
    if (!message.content.some(block => block.type === 'image')) return message;
    return {
      ...message,
      content: message.content.map(block => block.type === 'image'
        ? { type: 'text' as const, text: records?.get(imageId(block)) ?? imageRecord(block, imageId(block)) }
        : block),
    } as AgentMessage;
  });
}

/** Request-only reductions: the stored transcript and attachment bytes remain the source of truth. */
export class ContextImageReducer {
  // The SDK clones context blocks each request, so use content hashes rather than object identity.
  // Cache only small outputs (at most 32 * 100KB) and never retain full originals here.
  private readonly cache = new Map<string, CachedImage>();
  private readonly captionFailures = new Map<string, number>();

  constructor(private readonly resize: Resize = resizeImage, private readonly describe?: DescribeImage) {}

  private async describeRecord(image: ImageContent, id: string, context: string, signal?: AbortSignal): Promise<string | null> {
    if (!this.describe || (this.captionFailures.get(id) ?? 0) > Date.now()) return null;
    const failed = () => {
      this.captionFailures.delete(id);
      this.captionFailures.set(id, Date.now() + 60_000);
      if (this.captionFailures.size > 32) this.captionFailures.delete(this.captionFailures.keys().next().value!);
      return null;
    };
    try {
      signal?.throwIfAborted();
      const small = await this.resize(Buffer.from(image.data, 'base64'), image.mimeType, {
        maxWidth: 768, maxHeight: 768, maxBytes: 128 * 1024, jpegQuality: 72,
      });
      if (!small || small.data.length > 128 * 1024) return failed();
      const description = await this.describe({ type: 'image', data: small.data, mimeType: small.mimeType }, context, signal);
      signal?.throwIfAborted();
      if (!description?.trim()) return failed();
      this.captionFailures.delete(id);
      return imageRecord(image, id, description.trim().slice(0, 4000));
    } catch {
      signal?.throwIfAborted();
      return failed();
    }
  }

  private remember(id: string, cached: CachedImage): void {
    this.cache.delete(id);
    this.cache.set(id, cached);
    if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
  }

  /** Bounded visual descriptions for the text-only compact summary request. */
  async textize(messages: AgentMessage[], signal: AbortSignal, budget: { remaining: number }): Promise<AgentMessage[]> {
    const records = new Map<string, string>();
    for (const message of messages) {
      signal.throwIfAborted();
      if (!('content' in message) || !Array.isArray(message.content)) continue;
      const context = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n').slice(0, 1000);
      for (const block of message.content) {
        if (block.type !== 'image') continue;
        const id = imageId(block);
        const cached = this.cache.get(id);
        if (cached && 'text' in cached) { records.set(id, cached.text); continue; }
        if (!this.describe || budget.remaining <= 0 || records.has(id)) continue;
        budget.remaining--;
        const text = await this.describeRecord(block, id, context, signal);
        if (text) { records.set(id, text); this.remember(id, { text }); }
      }
    }
    return textizeImages(messages, records);
  }

  async reduce(messages: AgentMessage[], options: {
    pressure: number;
    afterCompaction?: boolean;
    signal?: AbortSignal;
  }): Promise<AgentMessage[]> {
    const userIndices = messages.flatMap((message, index) => message.role === 'user' ? [index] : []);
    // Keep the current and previous user uploads, plus the two newest tool images.
    // Long computer-use turns can accumulate many screenshots without a new user message.
    const protectedStart = userIndices.at(-2) ?? 0;
    const recentStart = userIndices.at(-4) ?? 0;
    const toolImageIndices = messages.flatMap((message, index) => message.role === 'toolResult'
      && Array.isArray(message.content) && message.content.some(block => block.type === 'image') ? [index] : []);
    const protectedToolStart = toolImageIndices.at(-2) ?? 0;
    const recentToolStart = toolImageIndices.at(-4) ?? 0;
    const eligible = (message: AgentMessage, index: number) => message.role === 'toolResult'
      ? index < protectedToolStart : index < protectedStart;
    let bytes = 0;
    let count = 0;
    for (const [index, message] of messages.entries()) {
      if (!eligible(message, index)) continue;
      if (!('content' in message) || !Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (block.type !== 'image') continue;
        bytes += block.data.length * 3 / 4;
        count += 1;
      }
    }
    if (!count) return messages;
    const reduce = options.afterCompaction || options.pressure >= 0.65 || bytes > 4 * 1024 * 1024 || count > 8;
    if (!reduce && this.cache.size === 0) return messages;
    const severe = options.pressure >= 0.85 || bytes > 8 * 1024 * 1024 || count > 16;
    const edge = severe ? 384 : 768;
    const output = messages.slice();
    let descriptionsLeft = 2;
    for (let index = 0; index < messages.length; index += 1) {
      options.signal?.throwIfAborted();
      const message = messages[index]!;
      if (!eligible(message, index)) continue;
      if (!('content' in message) || !Array.isArray(message.content)) continue;
      if (!message.content.some(block => block.type === 'image')) continue;
      const content = [];
      const context = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n').slice(0, 1000);
      for (const block of message.content) {
        options.signal?.throwIfAborted();
        if (block.type !== 'image') { content.push(block); continue; }
        const id = imageId(block);
        let cached = this.cache.get(id);
        if (severe && (index < (message.role === 'toolResult' ? recentToolStart : recentStart) || options.pressure >= 1)) {
          if (!cached || !('text' in cached)) {
            const text = this.describe && descriptionsLeft-- > 0
              ? await this.describeRecord(block, id, context, options.signal) : null;
            // When captions fail, keep a thumbnail until the context budget is exhausted.
            if (text || !this.describe || options.pressure >= 1) cached = { text: text ?? imageRecord(block, id) };
          }
        }
        if (reduce && (!cached || ('image' in cached && cached.edge > edge))) {
          try {
            // SDK maxBytes counts base64 bytes; 128KB encoded is at most 96KB decoded.
            const resized = await this.resize(Buffer.from(block.data, 'base64'), block.mimeType, {
              maxWidth: edge, maxHeight: edge, maxBytes: 128 * 1024, jpegQuality: severe ? 55 : 72,
            });
            if (resized && resized.width <= edge && resized.height <= edge
              && resized.data.length <= 128 * 1024 && resized.data.length <= block.data.length) {
              cached = { image: { type: 'image', data: resized.data, mimeType: resized.mimeType }, edge };
            }
          } catch {
            // Optional history reduction must not break an otherwise valid conversation.
          }
        }
        options.signal?.throwIfAborted();
        if (cached) {
          this.remember(id, cached);
        }
        content.push(cached && 'text' in cached ? { type: 'text' as const, text: cached.text }
          : cached && 'image' in cached ? cached.image : block);
      }
      output[index] = { ...message, content } as AgentMessage;
    }
    return output;
  }
}

/** Both manual and automatic compaction use the same SDK extension events. */
export function contextImagesExtension(options: {
  tokenLimit?: number;
  reserveTokens: number;
  reducer?: ContextImageReducer;
  describe?: DescribeImage;
  getSignal?: () => AbortSignal | undefined;
}): ExtensionFactory {
  return pi => {
    const reducer = options.reducer ?? new ContextImageReducer(resizeImage, options.describe);
    let afterCompaction = false;
    pi.on('context', async (event, ctx) => {
      const usage = ctx.getContextUsage();
      const window = ctx.model?.contextWindow ?? usage?.contextWindow ?? 0;
      const limit = Math.max(1, Math.min(options.tokenLimit ?? Infinity, Math.max(1, window - options.reserveTokens)));
      const tokens = usage?.tokens ?? event.messages.reduce((sum, message) => sum + estimateTokens(message), 0);
      const messages = await reducer.reduce(event.messages, { pressure: window > 0 ? tokens / limit : 0, afterCompaction, signal: options.getSignal?.() });
      afterCompaction = false;
      return { messages };
    });
    pi.on('session_before_compact', async event => {
      event.signal.throwIfAborted();
      // Replace only preparation arrays; branch entries still contain the original images.
      const budget = { remaining: 3 };
      event.preparation.messagesToSummarize = await reducer.textize(event.preparation.messagesToSummarize, event.signal, budget);
      event.preparation.turnPrefixMessages = await reducer.textize(event.preparation.turnPrefixMessages, event.signal, budget);
    });
    pi.on('session_compact', () => { afterCompaction = true; });
  };
}
