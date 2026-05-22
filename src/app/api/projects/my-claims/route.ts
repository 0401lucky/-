import { NextResponse } from 'next/server';
import { getUserAllClaims } from '@/lib/kv';
import { withUserRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/projects/my-claims
 * 返回当前登录用户已领取的项目 ID 集合，用于前端公告栏过滤已领取的免费福利。
 * 复用 getUserAllClaims（已批量 mget，避免 N+1）。
 */
export const GET = withUserRateLimit(
  'projects:my-claims',
  async (_request, user) => {
    try {
      const records = await getUserAllClaims(user.id);
      const projectIds = records
        .map((record) => record.projectId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);

      return NextResponse.json({
        success: true,
        data: { projectIds },
      });
    } catch (error) {
      console.error('Get my claims error:', error);
      return NextResponse.json(
        { success: false, message: '获取领取记录失败' },
        { status: 500 }
      );
    }
  },
  { unauthorizedMessage: '请先登录' }
);
