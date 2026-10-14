import { IMAGE_UPLOAD_MAX_BYTES } from '@craft-agent/shared/protocol';
import type { FileAttachment } from '../../shared/types';

/** Compress before IPC/WebSocket/SFTP transfer; the server also enforces this limit. */
export async function prepareImageUpload(attachment: FileAttachment): Promise<FileAttachment> {
  if (attachment.type !== 'image' || !attachment.base64) return attachment;
  const bytes = atob(attachment.base64).length;
  if (bytes <= IMAGE_UPLOAD_MAX_BYTES) return attachment;
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Cannot decode image for automatic compression: ${attachment.name}`));
    image.src = `data:${attachment.mimeType};base64,${attachment.base64}`;
  });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx || !image.naturalWidth || !image.naturalHeight) throw new Error('Image compression is unavailable');
  let scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
  const encode = (mime: string, quality?: number) => new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image compression failed')), mime, quality);
  });
  try {
    while (true) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      // Preserve transparency when lossless output already fits the limit.
      let output = await encode('image/png');
      if (output.size > IMAGE_UPLOAD_MAX_BYTES) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5]) {
          output = await encode('image/jpeg', quality);
          if (output.size <= IMAGE_UPLOAD_MAX_BYTES) break;
        }
      }
      if (output.size <= IMAGE_UPLOAD_MAX_BYTES) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error ?? new Error('Cannot read compressed image'));
          reader.onload = () => resolve(String(reader.result).split(',')[1]!);
          reader.readAsDataURL(output);
        });
        const extension = output.type === 'image/jpeg' ? '.jpg' : '.png';
        return { ...attachment, base64, size: output.size, mimeType: output.type,
          name: attachment.name.replace(/\.[^.]+$/, '') + extension };
      }
      if (canvas.width === 1 && canvas.height === 1) throw new Error('Image could not be compressed below 2 MB');
      scale *= 0.75;
    }
  } finally {
    // Release the large backing store promptly on mobile devices.
    canvas.width = canvas.height = 0;
    image.src = '';
  }
}
