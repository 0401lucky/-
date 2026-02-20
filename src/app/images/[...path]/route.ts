// src/app/images/[...path]/route.ts
// 从 R2 提供卡牌图片服务

import { NextRequest, NextResponse } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  const key = segments.map(decodeURIComponent).join('/');

  const { env } = getCloudflareContext();
  const bucket = (env as unknown as Record<string, unknown>).CARD_IMAGES as
    | { get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null> }
    | undefined;

  if (!bucket) {
    return NextResponse.json({ error: 'R2 not available' }, { status: 503 });
  }

  const object = await bucket.get(key);
  if (!object) {
    return new NextResponse(null, { status: 404 });
  }

  const ext = key.substring(key.lastIndexOf('.'));
  const contentType =
    object.httpMetadata?.contentType || MIME_TYPES[ext] || 'application/octet-stream';

  return new NextResponse(object.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
