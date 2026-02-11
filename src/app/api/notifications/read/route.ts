import { NextRequest, NextResponse } from 'next/server';
import { markUserNotificationsRead } from '@/lib/notifications';
import { withUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = withUserRateLimit(
  'notifications:read',
  async (request: NextRequest, user) => {
    try {
      const body = (await request.json().catch(() => null)) as {
        ids?: unknown;
        markAll?: unknown;
      } | null;

      const markAll = body?.markAll === true;
      const ids = Array.isArray(body?.ids)
        ? body?.ids.filter((item): item is string => typeof item === 'string')
        : [];

      if (!markAll && ids.length === 0) {
        return NextResponse.json(
          { success: false, message: '请提供需要标记的通知 ID' },
          { status: 400 }
        );
      }

      const result = await markUserNotificationsRead(user.id, { ids, markAll });

      return NextResponse.json({
        success: true,
        message: '标记已读成功',
        data: result,
      });
    } catch (error) {
      console.error('Mark notifications read error:', error);
      return NextResponse.json({ success: false, message: '标记已读失败' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' }
);
