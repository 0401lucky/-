import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addFeedbackMessage, updateFeedbackStatus } from '../feedback';
import { createUserNotification } from '../notifications';

const mocks = vi.hoisted(() => ({
  kv: {
    get: vi.fn(),
    lpush: vi.fn(),
    set: vi.fn(),
    zadd: vi.fn(),
    zrem: vi.fn(),
  },
}));

vi.mock('@/lib/d1-kv', () => ({
  kv: mocks.kv,
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'message-id'),
}));

vi.mock('@/lib/feedback-image-storage', () => ({
  externalizeFeedbackImages: vi.fn(async () => []),
}));

vi.mock('../notifications', () => ({
  createUserNotification: vi.fn(async () => undefined),
}));

describe('feedback notifications', () => {
  const mockCreateUserNotification = vi.mocked(createUserNotification);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.kv.lpush.mockResolvedValue(1);
    mocks.kv.set.mockResolvedValue('OK');
    mocks.kv.zadd.mockResolvedValue(1);
    mocks.kv.zrem.mockResolvedValue(1);
  });

  it('notifies feedback owner when admin replies and status changes', async () => {
    mocks.kv.get.mockResolvedValue({
      id: 'fb-1',
      userId: 10,
      username: 'owner',
      status: 'open',
      createdAt: 1,
      updatedAt: 1,
    });

    await addFeedbackMessage('fb-1', 'admin', '我们已经收到，会尽快处理', 'admin');

    expect(mockCreateUserNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 10,
        type: 'feedback_reply',
        title: '反馈收到管理员回复',
        data: expect.objectContaining({
          feedbackId: 'fb-1',
          kind: 'admin_reply',
        }),
      })
    );
    expect(mockCreateUserNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 10,
        type: 'feedback_status',
        title: '反馈状态已更新',
        data: expect.objectContaining({
          feedbackId: 'fb-1',
          previousStatus: 'open',
          status: 'processing',
        }),
      })
    );
  });

  it('notifies feedback owner when another user comments', async () => {
    mocks.kv.get.mockResolvedValue({
      id: 'fb-2',
      userId: 10,
      username: 'owner',
      status: 'processing',
      createdAt: 1,
      updatedAt: 1,
    });

    await addFeedbackMessage('fb-2', 'user', '我也遇到了这个问题', 'other-user');

    expect(mockCreateUserNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateUserNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 10,
        type: 'feedback_reply',
        title: '反馈收到新评论',
        data: expect.objectContaining({
          feedbackId: 'fb-2',
          kind: 'user_comment',
        }),
      })
    );
  });

  it('does not notify when owner comments on own feedback', async () => {
    mocks.kv.get.mockResolvedValue({
      id: 'fb-3',
      userId: 10,
      username: 'owner',
      status: 'processing',
      createdAt: 1,
      updatedAt: 1,
    });

    await addFeedbackMessage('fb-3', 'user', '补充一下复现步骤', 'owner');

    expect(mockCreateUserNotification).not.toHaveBeenCalled();
  });

  it('notifies feedback owner when status is updated explicitly', async () => {
    mocks.kv.get.mockResolvedValue({
      id: 'fb-4',
      userId: 10,
      username: 'owner',
      status: 'processing',
      createdAt: 1,
      updatedAt: 1,
    });

    await updateFeedbackStatus('fb-4', 'resolved');

    expect(mockCreateUserNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 10,
        type: 'feedback_status',
        title: '反馈状态已更新',
        data: expect.objectContaining({
          feedbackId: 'fb-4',
          previousStatus: 'processing',
          status: 'resolved',
        }),
      })
    );
  });
});
