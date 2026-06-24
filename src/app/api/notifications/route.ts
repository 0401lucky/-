import { NextResponse } from 'next/server';
import { listPublishedAnnouncements } from '@/lib/announcements';
import {
  ensureAnnouncementNotificationsForUser,
  listUserNotifications,
  type NotificationFilter,
  type NotificationType,
} from '@/lib/notifications';
import { withUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const NOTIFICATION_TYPES = new Set<NotificationType>([
  'system',
  'announcement',
  'feedback_reply',
  'feedback_status',
  'lottery_win',
  'raffle_win',
  'wallet',
  'reward',
]);

const NOTIFICATION_FILTERS = new Set<NotificationFilter>([
  'all',
  'unread',
  'prize',
  'reply',
  'system',
  'redeem',
]);

function parseNotificationType(value: string | null): NotificationType | undefined {
  if (!value || value === 'all') return undefined;
  return NOTIFICATION_TYPES.has(value as NotificationType) ? (value as NotificationType) : undefined;
}

function parseNotificationFilter(value: string | null): NotificationFilter | undefined {
  if (!value) return undefined;
  return NOTIFICATION_FILTERS.has(value as NotificationFilter) ? (value as NotificationFilter) : undefined;
}

export const GET = withUserRateLimit(
  'notifications:list',
  async (request, user) => {
    try {
      const { searchParams } = new URL(request.url);
      const pageRaw = Number(searchParams.get('page') ?? 1);
      const limitRaw = Number(searchParams.get('limit') ?? 20);
      const typeRaw = searchParams.get('type');
      const filterRaw = searchParams.get('filter');

      const page = Number.isFinite(pageRaw) ? pageRaw : 1;
      const limit = Number.isFinite(limitRaw) ? limitRaw : 20;
      const type = parseNotificationType(typeRaw);
      const filter = parseNotificationFilter(filterRaw);

      if (!type || type === 'announcement' || filter === 'system' || filter === 'all' || filter === 'unread') {
        const recentAnnouncements = await listPublishedAnnouncements({ page: 1, limit: 50 });
        await ensureAnnouncementNotificationsForUser(user.id, recentAnnouncements.items);
      }

      const result = await listUserNotifications(user.id, {
        page,
        limit,
        type,
        filter,
      });

      return NextResponse.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('List notifications error:', error);
      return NextResponse.json({ success: false, message: '获取通知失败' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' }
);
