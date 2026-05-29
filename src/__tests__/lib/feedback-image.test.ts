import { describe, expect, it } from 'vitest';
import {
  MAX_FEEDBACK_VIDEO_BYTES,
  getFeedbackMediaKind,
  isFeedbackVideo,
  normalizeFeedbackImages,
} from '@/lib/feedback-image';

describe('feedback media validation', () => {
  it('支持视频附件并识别媒体类型', () => {
    const media = normalizeFeedbackImages([
      {
        dataUrl: 'data:video/mp4;base64,aGVsbG8=',
        name: 'bug.mp4',
      },
    ]);

    expect(media).toEqual([
      {
        dataUrl: 'data:video/mp4;base64,aGVsbG8=',
        mimeType: 'video/mp4',
        size: 5,
        name: 'bug.mp4',
        kind: 'video',
      },
    ]);
    expect(getFeedbackMediaKind('video/webm')).toBe('video');
    expect(isFeedbackVideo(media[0])).toBe(true);
  });

  it('拒绝超过限制的视频附件', () => {
    const hugeBase64Length = Math.ceil((MAX_FEEDBACK_VIDEO_BYTES + 1024) / 3) * 4;
    const dataUrl = `data:video/mp4;base64,${'A'.repeat(hugeBase64Length)}`;

    expect(() => normalizeFeedbackImages([{ dataUrl }])).toThrow('单个视频不能超过');
  });
});
