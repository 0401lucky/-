export interface FeedbackImage {
  dataUrl: string;
  mimeType: string;
  size: number;
  name?: string;
}

export const FEEDBACK_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

export const FEEDBACK_IMAGE_ACCEPT = FEEDBACK_IMAGE_MIME_TYPES.join(',');
export const MAX_FEEDBACK_IMAGES = 4;
export const MAX_FEEDBACK_IMAGE_BYTES = 2 * 1024 * 1024;

const MAX_FEEDBACK_IMAGE_NAME_LENGTH = 80;
const ALLOWED_MIME_TYPES = new Set<string>(FEEDBACK_IMAGE_MIME_TYPES);

function estimateBase64Bytes(base64: string): number {
  const cleanBase64 = base64.trim();
  const padding = cleanBase64.endsWith('==')
    ? 2
    : cleanBase64.endsWith('=')
      ? 1
      : 0;

  return Math.floor((cleanBase64.length * 3) / 4 - padding);
}

function parseImageDataUrl(dataUrl: string): {
  mimeType: string;
  size: number;
} {
  const matched = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!matched) {
    throw new Error('图片数据格式无效，请重新上传');
  }

  const mimeType = matched[1].toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error('仅支持 PNG/JPG/WEBP/GIF 格式图片');
  }

  const size = estimateBase64Bytes(matched[2]);
  if (size <= 0 || !Number.isFinite(size)) {
    throw new Error('图片数据无效，请重新上传');
  }

  if (size > MAX_FEEDBACK_IMAGE_BYTES) {
    throw new Error(`单张图片不能超过 ${MAX_FEEDBACK_IMAGE_BYTES / 1024 / 1024}MB`);
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
    throw new Error('图片参数格式错误');
  }

  if (images.length > MAX_FEEDBACK_IMAGES) {
    throw new Error(`最多上传 ${MAX_FEEDBACK_IMAGES} 张图片`);
  }

  return images.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('图片参数格式错误');
    }

    const rawDataUrl =
      'dataUrl' in item && typeof item.dataUrl === 'string'
        ? item.dataUrl.trim()
        : '';

    if (!rawDataUrl) {
      throw new Error('图片数据不能为空');
    }

    const { mimeType, size } = parseImageDataUrl(rawDataUrl);

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
    };
  });
}
