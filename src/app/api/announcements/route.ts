import { NextResponse } from 'next/server';
import { listPublishedAnnouncements } from '@/lib/announcements';
import { ensureAnnouncementNotificationsForUser } from '@/lib/notifications';
import { withUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const GET = withUserRateLimit(
  'announcements:list',
  async (request, user) => {
    try {
      const { searchParams } = new URL(request.url);
      const pageRaw = Number(searchParams.get('page') ?? 1);
      const limitRaw = Number(searchParams.get('limit') ?? 20);
      const page = Number.isFinite(pageRaw) ? pageRaw : 1;
      const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

      const result = await listPublishedAnnouncements({ page, limit });
      await ensureAnnouncementNotificationsForUser(user.id, result.items);

      return NextResponse.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('List announcements error:', error);
      return NextResponse.json({ success: false, message: '获取公告失败' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' }
);
