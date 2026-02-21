import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { getNotificationById } from '@/lib/notifications';
import { claimReward } from '@/lib/rewards';

export const dynamic = 'force-dynamic';

// POST: 用户领取奖励
export const POST = withUserRateLimit(
  'rewards:claim',
  async (request: NextRequest, user) => {
    try {
      const body = (await request.json().catch(() => null)) as {
        notificationId?: unknown;
      } | null;

      const notificationId = typeof body?.notificationId === 'string'
        ? body.notificationId.trim()
        : '';

      if (!notificationId) {
        return NextResponse.json(
          { success: false, message: '缺少通知 ID' },
          { status: 400 }
        );
      }

      // 验证通知存在
      const notification = await getNotificationById(notificationId);
      if (!notification) {
        return NextResponse.json(
          { success: false, message: '通知不存在' },
          { status: 404 }
        );
      }

      // 验证通知属于当前用户
      if (notification.userId !== user.id) {
        return NextResponse.json(
          { success: false, message: '无权操作此通知' },
          { status: 403 }
        );
      }

      // 验证是奖励通知
      if (notification.type !== 'reward') {
        return NextResponse.json(
          { success: false, message: '此通知不是奖励通知' },
          { status: 400 }
        );
      }

      const result = await claimReward(user.id, notificationId, notification);

      return NextResponse.json({
        success: result.success,
        message: result.message,
        data: { claimStatus: result.claimStatus },
      }, { status: result.success ? 200 : 400 });
    } catch (error) {
      console.error('Claim reward error:', error);
      return NextResponse.json(
        { success: false, message: '领取失败，请稍后重试' },
        { status: 500 }
      );
    }
  }
);
