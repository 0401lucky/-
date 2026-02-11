import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import { getAllUsers } from './kv';
import { maskUserId } from './logging';

export type NotificationType =
  | 'system'
  | 'announcement'
  | 'feedback_reply'
  | 'lottery_win'
  | 'raffle_win';

export interface NotificationItem {
  id: string;
  userId: number;
  type: NotificationType;
  title: string;
  content: string;
  data?: Record<string, unknown>;
  createdAt: number;
  readAt?: number;
}

export interface NotificationListItem extends NotificationItem {
  isRead: boolean;
}

export interface NotificationPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface NotificationListOptions {
  page?: number;
  limit?: number;
  type?: NotificationType;
}

export interface CreateNotificationInput {
  userId: number;
  type: NotificationType;
  title: string;
  content: string;
  data?: Record<string, unknown>;
  createdAt?: number;
}

const NOTIFICATION_ITEM_KEY = (id: string) => `notifications:item:${id}`;
const USER_NOTIFICATION_INDEX_KEY = (userId: number) => `notifications:user:${userId}:index`;
const USER_NOTIFICATION_UNREAD_KEY = (userId: number) => `notifications:user:${userId}:unread`;
const ANNOUNCEMENT_NOTIFIED_KEY = (announcementId: string) =>
  `notifications:announcement:notified:${announcementId}`;

const MAX_PAGE_SIZE = 50;

function normalizePage(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value as number));
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(value as number)));
}

function buildPagination(page: number, limit: number, total: number): NotificationPagination {
  const totalPages = total > 0 ? Math.ceil(total / limit) : 1;
  return {
    page,
    limit,
    total,
    totalPages,
    hasMore: page < totalPages,
  };
}

function sanitizeText(value: string): string {
  return value.trim().slice(0, 5000);
}

export async function createUserNotification(input: CreateNotificationInput): Promise<NotificationItem> {
  const title = sanitizeText(input.title);
  const content = sanitizeText(input.content);

  if (!title) {
    throw new Error('通知标题不能为空');
  }
  if (!content) {
    throw new Error('通知内容不能为空');
  }

  const createdAt = input.createdAt ?? Date.now();
  const id = nanoid(16);

  const item: NotificationItem = {
    id,
    userId: input.userId,
    type: input.type,
    title,
    content,
    data: input.data,
    createdAt,
  };

  await Promise.all([
    kv.set(NOTIFICATION_ITEM_KEY(id), item),
    kv.zadd(USER_NOTIFICATION_INDEX_KEY(input.userId), {
      score: createdAt,
      member: id,
    }),
    kv.sadd(USER_NOTIFICATION_UNREAD_KEY(input.userId), id),
  ]);

  return item;
}

async function getNotificationsByIds(ids: string[]): Promise<NotificationItem[]> {
  if (ids.length === 0) return [];

  const keys = ids.map((id) => NOTIFICATION_ITEM_KEY(id));
  const raw = await kv.mget<(NotificationItem | null)[]>(...keys);
  const map = new Map<string, NotificationItem>();

  for (const item of raw ?? []) {
    if (item && typeof item.id === 'string') {
      map.set(item.id, item);
    }
  }

  const result: NotificationItem[] = [];
  for (const id of ids) {
    const item = map.get(id);
    if (item) {
      result.push(item);
    }
  }

  return result;
}

