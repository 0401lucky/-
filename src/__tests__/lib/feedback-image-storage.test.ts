import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  getCloudflareContext: (...args: unknown[]) => mockGetCloudflareContext(...(args as [])),
}));

describe('externalizeFeedbackImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('R2_PUBLIC_URL', 'https://r2.example.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('未配置 R2_PUBLIC_URL 时会返回站内图片读取路径', async () => {
    vi.stubEnv('R2_PUBLIC_URL', '');
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
    expect(result[0].dataUrl).toMatch(/^\/api\/feedback\/images\/feedback\/\d{8}\/user\//);
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

  it('缺少 R2 binding 时保留内联图片，避免阻断反馈提交', async () => {
    mockGetCloudflareContext.mockReturnValueOnce({ env: {} } as ReturnType<typeof mockGetCloudflareContext>);

    const image = {
      dataUrl: 'data:image/png;base64,aGVsbG8=',
      mimeType: 'image/png',
      size: 5,
      name: 'local.png',
    };

    const result = await externalizeFeedbackImages([image], {
      feedbackId: 'fb-3',
      messageId: 'msg-3',
      role: 'user',
    });

    expect(mockR2Put).not.toHaveBeenCalled();
    expect(result[0]).toEqual(image);
  });

  it('Cloudflare 上下文读取失败时保留内联图片', async () => {
    mockGetCloudflareContext.mockImplementationOnce(() => {
      throw new Error('context unavailable');
    });

    const image = {
      dataUrl: 'data:image/png;base64,aGVsbG8=',
      mimeType: 'image/png',
      size: 5,
      name: 'context.png',
    };

    const result = await externalizeFeedbackImages([image], {
      feedbackId: 'fb-4',
      messageId: 'msg-4',
      role: 'user',
    });

    expect(mockR2Put).not.toHaveBeenCalled();
    expect(result[0]).toEqual(image);
  });

  it('R2 上传失败时保留内联图片', async () => {
    mockR2Put.mockRejectedValueOnce(new Error('upload failed'));

    const image = {
      dataUrl: 'data:image/png;base64,aGVsbG8=',
      mimeType: 'image/png',
      size: 5,
      name: 'upload.png',
    };

    const result = await externalizeFeedbackImages([image], {
      feedbackId: 'fb-5',
      messageId: 'msg-5',
      role: 'user',
    });

    expect(mockR2Put).toHaveBeenCalledTimes(1);
    expect(result[0]).toEqual(image);
  });

  it('生产环境缺少 R2 binding 时同样不阻断反馈提交', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockGetCloudflareContext.mockReturnValueOnce({ env: {} } as ReturnType<typeof mockGetCloudflareContext>);

    const image = {
      dataUrl: 'data:image/png;base64,aGVsbG8=',
      mimeType: 'image/png',
      size: 5,
    };

    const result = await externalizeFeedbackImages([image], {
      feedbackId: 'fb-6',
      messageId: 'msg-6',
      role: 'user',
    });

    expect(mockR2Put).not.toHaveBeenCalled();
    expect(result[0]).toEqual(image);
  });
});
