import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/api-guards';
import { withRateLimit } from '@/lib/rate-limit';
import {
  settleRankingPeriod,
  type RankingSettlementPeriod,
} from '@/lib/ranking-settlement';

export const dynamic = 'force-dynamic';

function normalizePeriod(value: unknown): RankingSettlementPeriod {
  return value === 'monthly' ? 'monthly' : 'weekly';
}

function normalizeTopN(value: unknown): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(1, Math.min(100, Math.floor(num)));
}

function normalizeRewardPoints(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rewards = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 0)
    .map((item) => Math.floor(item));
  return rewards.length > 0 ? rewards : undefined;
}

export const POST = withAdmin(
  async (request: NextRequest, user) => {
    try {
      const limited = await withRateLimit('rankings:settle', user.id);
      if (limited) return limited;

      const body = (await request.json().catch(() => null)) as {
        period?: unknown;
        topN?: unknown;
        rewardPoints?: unknown;
        dryRun?: unknown;
        retryFailed?: unknown;
      } | null;

      const period = normalizePeriod(body?.period);
      const topN = normalizeTopN(body?.topN);
      const rewardPoints = normalizeRewardPoints(body?.rewardPoints);
      const dryRun = body?.dryRun === true;
      const retryFailed = body?.retryFailed === true;

      const result = await settleRankingPeriod({
        period,
        operator: {
          id: user.id,
          username: user.username,
        },
        topN,
        rewardPoints,
        dryRun,
        retryFailed,
      });

      const message = result.alreadySettled
        ? '当前周期已结算，返回历史结果'
        : result.retried
          ? '失败奖励重试完成'
          : dryRun
            ? '结算预演完成'
            : '排行榜结算完成';

      return NextResponse.json({
        success: true,
        message,
        data: result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '排行榜结算失败';
      const status = message.includes('进行中') ? 409 : 400;
      return NextResponse.json(
        { success: false, message },
        { status }
      );
    }
  },
  { forbiddenMessage: '无权限' }
);
