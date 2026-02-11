import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import {
  createUserNotification,
  fanoutAnnouncementNotification,
  getUserNotificationUnreadCount,
  listUserNotifications,
  markUserNotificationsRead,
} from '../notifications';
import { getAllUsers } from '../kv';

vi.mock('@vercel/kv', () => ({
  kv: {
    set: vi.fn(),
    zadd: vi.fn(),
    sadd: vi.fn(),
    zrange: vi.fn(),
    mget: vi.fn(),
    sismember: vi.fn(),
    scard: vi.fn(),
    zscore: vi.fn(),
    get: vi.fn(),
    srem: vi.fn(),
    smembers: vi.fn(),
    expire: vi.fn(),
  },
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(),
}));

vi.mock('../kv', () => ({
  getAllUsers: vi.fn(),
}));

describe('notifications', () => {
  const mockKvSet = vi.mocked(kv.set);
  const mockKvZadd = vi.mocked(kv.zadd);
  const mockKvSadd = vi.mocked(kv.sadd);
  const mockKvZrange = vi.mocked(kv.zrange);
  const mockKvMget = vi.mocked(kv.mget);
  const mockKvSismember = vi.mocked(kv.sismember);
  const mockKvScard = vi.mocked(kv.scard);
  const mockKvZscore = vi.mocked(kv.zscore);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSrem = vi.mocked(kv.srem);
  const mockKvSmembers = vi.mocked(kv.smembers);
  const mockKvExpire = vi.mocked(kv.expire);

  const mockNanoid = vi.mocked(nanoid);
  const mockGetAllUsers = vi.mocked(getAllUsers);

  beforeEach(() => {
    vi.clearAllMocks();

    mockNanoid.mockReturnValue('notification_1');
    mockKvSet.mockResolvedValue('OK');
    mockKvZadd.mockResolvedValue(1);
    mockKvSadd.mockResolvedValue(1);
    mockKvZrange.mockResolvedValue([]);
    mockKvMget.mockResolvedValue([]);
    mockKvSismember.mockResolvedValue(0);
    mockKvScard.mockResolvedValue(0);
    mockKvZscore.mockResolvedValue(1);
    mockKvGet.mockResolvedValue(null);
    mockKvSrem.mockResolvedValue(1);
    mockKvSmembers.mockResolvedValue([]);
    mockKvExpire.mockResolvedValue(1);
    mockGetAllUsers.mockResolvedValue([]);
  });

  it('creates notification and lists unread status correctly', async () => {
    await createUserNotification({
      userId: 1001,
      type: 'feedback_reply',
      title: '反馈收到新回复',
      content: '管理员回复了你的反馈',
      createdAt: 1700000000000,
    });

    expect(mockKvSet).toHaveBeenCalledWith(
      'notifications:item:notification_1',
      expect.objectContaining({
        id: 'notification_1',
        userId: 1001,
        type: 'feedback_reply',
      })
    );
    expect(mockKvZadd).toHaveBeenCalledWith('notifications:user:1001:index', {
      score: 1700000000000,
      member: 'notification_1',
    });
    expect(mockKvSadd).toHaveBeenCalledWith('notifications:user:1001:unread', 'notification_1');

    mockKvZrange.mockResolvedValue(['notification_1']);
    mockKvMget.mockResolvedValue([
      {
        id: 'notification_1',
        userId: 1001,
        type: 'feedback_reply',
        title: '反馈收到新回复',
        content: '管理员回复了你的反馈',
        createdAt: 1700000000000,
      },
    ]);
    mockKvSismember.mockResolvedValue(1);
    mockKvScard.mockResolvedValue(1);

    const listResult = await listUserNotifications(1001, { page: 1, limit: 20 });

    expect(listResult.unreadCount).toBe(1);
    expect(listResult.items).toHaveLength(1);
    expect(listResult.items[0]).toMatchObject({
      id: 'notification_1',
      isRead: false,
    });
  });

  it('marks notifications as read and returns remaining unread count', async () => {
    mockKvGet.mockResolvedValue({
      id: 'notification_1',
      userId: 1001,
      type: 'announcement',
      title: '系统公告',
      content: '公告内容',
      createdAt: 1700000000000,
    });
    mockKvScard.mockResolvedValue(0);

    const result = await markUserNotificationsRead(1001, { ids: ['notification_1'] });

    expect(mockKvZscore).toHaveBeenCalledWith('notifications:user:1001:index', 'notification_1');
    expect(mockKvSrem).toHaveBeenCalledWith('notifications:user:1001:unread', 'notification_1');
    expect(result).toEqual({ updated: 1, unreadCount: 0 });

    const unread = await getUserNotificationUnreadCount(1001);
    expect(unread).toBe(0);
  });

  it('fans out announcement notification to all users once', async () => {
    mockGetAllUsers.mockResolvedValue([
      { id: 1001, username: 'alice' },
      { id: 1002, username: 'bob' },
    ] as Array<{ id: number; username: string }>);

    mockNanoid
      .mockReturnValueOnce('notification_a')
      .mockReturnValueOnce('notification_b');

    const result = await fanoutAnnouncementNotification({
      id: 'announcement_1',
      title: '系统维护',
      content: '今晚 23:00 将进行维护',
    });

    expect(result).toEqual({ totalUsers: 2, notifiedUsers: 2 });
    expect(mockKvSadd).toHaveBeenCalledWith('notifications:announcement:notified:announcement_1', 1001);
    expect(mockKvSadd).toHaveBeenCalledWith('notifications:announcement:notified:announcement_1', 1002);
    expect(mockKvExpire).toHaveBeenCalledWith('notifications:announcement:notified:announcement_1', 180 * 24 * 60 * 60);
  });
});
