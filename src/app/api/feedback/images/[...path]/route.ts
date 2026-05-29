import { getCloudflareContext } from '@opennextjs/cloudflare';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const MEDIA_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

interface FeedbackR2Object {
  body?: ReadableStream<Uint8Array> | null;
  httpMetadata?: { contentType?: string };
  size?: number;
  httpEtag?: string;
  uploaded?: Date;
}

interface FeedbackR2GetOptions {
  range?: {
    offset: number;
    length?: number;
  };
}

interface FeedbackR2Bucket {
  head(key: string): Promise<FeedbackR2Object | null>;
  get(key: string, options?: FeedbackR2GetOptions): Promise<FeedbackR2Object | null>;
}

function getFeedbackImageBucket(): FeedbackR2Bucket | null {
  try {
    const context = getCloudflareContext() as { env?: { FEEDBACK_IMAGES?: FeedbackR2Bucket } } | undefined;
    return context?.env?.FEEDBACK_IMAGES ?? null;
  } catch {
    return null;
  }
}

function getContentType(key: string, object: FeedbackR2Object): string {
  const dotIndex = key.lastIndexOf('.');
  const ext = dotIndex >= 0 ? key.slice(dotIndex).toLowerCase() : '';
  return object.httpMetadata?.contentType || MEDIA_MIME_TYPES[ext] || 'application/octet-stream';
}

function buildImageHeaders(key: string, object: FeedbackR2Object): Headers {
  const headers = new Headers({
    'Content-Type': getContentType(key, object),
    'Cache-Control': IMAGE_CACHE_CONTROL,
    'Accept-Ranges': 'bytes',
  });

  if (typeof object.size === 'number') {
    headers.set('Content-Length', String(object.size));
  }
  if (object.httpEtag) {
    headers.set('ETag', object.httpEtag);
  }
  if (object.uploaded) {
    headers.set('Last-Modified', object.uploaded.toUTCString());
  }

  return headers;
}

function resolveImageKey(path: string[]): string | null {
  const key = path.join('/').replace(/^\/+/, '');
  if (!key || key.includes('..') || !key.startsWith('feedback/')) {
    return null;
  }
  return key;
}

function parseByteRange(
  rangeHeader: string | null,
  size: number | undefined
):
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'ok'; start: number; end: number; length: number } {
  if (!rangeHeader) {
    return { status: 'none' };
  }

  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return { status: 'none' };
  }

  const matched = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!matched) {
    return { status: 'invalid' };
  }

  const [, startRaw, endRaw] = matched;
  if (!startRaw && !endRaw) {
    return { status: 'invalid' };
  }

  let start: number;
  let end: number;
  if (!startRaw) {
    const suffixLength = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { status: 'invalid' };
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number.parseInt(startRaw, 10);
    end = endRaw ? Number.parseInt(endRaw, 10) : size - 1;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return { status: 'invalid' };
  }

  end = Math.min(end, size - 1);
  return {
    status: 'ok',
    start,
    end,
    length: end - start + 1,
  };
}

async function handleImageRequest(
  request: NextRequest,
  params: Promise<{ path?: string[] }>,
  includeBody: boolean
): Promise<Response> {
  const { path = [] } = await params;
  const key = resolveImageKey(path);
  if (!key) {
    return new Response(null, { status: 404 });
  }

  const bucket = getFeedbackImageBucket();
  if (!bucket) {
    return Response.json(
      { success: false, message: '反馈附件服务暂时不可用' },
      { status: 503 }
    );
  }

  const rangeHeader = request.headers.get('range');
  let object = rangeHeader || !includeBody
    ? await bucket.head(key)
    : await bucket.get(key);
  if (!object) {
    return new Response(null, { status: 404 });
  }

  const headers = buildImageHeaders(key, object);
  if (request.headers.get('if-none-match') === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  const range = parseByteRange(rangeHeader, object.size);
  if (range.status === 'invalid') {
    if (typeof object.size === 'number') {
      headers.set('Content-Range', `bytes */${object.size}`);
    }
    return new Response(null, { status: 416, headers });
  }

  if (range.status === 'ok') {
    headers.set('Content-Length', String(range.length));
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${object.size}`);

    if (!includeBody) {
      return new Response(null, { status: 206, headers });
    }

    const rangedObject = await bucket.get(key, {
      range: { offset: range.start, length: range.length },
    });
    if (!rangedObject?.body) {
      return new Response(null, { status: 404 });
    }

    return new Response(rangedObject.body, {
      status: 206,
      headers,
    });
  }

  if (includeBody && !object.body) {
    object = await bucket.get(key);
    if (!object?.body) {
      return new Response(null, { status: 404 });
    }
  }

  return new Response(includeBody ? object.body : null, {
    status: 200,
    headers,
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  return handleImageRequest(request, params, true);
}

export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  return handleImageRequest(request, params, false);
}
