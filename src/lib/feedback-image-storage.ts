import { put } from '@vercel/blob';
import { nanoid } from 'nanoid';
import type { FeedbackImage } from '@/lib/feedback-image';

type FeedbackImageRole = 'user' | 'admin';

const FEEDBACK_IMAGE_EXTENSION_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function sanitizeEnvValue(value: string | undefined): string {
  if (!value) {
    return '';
  }

  return value
    .replace(/\\r\\n|\\n|\\r/g, '')
    .replace(/[\r\n]/g, '')
    .trim();
}

function getBlobToken(): string {
  const token = sanitizeEnvValue(process.env.BLOB_READ_WRITE_TOKEN);
  if (!token) {
    throw new Error('未配置 BLOB_READ_WRITE_TOKEN，无法上传反馈图片');
  }
  return token;
}

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

function buildBlobPath(
  feedbackId: string,
  messageId: string,
  role: FeedbackImageRole,
  mimeType: string,
  name: string | undefined,
  index: number
): string {
  const ext = FEEDBACK_IMAGE_EXTENSION_MAP[mimeType] ?? 'bin';
  const dateBucket = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const safeName = sanitizeFileName(name);
  const baseName = safeName ? safeName.replace(/\.[^.]+$/, '') : `img-${index + 1}`;

  return `feedback/${dateBucket}/${feedbackId}/${messageId}-${role}-${nanoid(6)}-${baseName}.${ext}`;
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

  const token = getBlobToken();

  return Promise.all(
    images.map(async (image, index) => {
      const data = image.dataUrl?.trim() ?? '';
      if (!isDataUrl(data)) {
        return image;
      }

      const { mimeType, bytes } = decodeDataUrl(data);
      const pathname = buildBlobPath(
        options.feedbackId,
        options.messageId,
        options.role,
        mimeType,
        image.name,
        index
      );

      const result = await put(pathname, bytes, {
        access: 'public',
        contentType: mimeType,
        token,
        addRandomSuffix: false,
      });

      return {
        ...image,
        dataUrl: result.url,
        mimeType,
        size: bytes.byteLength,
        name: sanitizeFileName(image.name),
      };
    })
  );
}
