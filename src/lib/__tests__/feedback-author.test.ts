import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachFeedbackAuthorProfile } from '@/lib/feedback-author';
import { getCustomUserProfile } from '@/lib/user-profile';
import { getEquippedAchievementForUser } from '@/lib/user-achievements';

vi.mock('@/lib/user-profile', () => ({
  getCustomUserProfile: vi.fn(),
}));

vi.mock('@/lib/user-achievements', () => ({
  getEquippedAchievementForUser: vi.fn(),
}));

describe('attachFeedbackAuthorProfile', () => {
  const mockGetCustomUserProfile = vi.mocked(getCustomUserProfile);
  const mockGetEquippedAchievementForUser = vi.mocked(getEquippedAchievementForUser);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEquippedAchievementForUser.mockResolvedValue(null);
  });

  it('使用用户最新自定义昵称和头像', async () => {
    mockGetCustomUserProfile.mockResolvedValue({
      displayName: '新的昵称',
      avatarUrl: 'https://example.com/avatar.png',
    });

    const result = await attachFeedbackAuthorProfile({
      id: 'fb-1',
      userId: 1,
      username: 'old-name',
      status: 'open',
      createdAt: 1,
      updatedAt: 1,
    });

    expect(result.displayName).toBe('新的昵称');
    expect(result.avatarUrl).toBe('https://example.com/avatar.png');
    expect(result.equippedAchievement).toBeNull();
  });

  it('未设置自定义昵称时回退到反馈记录用户名', async () => {
    mockGetCustomUserProfile.mockResolvedValue({});

    const result = await attachFeedbackAuthorProfile({
      id: 'fb-2',
      userId: 2,
      username: 'origin-name',
      status: 'processing',
      createdAt: 1,
      updatedAt: 1,
    });

    expect(result.displayName).toBe('origin-name');
    expect(result.avatarUrl).toBeNull();
  });

  it('附加用户当前佩戴的成就', async () => {
    mockGetCustomUserProfile.mockResolvedValue({});
    mockGetEquippedAchievementForUser.mockResolvedValue({
      id: 'contributor',
      emoji: '🤝',
      name: '奉献者',
      desc: '提出 10 条或以上有用反馈后，由管理员颁发',
    });

    const result = await attachFeedbackAuthorProfile({
      id: 'fb-3',
      userId: 3,
      username: 'helper',
      status: 'resolved',
      createdAt: 1,
      updatedAt: 1,
    });

    expect(result.equippedAchievement?.name).toBe('奉献者');
  });
});
