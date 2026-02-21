import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/api-guards';
import { withRateLimit } from '@/lib/rate-limit';
import { getRewardBatch } from '@/lib/rewards';

export const dynamic = 'force-dynamic';

// GET: 查询批次详情
export const GET = withAdmin(
  async (
    request: NextRequest,
    user,
    context: { params: Promise<{ batchId: string }> }
  ) => {
    try {
      const limited = await withRateLimit('admin:rewards', user.id);
      if (limited) return limited;

      const { batchId } = await context.params;
      if (!batchId) {
        return NextResponse.json(
          { success: false, message: '缺少批次 ID' },
          { status: 400 }
        );
      }

      const batch = await getRewardBatch(batchId);
      if (!batch) {
        return NextResponse.json(
          { success: false, message: '批次不存在' },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, data: batch });
    } catch (error) {
      console.error('Admin get reward batch error:', error);
      return NextResponse.json({ success: false, message: '获取批次详情失败' }, { status: 500 });
    }
  },
  { forbiddenMessage: '无权限' }
);
