import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/api-guards';
import { withRateLimit } from '@/lib/rate-limit';
import { getAlertsSnapshot, runAnomalyDetection } from '@/lib/anomaly-detector';

export const dynamic = 'force-dynamic';

export const GET = withAdmin(
  async (request: NextRequest, user) => {
    try {
      const limited = await withRateLimit('admin:alerts', user.id);
      if (limited) return limited;

      const { searchParams } = new URL(request.url);
      const historyLimitRaw = Number(searchParams.get('historyLimit') ?? 50);
      const historyLimit = Number.isFinite(historyLimitRaw) ? historyLimitRaw : 50;
      const runDetect = searchParams.get('detect') === '1';

      const detection = runDetect
        ? await runAnomalyDetection({
            maxUsers: 300,
            concurrency: 6,
          })
        : null;
      const data = await getAlertsSnapshot({ historyLimit });

      return NextResponse.json({
        success: true,
        data: {
          ...data,
          detection,
        },
      });
    } catch (error) {
      console.error('Get alerts error:', error);
      return NextResponse.json(
        { success: false, message: '获取告警列表失败' },
        { status: 500 }
      );
    }
  },
  { forbiddenMessage: '无权限' }
);
