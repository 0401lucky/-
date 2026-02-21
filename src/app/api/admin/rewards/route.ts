import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/api-guards';
import { withRateLimit } from '@/lib/rate-limit';
import { createAndDistributeRewardBatch, listRewardBatches } from '@/lib/rewards';

export const dynamic = 'force-dynamic';

// POST: 创建并分发奖励批次
export const POST = withAdmin(
  async (request: NextRequest, user) => {
    try {
      const limited = await withRateLimit('admin:rewards', user.id);
      if (limited) return limited;

      const body = (await request.json().catch(() => null)) as {
        type?: unknown;
        amount?: unknown;
        targetMode?: unknown;
        targetUserIds?: unknown;
        title?: unknown;
        message?: unknown;
      } | null;

      const type = body?.type === 'points' || body?.type === 'quota' ? body.type : null;
      if (!type) {
        return NextResponse.json(
          { success: false, message: '奖励类型无效，必须为 points 或 quota' },
          { status: 400 }
        );
      }

      const amount = typeof body?.amount === 'number' ? body.amount : NaN;
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json(
          { success: false, message: '奖励数量必须为正数' },
          { status: 400 }
        );
      }

      const targetMode = body?.targetMode === 'all' || body?.targetMode === 'selected'
        ? body.targetMode
        : null;
      if (!targetMode) {
        return NextResponse.json(
          { success: false, message: '发放范围无效' },
          { status: 400 }
        );
      }

      let targetUserIds: number[] | undefined;
      if (targetMode === 'selected') {
        if (!Array.isArray(body?.targetUserIds) || body.targetUserIds.length === 0) {
          return NextResponse.json(
            { success: false, message: '指定用户模式必须提供目标用户列表' },
            { status: 400 }
          );
        }
        targetUserIds = body.targetUserIds
          .map((id: unknown) => Number(id))
          .filter((id: number) => Number.isFinite(id) && id > 0);
        if (targetUserIds.length === 0) {
          return NextResponse.json(
            { success: false, message: '目标用户 ID 无效' },
            { status: 400 }
          );
        }
      }

      const title = typeof body?.title === 'string' ? body.title.trim() : '';
      const message = typeof body?.message === 'string' ? body.message.trim() : '';

      if (!title) {
        return NextResponse.json(
          { success: false, message: '通知标题不能为空' },
          { status: 400 }
        );
      }
      if (!message) {
        return NextResponse.json(
          { success: false, message: '通知内容不能为空' },
          { status: 400 }
        );
      }

      const batch = await createAndDistributeRewardBatch({
        type,
        amount,
        targetMode,
        targetUserIds,
        title,
        message,
        createdBy: user.username,
      });

      const responseMessage = batch.status === 'completed'
        ? '奖励发放完成'
        : `奖励发放已完成（部分失败：${batch.totalTargets - batch.distributedCount}）`;

      return NextResponse.json(
        { success: true, message: responseMessage, data: batch },
        { status: 201 }
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : '发放失败';
      return NextResponse.json({ success: false, message: msg }, { status: 400 });
    }
  },
  { forbiddenMessage: '无权限' }
);

// GET: 查询发放批次列表
export const GET = withAdmin(
  async (request: NextRequest, user) => {
    try {
      const limited = await withRateLimit('admin:rewards', user.id);
      if (limited) return limited;

      const { searchParams } = new URL(request.url);
      const pageRaw = Number(searchParams.get('page') ?? 1);
      const limitRaw = Number(searchParams.get('limit') ?? 20);

      const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
      const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : 20;

      const result = await listRewardBatches(page, limit);

      return NextResponse.json({ success: true, data: result });
    } catch (error) {
      console.error('Admin list rewards error:', error);
      return NextResponse.json({ success: false, message: '获取发放记录失败' }, { status: 500 });
    }
  },
  { forbiddenMessage: '无权限' }
);
