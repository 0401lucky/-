import { getCloudflareContext } from '@opennextjs/cloudflare';
import { nanoid } from 'nanoid';
import type { FeedbackImage } from '@/lib/feedback-image';

type FeedbackImageRole = 'user' | 'admin';

const FEEDBACK_IMAGE_EXTENSION_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function decodeDataUrl(dataUrl: string): { mimeType: string; bytes: Buffer } {
  const matched = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!matched) {
    throw new Error('图片数据格式无效，请重新上传');
  }

  const mimeType = matched[1].toLowerCase();
  const bytes = Buffer.from(matched[2], 'base64');
  if (!bytes.length) {
    throw new Error('图片数据无效，请重新上传');
  }

  return { mimeType, bytes };
}

function sanitizeFileName(name: string | undefined): string | undefined {
  if (!name) {
    return undefined;
  }

  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-');

  return cleaned ? cleaned.slice(0, 80) : undefined;
}

function buildBlobPath(role: FeedbackImageRole, mimeType: string): string {
  const ext = FEEDBACK_IMAGE_EXTENSION_MAP[mimeType] ?? 'bin';
  const dateBucket = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // R2 使用高熵随机路径减少可枚举性与敏感信息暴露
  return `feedback/${dateBucket}/${role}/${nanoid(24)}.${ext}`;
}

function isDataUrl(value: string): boolean {
  return /^data:/i.test(value.trim());
}

export async function externalizeFeedbackImages(
  images: FeedbackImage[],
  options: { feedbackId: string; messageId: string; role: FeedbackImageRole }
): Promise<FeedbackImage[]> {
  if (images.length === 0) {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (getCloudflareContext as any)?.();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = ctx?.env as { FEEDBACK_IMAGES?: any } | undefined;
  const r2 = env?.FEEDBACK_IMAGES;
  if (!r2) {
    throw new Error('R2 binding FEEDBACK_IMAGES not available');
  }

  const publicBaseUrl = (process.env.R2_PUBLIC_URL ?? '').replace(/\/+$/, '');

  return Promise.all(
    images.map(async (image) => {
      const data = image.dataUrl?.trim() ?? '';
      if (!isDataUrl(data)) {
        return image;
      }

      const { mimeType, bytes } = decodeDataUrl(data);
      const pathname = buildBlobPath(options.role, mimeType);

      await r2.put(pathname, bytes, {
        httpMetadata: { contentType: mimeType },
      });

      const url = publicBaseUrl ? `${publicBaseUrl}/${pathname}` : pathname;

      return {
        ...image,
        dataUrl: url,
        mimeType,
        size: bytes.byteLength,
        name: sanitizeFileName(image.name),
      };
    })
  );
}