export async function listUserNotifications(
  userId: number,
  options: NotificationListOptions = {}
): Promise<{
  items: NotificationListItem[];
  unreadCount: number;
  pagination: NotificationPagination;
}> {
  const page = normalizePage(options.page);
  const limit = normalizeLimit(options.limit);

  const allIds = await kv.zrange<string[]>(
    USER_NOTIFICATION_INDEX_KEY(userId),
    0,
    1000,
    { rev: true }
  );

  const itemsAll = await getNotificationsByIds(allIds ?? []);
  const filtered = options.type ? itemsAll.filter((item) => item.type === options.type) : itemsAll;

  const total = filtered.length;
  const start = (page - 1) * limit;
  const paged = filtered.slice(start, start + limit);

  const unreadChecks = await Promise.all(
    paged.map((item) => kv.sismember(USER_NOTIFICATION_UNREAD_KEY(userId), item.id))
  );

  const unreadCount = await kv.scard(USER_NOTIFICATION_UNREAD_KEY(userId));

  const items = paged.map((item, idx) => {
    const isUnread = Number(unreadChecks[idx]) === 1;
    return {
      ...item,
      isRead: !isUnread,
      readAt: item.readAt,
    };
  });

  return {
    items,
    unreadCount: Number(unreadCount) || 0,
    pagination: buildPagination(page, limit, total),
  };
}

export async function markUserNotificationsRead(
  userId: number,
  params: { ids?: string[]; markAll?: boolean } = {}
): Promise<{ updated: number; unreadCount: number }> {
  const uniqueIds = Array.from(
    new Set(
      (params.ids ?? [])
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean)
    )
  );

  let targetIds = uniqueIds;

  if (params.markAll) {
    targetIds = await kv.smembers<string[]>(USER_NOTIFICATION_UNREAD_KEY(userId));
  }

  if (!Array.isArray(targetIds) || targetIds.length === 0) {
    const unread = await kv.scard(USER_NOTIFICATION_UNREAD_KEY(userId));
    return { updated: 0, unreadCount: Number(unread) || 0 };
  }

  const now = Date.now();
  let updated = 0;

  for (const notificationId of targetIds) {
    const existsInUserIndex = await kv.zscore(USER_NOTIFICATION_INDEX_KEY(userId), notificationId);
    if (existsInUserIndex === null) {
      continue;
    }

    const item = await kv.get<NotificationItem>(NOTIFICATION_ITEM_KEY(notificationId));
    if (!item) {
      continue;
    }

    const nextItem: NotificationItem = {
      ...item,
      readAt: item.readAt ?? now,
    };

    await Promise.all([
      kv.set(NOTIFICATION_ITEM_KEY(notificationId), nextItem),
      kv.srem(USER_NOTIFICATION_UNREAD_KEY(userId), notificationId),
    ]);

    updated += 1;
  }

  const unread = await kv.scard(USER_NOTIFICATION_UNREAD_KEY(userId));

  return {
    updated,
    unreadCount: Number(unread) || 0,
  };
}

export async function getUserNotificationUnreadCount(userId: number): Promise<number> {
  const unread = await kv.scard(USER_NOTIFICATION_UNREAD_KEY(userId));
  return Number(unread) || 0;
}

export async function fanoutAnnouncementNotification(announcement: {
  id: string;
  title: string;
  content: string;
}): Promise<{ totalUsers: number; notifiedUsers: number }> {
  const users = await getAllUsers();
  if (users.length === 0) {
    return { totalUsers: 0, notifiedUsers: 0 };
  }

  const dedupeKey = ANNOUNCEMENT_NOTIFIED_KEY(announcement.id);
  let notifiedUsers = 0;

  for (const user of users) {
    const userId = Number(user.id);
    if (!Number.isFinite(userId)) {
      continue;
    }

    try {
      const added = await kv.sadd(dedupeKey, userId);
      if (Number(added) !== 1) {
        continue;
      }

      await createUserNotification({
        userId,
        type: 'announcement',
        title: `系统公告：${announcement.title}`,
        content: announcement.content,
        data: {
          announcementId: announcement.id,
        },
      });

      notifiedUsers += 1;
    } catch (error) {
      try {
        await kv.srem(dedupeKey, userId);
      } catch {
        // ignore rollback error
      }
      console.error('fanoutAnnouncementNotification failed', {
        announcementId: announcement.id,
        userId: maskUserId(userId),
        error,
      });
    }
  }

  await kv.expire(dedupeKey, 180 * 24 * 60 * 60);

  return {
    totalUsers: users.length,
    notifiedUsers,
  };
}
