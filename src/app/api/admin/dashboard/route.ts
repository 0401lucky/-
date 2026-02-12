import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/api-guards';
import { withRateLimit } from '@/lib/rate-limit';
import {
  getDashboardOverview,
  runAnomalyDetection,
  getAlertsSnapshot,
} from '@/lib/anomaly-detector';

export const dynamic = 'force-dynamic';

export const GET = withAdmin(
  async (request: NextRequest, user) => {
    try {
      const limited = await withRateLimit('admin:dashboard', user.id);
      if (limited) return limited;

      const { searchParams } = new URL(request.url);
      const runDetect = searchParams.get('detect') !== '0';

      const detection = runDetect
        ? await runAnomalyDetection({
            maxUsers: 300,
            concurrency: 6,
          })
        : null;
      const [dashboard, alerts] = await Promise.all([
        getDashboardOverview(),
        getAlertsSnapshot({ historyLimit: 20 }),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          dashboard,
          alerts,
          detection,
        },
      });
    } catch (error) {
      console.error('Get admin dashboard error:', error);
      return NextResponse.json(
        { success: false, message: '获取管理仪表盘失败' },
        { status: 500 }
      );
    }
  },
  { forbiddenMessage: '无权限' }
);
