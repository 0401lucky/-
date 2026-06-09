import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { nanoid } from 'nanoid';
import {
  createUserNotification,
  fanoutAnnouncementNotification,
  getUserNotificationUnreadCount,
  listUserNotifications,
  markUserNotificationsRead,
} from '../notifications';
import { getAllUsers } from '../kv';

vi.mock('@/lib/d1-kv', () => ({
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

  it('paginates grouped notification filters by the filtered total', async () => {
    mockKvZrange.mockResolvedValue(['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
    mockKvMget.mockResolvedValue([
      {
        id: 'n1',
        userId: 1001,
        type: 'lottery_win',
        title: '中奖 1',
        content: '内容',
        createdAt: 6,
      },
      {
        id: 'n2',
        userId: 1001,
        type: 'feedback_reply',
        title: '回复',
        content: '内容',
        createdAt: 5,
      },
      {
        id: 'n3',
        userId: 1001,
        type: 'raffle_win',
        title: '中奖 2',
        content: '内容',
        createdAt: 4,
      },
      {
        id: 'n4',
        userId: 1001,
        type: 'system',
        title: '系统',
        content: '内容',
        createdAt: 3,
      },
      {
        id: 'n5',
        userId: 1001,
        type: 'reward',
        title: '福利',
        content: '内容',
        createdAt: 2,
      },
      {
        id: 'n6',
        userId: 1001,
        type: 'lottery_win',
        title: '中奖 3',
        content: '内容',
        createdAt: 1,
      },
    ]);
    mockKvScard.mockResolvedValue(2);

    const result = await listUserNotifications(1001, {
      page: 2,
      limit: 2,
      filter: 'prize',
    });

    expect(result.items.map((item) => item.id)).toEqual(['n6']);
    expect(result.pagination).toMatchObject({
      page: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
      hasMore: false,
    });
    expect(result.counts).toMatchObject({
      all: 6,
      unread: 2,
      prize: 3,
      reply: 1,
      system: 1,
      redeem: 1,
    });
  });

  it('lists unread notifications with unread pagination total', async () => {
    mockKvZrange.mockResolvedValue(['n1', 'n2', 'n3']);
    mockKvMget.mockResolvedValue([
      {
        id: 'n1',
        userId: 1001,
        type: 'system',
        title: '系统',
        content: '内容',
        createdAt: 3,
      },
      {
        id: 'n2',
        userId: 1001,
        type: 'reward',
        title: '福利',
        content: '内容',
        createdAt: 2,
      },
      {
        id: 'n3',
        userId: 1001,
        type: 'feedback_reply',
        title: '回复',
        content: '内容',
        createdAt: 1,
      },
    ]);
    mockKvScard.mockResolvedValue(1);
    mockKvSmembers.mockResolvedValue(['n2']);

    const result = await listUserNotifications(1001, {
      page: 1,
      limit: 5,
      filter: 'unread',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'n2', isRead: false });
    expect(result.pagination).toMatchObject({
      page: 1,
      total: 1,
      totalPages: 1,
      hasMore: false,
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
      { id: 1001, username: 'alice', firstSeen: 1 },
      { id: 1002, username: 'bob', firstSeen: 1 },
    ] as Array<{ id: number; username: string; firstSeen: number }>);

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
