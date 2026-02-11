import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import {
  archiveAnnouncement,
  createAnnouncement,
  listAnnouncementsForAdmin,
  listPublishedAnnouncements,
  updateAnnouncement,
} from '../announcements';
import { fanoutAnnouncementNotification } from '../notifications';

vi.mock('@vercel/kv', () => ({
  kv: {
    set: vi.fn(),
    get: vi.fn(),
    zadd: vi.fn(),
    zrem: vi.fn(),
    zrange: vi.fn(),
    mget: vi.fn(),
    zcard: vi.fn(),
  },
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(),
}));

vi.mock('../notifications', () => ({
  fanoutAnnouncementNotification: vi.fn(),
}));

describe('announcements', () => {
  const mockKvSet = vi.mocked(kv.set);
  const mockKvGet = vi.mocked(kv.get);
  const mockKvZadd = vi.mocked(kv.zadd);
  const mockKvZrem = vi.mocked(kv.zrem);
  const mockKvZrange = vi.mocked(kv.zrange);
  const mockKvMget = vi.mocked(kv.mget);
  const mockKvZcard = vi.mocked(kv.zcard);

  const mockNanoid = vi.mocked(nanoid);
  const mockFanout = vi.mocked(fanoutAnnouncementNotification);

  beforeEach(() => {
    vi.clearAllMocks();

    mockNanoid.mockReturnValue('announcement_1');
    mockKvSet.mockResolvedValue('OK');
    mockKvGet.mockResolvedValue(null);
    mockKvZadd.mockResolvedValue(1);
    mockKvZrem.mockResolvedValue(1);
    mockKvZrange.mockResolvedValue([]);
    mockKvMget.mockResolvedValue([]);
    mockKvZcard.mockResolvedValue(0);
    mockFanout.mockResolvedValue({ totalUsers: 0, notifiedUsers: 0 });
  });

  it('creates published announcement and fanouts notifications', async () => {
    mockFanout.mockResolvedValue({ totalUsers: 2, notifiedUsers: 2 });

    const result = await createAnnouncement(
      {
        title: '系统公告',
        content: '测试内容',
        status: 'published',
      },
      { id: 1, username: 'admin' }
    );

    expect(result.notifiedUsers).toBe(2);
    expect(result.announcement.status).toBe('published');
    expect(mockKvSet).toHaveBeenCalledWith(
      'announcement:item:announcement_1',
      expect.objectContaining({
        id: 'announcement_1',
        title: '系统公告',
      })
    );
    expect(mockKvZadd).toHaveBeenCalledWith('announcement:index:all', expect.any(Object));
    expect(mockKvZadd).toHaveBeenCalledWith('announcement:index:published', expect.any(Object));
    expect(mockFanout).toHaveBeenCalledWith({
      id: 'announcement_1',
      title: '系统公告',
      content: '测试内容',
    });
  });

  it('publishes draft announcement and triggers fanout once', async () => {
    mockKvGet.mockResolvedValue({
      id: 'announcement_2',
      title: '草稿公告',
      content: 'draft',
      status: 'draft',
      createdAt: 1,
      updatedAt: 1,
      createdById: 1,
      createdBy: 'admin',
      updatedById: 1,
      updatedBy: 'admin',
    });
    mockFanout.mockResolvedValue({ totalUsers: 3, notifiedUsers: 3 });

    const result = await updateAnnouncement(
      'announcement_2',
      {
        status: 'published',
        title: '正式公告',
      },
      { id: 2, username: 'admin2' }
    );

    expect(result?.announcement.status).toBe('published');
    expect(result?.notifiedUsers).toBe(3);
    expect(mockKvZadd).toHaveBeenCalledWith('announcement:index:published', expect.any(Object));
    expect(mockFanout).toHaveBeenCalledTimes(1);
  });

  it('archives announcement and removes published index', async () => {
    mockKvGet.mockResolvedValue({
      id: 'announcement_3',
      title: '旧公告',
      content: 'content',
      status: 'published',
      createdAt: 1,
      updatedAt: 1,
      publishedAt: 1,
      createdById: 1,
      createdBy: 'admin',
      updatedById: 1,
      updatedBy: 'admin',
    });

    const archived = await archiveAnnouncement('announcement_3', {
      id: 1,
      username: 'admin',
    });

    expect(archived?.status).toBe('archived');
    expect(mockKvZrem).toHaveBeenCalledWith('announcement:index:published', 'announcement_3');
  });

  it('lists admin and published announcements', async () => {
    const announcement = {
      id: 'announcement_4',
      title: '公告',
      content: '内容',
      status: 'published' as const,
      createdAt: 1,
      updatedAt: 2,
      publishedAt: 2,
      createdById: 1,
      createdBy: 'admin',
      updatedById: 1,
      updatedBy: 'admin',
    };

    mockKvZrange
      .mockResolvedValueOnce(['announcement_4'])
      .mockResolvedValueOnce(['announcement_4']);
    mockKvMget
      .mockResolvedValueOnce([announcement])
      .mockResolvedValueOnce([announcement]);
    mockKvZcard.mockResolvedValue(1);

    const adminList = await listAnnouncementsForAdmin({ page: 1, limit: 20, status: 'all' });
    const publishedList = await listPublishedAnnouncements({ page: 1, limit: 20 });

    expect(adminList.items).toHaveLength(1);
    expect(publishedList.items).toHaveLength(1);
  });
});
