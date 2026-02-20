import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { externalizeFeedbackImages } from '@/lib/feedback-image-storage';

// Mock getCloudflareContext to provide a fake R2 binding
const mockR2Put = vi.fn();
const mockGetCloudflareContext = vi.fn(() => ({
  env: {
    FEEDBACK_IMAGES: {
      put: mockR2Put,
    },
  },
}));

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: (...args: unknown[]) => mockGetCloudflareContext(...args),
}));

describe('externalizeFeedbackImages', () => {
  const originalR2Url = process.env.R2_PUBLIC_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.R2_PUBLIC_URL = 'https://r2.example.com';
  });

  afterAll(() => {
    process.env.R2_PUBLIC_URL = originalR2Url;
  });

  it('会把 base64 图片上传并替换为外链 URL', async () => {
    mockR2Put.mockResolvedValue(undefined);

    const result = await externalizeFeedbackImages(
      [
        {
          dataUrl: 'data:image/png;base64,aGVsbG8=',
          mimeType: 'image/png',
          size: 5,
          name: 'test.png',
        },
      ],
      {
        feedbackId: 'fb-1',
        messageId: 'msg-1',
        role: 'user',
      }
    );

    expect(mockR2Put).toHaveBeenCalledTimes(1);
    const [pathname, body, opts] = mockR2Put.mock.calls[0];
    expect(pathname).toMatch(/^feedback\/\d{8}\/user\//);
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(opts).toEqual(
      expect.objectContaining({
        httpMetadata: { contentType: 'image/png' },
      })
    );
    expect(result[0].dataUrl).toMatch(/^https:\/\/r2\.example\.com\/feedback\//);
    expect(result[0].size).toBe(5);
  });

  it('非 dataUrl 图片不会重复上传', async () => {
    const image = {
      dataUrl: 'https://example.com/already-uploaded.png',
      mimeType: 'image/png',
      size: 123,
      name: 'already-uploaded.png',
    };

    const result = await externalizeFeedbackImages([image], {
      feedbackId: 'fb-2',
      messageId: 'msg-2',
      role: 'admin',
    });

    expect(mockR2Put).not.toHaveBeenCalled();
    expect(result[0]).toEqual(image);
  });

  it('缺少 R2 binding 时会报错', async () => {
    // Temporarily override the mock to return no binding
    mockGetCloudflareContext.mockReturnValueOnce({ env: {} });

    await expect(
      externalizeFeedbackImages(
        [
          {
            dataUrl: 'data:image/png;base64,aGVsbG8=',
            mimeType: 'image/png',
            size: 5,
          },
        ],
        {
          feedbackId: 'fb-3',
          messageId: 'msg-3',
          role: 'user',
        }
      )
    ).rejects.toThrow('R2 binding FEEDBACK_IMAGES not available');
  });
});
