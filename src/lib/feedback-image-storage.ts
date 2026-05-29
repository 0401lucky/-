import { getCloudflareContext } from '@opennextjs/cloudflare';
import { nanoid } from 'nanoid';
import { isFeedbackVideo, type FeedbackImage } from '@/lib/feedback-image';

type FeedbackImageRole = 'user' | 'admin';

const FEEDBACK_MEDIA_EXTENSION_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

function decodeDataUrl(dataUrl: string): { mimeType: string; bytes: Buffer } {
  const matched = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!matched) {
    throw new Error('附件数据格式无效，请重新上传');
  }

  const mimeType = matched[1].toLowerCase();
  const bytes = Buffer.from(matched[2], 'base64');
  if (!bytes.length) {
    throw new Error('附件数据无效，请重新上传');
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
  const ext = FEEDBACK_MEDIA_EXTENSION_MAP[mimeType] ?? 'bin';
  const dateBucket = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // R2 使用高熵随机路径减少可枚举性与敏感信息暴露
  return `feedback/${dateBucket}/${role}/${nanoid(24)}.${ext}`;
}

function buildPublicImageUrl(pathname: string): string {
  const publicBaseUrl = (process.env.R2_PUBLIC_URL ?? '').replace(/\/+$/, '');
  if (publicBaseUrl) {
    return `${publicBaseUrl}/${pathname}`;
  }

  const encodedPath = pathname
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/api/feedback/images/${encodedPath}`;
}

function isDataUrl(value: string): boolean {
  return /^data:/i.test(value.trim());
}

function getFeedbackImagesBucket():
  | { put: (key: string, body: Buffer, options: { httpMetadata: { contentType: string } }) => Promise<unknown> }
  | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = (getCloudflareContext as any)?.();
    const env = ctx?.env as
      | {
          FEEDBACK_IMAGES?: {
            put: (key: string, body: Buffer, options: { httpMetadata: { contentType: string } }) => Promise<unknown>;
          };
        }
      | undefined;
    return env?.FEEDBACK_IMAGES ?? null;
  } catch (error) {
    console.error('Get FEEDBACK_IMAGES binding failed, keeping feedback images inline:', error);
    return null;
  }
}

function sanitizeStoredImage(image: FeedbackImage): FeedbackImage {
  return {
    ...image,
    name: sanitizeFileName(image.name),
  };
}

export async function externalizeFeedbackImages(
  images: FeedbackImage[],
  options: { feedbackId: string; messageId: string; role: FeedbackImageRole }
): Promise<FeedbackImage[]> {
  if (images.length === 0) {
    return [];
  }

  const r2 = getFeedbackImagesBucket();
  if (!r2) {
    if (images.some((image) => isFeedbackVideo(image))) {
      throw new Error('视频上传服务暂时不可用，请稍后重试');
    }
    console.warn('R2 binding FEEDBACK_IMAGES not available, keeping feedback media inline.');
    return images.map(sanitizeStoredImage);
  }

  return Promise.all(
    images.map(async (image) => {
      const data = image.dataUrl?.trim() ?? '';
      if (!isDataUrl(data)) {
        return image;
      }

      const { mimeType, bytes } = decodeDataUrl(data);
      const pathname = buildBlobPath(options.role, mimeType);

      try {
        await r2.put(pathname, bytes, {
          httpMetadata: { contentType: mimeType },
        });

        return {
          ...image,
          dataUrl: buildPublicImageUrl(pathname),
          mimeType,
          size: bytes.byteLength,
          name: sanitizeFileName(image.name),
        };
      } catch (error) {
        if (isFeedbackVideo(image)) {
          throw new Error('视频上传失败，请稍后重试');
        }
        console.error('Upload feedback media failed, keeping media inline:', error);
        return sanitizeStoredImage(image);
      }
    })
  );
}

