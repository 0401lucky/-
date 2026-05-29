export interface FeedbackImage {
  dataUrl: string;
  mimeType: string;
  size: number;
  name?: string;
  kind?: FeedbackMediaKind;
}

export type FeedbackMediaKind = 'image' | 'video';

export const FEEDBACK_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export const FEEDBACK_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const;

export const FEEDBACK_MEDIA_MIME_TYPES = [
  ...FEEDBACK_IMAGE_MIME_TYPES,
  ...FEEDBACK_VIDEO_MIME_TYPES,
] as const;

export const FEEDBACK_MEDIA_ACCEPT = FEEDBACK_MEDIA_MIME_TYPES.join(',');
export const FEEDBACK_IMAGE_ACCEPT = FEEDBACK_MEDIA_ACCEPT;
export const MAX_FEEDBACK_IMAGES = 4;
export const MAX_FEEDBACK_MEDIA_FILES = MAX_FEEDBACK_IMAGES;
export const MAX_FEEDBACK_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_FEEDBACK_VIDEO_BYTES = 20 * 1024 * 1024;

const MAX_FEEDBACK_IMAGE_NAME_LENGTH = 80;
const ALLOWED_MIME_TYPES = new Set<string>(FEEDBACK_MEDIA_MIME_TYPES);

function estimateBase64Bytes(base64: string): number {
  const cleanBase64 = base64.trim();
  const padding = cleanBase64.endsWith('==')
    ? 2
    : cleanBase64.endsWith('=')
      ? 1
      : 0;

  return Math.floor((cleanBase64.length * 3) / 4 - padding);
}

export function getFeedbackMediaKind(mimeType: string): FeedbackMediaKind | null {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  return null;
}

export function isFeedbackVideo(media: Pick<FeedbackImage, 'dataUrl' | 'mimeType'>): boolean {
  const mimeType = media.mimeType.toLowerCase();
  if (mimeType.startsWith('video/')) return true;
  return /\.(mp4|webm|mov)(?:[?#]|$)/i.test(media.dataUrl);
}

function parseMediaDataUrl(dataUrl: string): {
  mimeType: string;
  size: number;
} {
  const matched = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!matched) {
    throw new Error('附件数据格式无效，请重新上传');
  }

  const mimeType = matched[1].toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error('仅支持 PNG/JPG/WEBP/GIF 图片和 MP4/WEBM/MOV 视频');
  }

  const size = estimateBase64Bytes(matched[2]);
  if (size <= 0 || !Number.isFinite(size)) {
    throw new Error('附件数据无效，请重新上传');
  }

  const kind = getFeedbackMediaKind(mimeType);
  if (kind === 'image' && size > MAX_FEEDBACK_IMAGE_BYTES) {
    throw new Error(`单张图片不能超过 ${MAX_FEEDBACK_IMAGE_BYTES / 1024 / 1024}MB`);
  }
  if (kind === 'video' && size > MAX_FEEDBACK_VIDEO_BYTES) {
    throw new Error(`单个视频不能超过 ${MAX_FEEDBACK_VIDEO_BYTES / 1024 / 1024}MB`);
  }

  return {
    mimeType,
    size,
  };
}

export function normalizeFeedbackImages(images: unknown): FeedbackImage[] {
  if (images === undefined || images === null) {
    return [];
  }

  if (!Array.isArray(images)) {
    throw new Error('附件参数格式错误');
  }

  if (images.length > MAX_FEEDBACK_IMAGES) {
    throw new Error(`最多上传 ${MAX_FEEDBACK_MEDIA_FILES} 个附件`);
  }

  return images.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('附件参数格式错误');
    }

    const rawDataUrl =
      'dataUrl' in item && typeof item.dataUrl === 'string'
        ? item.dataUrl.trim()
        : '';

    if (!rawDataUrl) {
      throw new Error('附件数据不能为空');
    }

    const { mimeType, size } = parseMediaDataUrl(rawDataUrl);

    const rawName =
      'name' in item && typeof item.name === 'string'
        ? item.name.trim()
        : '';

    const safeName = rawName.slice(0, MAX_FEEDBACK_IMAGE_NAME_LENGTH);

    return {
      dataUrl: rawDataUrl,
      mimeType,
      size,
      name: safeName || undefined,
      kind: getFeedbackMediaKind(mimeType) ?? undefined,
    };
  });
}
