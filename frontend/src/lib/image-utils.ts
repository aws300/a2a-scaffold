/**
 * Shared image processing utilities for ChatPanel image attachments.
 * Used by all pages that use ChatPanel to serialize images into A2A requests.
 */
import type { ImageAttachment } from '@/components/chat/ChatPanel';

/**
 * Resize images to a max dimension before sending (saves bandwidth).
 * Returns new ImageAttachment[] with resized data URLs.
 */
export async function resizeImages(
  images: ImageAttachment[],
  maxDim: number = 1024,
): Promise<ImageAttachment[]> {
  return Promise.all(
    images.map(async (img) => {
      if (!img.width || !img.height) return img;
      if (img.width <= maxDim && img.height <= maxDim) return img;

      const scale = maxDim / Math.max(img.width, img.height);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return img;

      const image = new Image();
      await new Promise<void>((resolve) => {
        image.onload = () => resolve();
        image.onerror = () => resolve();
        image.src = img.url;
      });

      ctx.drawImage(image, 0, 0, w, h);
      const resizedUrl = canvas.toDataURL(img.mime || 'image/png', 0.85);
      return { ...img, url: resizedUrl, width: w, height: h };
    }),
  );
}

/**
 * Build ConnectRPC request parts array from text + optional images.
 * Matches the format expected by lf.a2a.v1.A2AService.SendStreamingMessage.
 */
export function buildRequestParts(
  text: string,
  images?: ImageAttachment[],
): Array<{ content: { case: 'text'; value: string } | { case: 'url'; value: string }; mediaType: string; filename: string }> {
  const parts: Array<{ content: { case: 'text'; value: string } | { case: 'url'; value: string }; mediaType: string; filename: string }> = [
    { content: { case: 'text' as const, value: text }, mediaType: '', filename: '' },
  ];
  if (images && images.length > 0) {
    for (const img of images) {
      parts.push({
        content: { case: 'url' as const, value: img.url },
        mediaType: img.mime,
        filename: img.filename ?? '',
      });
    }
  }
  return parts;
}
