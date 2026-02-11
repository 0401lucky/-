import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/api-guards';
import { withRateLimit } from '@/lib/rate-limit';
import { resolveAlertById } from '@/lib/anomaly-detector';

export const dynamic = 'force-dynamic';

interface AlertResolveContext {
  params: Promise<{
    id: string;
  }>;
}

export const POST = withAdmin(
  async (_request: NextRequest, user, context: AlertResolveContext) => {
    try {
      const limited = await withRateLimit('admin:alerts', user.id);
      if (limited) return limited;

      const { id } = await context.params;
      if (!id) {
        return NextResponse.json(
          { success: false, message: '告警 ID 不能为空' },
          { status: 400 }
        );
      }

      await resolveAlertById(id);

      return NextResponse.json({
        success: true,
        message: '告警已处理',
      });
    } catch (error) {
      console.error('Resolve alert error:', error);
      return NextResponse.json(
        { success: false, message: '处理告警失败' },
        { status: 500 }
      );
    }
  },
  { forbiddenMessage: '无权限' }
);
