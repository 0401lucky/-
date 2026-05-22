import { getCloudflareContext } from '@opennextjs/cloudflare';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

interface FeedbackR2Object {
  body: ReadableStream<Uint8Array> | null;
  httpMetadata?: { contentType?: string };
  size?: number;
  httpEtag?: string;
  uploaded?: Date;
}

interface FeedbackR2Bucket {
  get(key: string): Promise<FeedbackR2Object | null>;
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
  return object.httpMetadata?.contentType || IMAGE_MIME_TYPES[ext] || 'application/octet-stream';
}

function buildImageHeaders(key: string, object: FeedbackR2Object): Headers {
  const headers = new Headers({
    'Content-Type': getContentType(key, object),
    'Cache-Control': IMAGE_CACHE_CONTROL,
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
      { success: false, message: '反馈图片服务暂时不可用' },
      { status: 503 }
    );
  }

  const object = await bucket.get(key);
  if (!object?.body) {
    return new Response(null, { status: 404 });
  }

  const headers = buildImageHeaders(key, object);
  if (request.headers.get('if-none-match') === object.httpEtag) {
    return new Response(null, { status: 304, headers });
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
