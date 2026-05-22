import { NextRequest, NextResponse } from 'next/server';
import { deleteUserNotifications } from '@/lib/notifications';
import { withUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export const POST = withUserRateLimit(
  'notifications:delete',
  async (request: NextRequest, user) => {
    try {
      const body = (await request.json().catch(() => null)) as {
        ids?: unknown;
      } | null;

      const ids = Array.isArray(body?.ids)
        ? body!.ids.filter((item): item is string => typeof item === 'string')
        : [];

      if (ids.length === 0) {
        return NextResponse.json(
          { success: false, message: '请提供需要删除的通知 ID' },
          { status: 400 }
        );
      }

      const result = await deleteUserNotifications(user.id, ids);

      if (result.deleted === 0) {
        return NextResponse.json(
          { success: false, message: '仅可删除已读通知' },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        message: '通知已删除',
        data: result,
      });
    } catch (error) {
      console.error('Delete notifications error:', error);
      return NextResponse.json({ success: false, message: '删除通知失败' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' }
);
