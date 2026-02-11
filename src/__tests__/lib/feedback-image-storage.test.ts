import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { put } from '@vercel/blob';
import { externalizeFeedbackImages } from '@/lib/feedback-image-storage';

vi.mock('@vercel/blob', () => ({
  put: vi.fn(),
}));

describe('externalizeFeedbackImages', () => {
  const mockPut = vi.mocked(put);
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BLOB_READ_WRITE_TOKEN = 'blob-test-token';
  });

  afterAll(() => {
    process.env.BLOB_READ_WRITE_TOKEN = originalToken;
  });

  it('会把 base64 图片上传并替换为外链 URL', async () => {
    mockPut.mockResolvedValue({
      url: 'https://blob.vercel-storage.com/feedback/abc.png',
    } as Awaited<ReturnType<typeof put>>);

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

    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut).toHaveBeenCalledWith(
      expect.stringMatching(/^feedback\/\d{8}\/user\//),
      expect.any(Buffer),
      expect.objectContaining({
        access: 'public',
        addRandomSuffix: true,
        contentType: 'image/png',
        token: 'blob-test-token',
      })
    );
    expect(result[0].dataUrl).toBe('https://blob.vercel-storage.com/feedback/abc.png');
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

    expect(mockPut).not.toHaveBeenCalled();
    expect(result[0]).toEqual(image);
  });

  it('缺少 token 时会报错', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;

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
    ).rejects.toThrow('未配置 BLOB_READ_WRITE_TOKEN');
  });
});
