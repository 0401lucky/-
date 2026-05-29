import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, HEAD } from '@/app/api/feedback/images/[...path]/route';

const r2Mocks = vi.hoisted(() => ({
  head: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => ({
    env: {
      FEEDBACK_IMAGES: {
        head: r2Mocks.head,
        get: r2Mocks.get,
      },
    },
  }),
}));

function streamOf(bytes: number[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

describe('feedback image route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serves range requests without fetching the full object first', async () => {
    r2Mocks.head.mockResolvedValueOnce({
      httpMetadata: { contentType: 'video/mp4' },
      size: 100,
      httpEtag: '"clip-etag"',
      uploaded: new Date('2026-05-20T00:00:00Z'),
    });
    r2Mocks.get.mockResolvedValueOnce({
      body: streamOf([1, 2, 3]),
      httpMetadata: { contentType: 'video/mp4' },
      size: 10,
    });

    const response = await GET(
      new NextRequest('http://localhost/api/feedback/images/feedback/20260520/user/clip.mp4', {
        headers: { Range: 'bytes=10-19' },
      }),
      { params: Promise.resolve({ path: ['feedback', '20260520', 'user', 'clip.mp4'] }) }
    );

    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 10-19/100');
    expect(response.headers.get('Content-Length')).toBe('10');
    expect(r2Mocks.head).toHaveBeenCalledWith('feedback/20260520/user/clip.mp4');
    expect(r2Mocks.get).toHaveBeenCalledTimes(1);
    expect(r2Mocks.get).toHaveBeenCalledWith('feedback/20260520/user/clip.mp4', {
      range: { offset: 10, length: 10 },
    });
  });

  it('serves HEAD requests from metadata only', async () => {
    r2Mocks.head.mockResolvedValueOnce({
      httpMetadata: { contentType: 'image/png' },
      size: 42,
      httpEtag: '"image-etag"',
    });

    const response = await HEAD(
      new NextRequest('http://localhost/api/feedback/images/feedback/20260520/user/img.png'),
      { params: Promise.resolve({ path: ['feedback', '20260520', 'user', 'img.png'] }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe('42');
    expect(r2Mocks.head).toHaveBeenCalledWith('feedback/20260520/user/img.png');
    expect(r2Mocks.get).not.toHaveBeenCalled();
  });
});
