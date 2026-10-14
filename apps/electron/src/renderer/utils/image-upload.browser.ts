import { prepareImageUpload } from './image-upload';
import { IMAGE_UPLOAD_MAX_BYTES } from '@craft-agent/shared/protocol';
import type { FileAttachment } from '../../shared/types';

declare global { interface Window { runImageUploadChecks(): Promise<string[]> } }
window.runImageUploadChecks = async () => {
  const checks: string[] = [];
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const base64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = reject;
    reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.readAsDataURL(blob);
  });
  const noisy = async (width: number, height: number): Promise<FileAttachment> => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const pixels = ctx.createImageData(width, height);
    let state = 12345;
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        pixels.data[i + channel] = state >>> 24;
      }
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    canvas.width = canvas.height = 0;
    return { type: 'image', name: 'noise.png', mimeType: 'image/png', path: '', size: blob.size, base64: await base64(blob) };
  };
  const small = await noisy(20, 20);
  assert(await prepareImageUpload(small) === small, 'Small image was unnecessarily changed');
  checks.push('small image remains intact');

  const large = await noisy(1600, 1400);
  assert(large.size > IMAGE_UPLOAD_MAX_BYTES, 'Fixture was not oversized');
  const compressed = await prepareImageUpload(large);
  assert(compressed.size <= IMAGE_UPLOAD_MAX_BYTES && atob(compressed.base64!).length === compressed.size, 'Oversized payload remained after compression');
  assert(compressed.mimeType === 'image/jpeg' && compressed.name.endsWith('.jpg'), 'Encoded MIME and filename disagree');
  assert(large.mimeType === 'image/png' && large.size > IMAGE_UPLOAD_MAX_BYTES, 'Original attachment was mutated');
  checks.push(`real image compressed from ${large.size} to ${compressed.size} bytes before upload`);

  const portrait = await noisy(300, 10000);
  const resized = await prepareImageUpload(portrait);
  const decoded = new Image(); decoded.src = `data:${resized.mimeType};base64,${resized.base64}`; await decoded.decode();
  assert(decoded.naturalWidth <= 300 && decoded.naturalHeight <= 2048, 'Portrait was enlarged or not resized');
  assert(Math.abs(decoded.naturalWidth / decoded.naturalHeight - 300 / 10000) < 0.001, 'Portrait aspect ratio changed');
  checks.push('tall image preserves aspect ratio');

  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 100;
  const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
  const padded = new Blob([png, new Uint8Array(IMAGE_UPLOAD_MAX_BYTES)], { type: 'image/png' });
  const transparent = await prepareImageUpload({ ...small, size: padded.size, base64: await base64(padded) });
  assert(transparent.mimeType === 'image/png' && transparent.size <= IMAGE_UPLOAD_MAX_BYTES, 'Lossless transparency was not preserved');
  const transparentImage = new Image(); transparentImage.src = `data:image/png;base64,${transparent.base64}`; await transparentImage.decode();
  const ctx = canvas.getContext('2d')!; ctx.drawImage(transparentImage, 0, 0);
  assert(ctx.getImageData(0, 0, 1, 1).data[3] === 0, 'Transparent pixel was flattened unnecessarily');
  checks.push('PNG transparency preserved when lossless compression fits');

  const text = { ...large, type: 'text' as const };
  assert(await prepareImageUpload(text) === text, 'Non-image attachment changed');
  let rejected = false;
  try { await prepareImageUpload({ ...large, base64: btoa('invalid'.repeat(400000)) }); } catch { rejected = true; }
  assert(rejected, 'Undecodable oversized image was uploaded');
  checks.push('non-image passthrough and invalid image rejection');
  return checks;
};
