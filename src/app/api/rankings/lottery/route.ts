import { NextResponse } from 'next/server';
import { getLotteryRanking, type LotteryRankingPeriod } from '@/lib/lottery';
import {
  buildKvUnavailablePayload,
  getKvAvailabilityStatus,
  getKvErrorInsight,
  KV_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from '@/lib/kv';

const PUBLIC_RANKING_CACHE_CONTROL = 'public, max-age=15, stale-while-revalidate=45';

function normalizePeriod(value: string | null): LotteryRankingPeriod {
  if (value === 'weekly' || value === 'monthly') return value;
  return 'daily';
}

export async function GET(request: Request) {
  try {
    const kvStatus = getKvAvailabilityStatus();
    if (!kvStatus.available) {
      return NextResponse.json(
        buildKvUnavailablePayload('排行榜服务暂时不可用，请稍后重试'),
        {
          status: 503,
          headers: {
            'Retry-After': KV_UNAVAILABLE_RETRY_AFTER_SECONDS.toString(),
          },
        },
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 50);
    const period = normalizePeriod(searchParams.get('period'));
    const data = await getLotteryRanking(period, limit);

    const response = NextResponse.json({
      success: true,
      data,
      // 兼容旧调用方：保留顶层字段，同时给排行榜页提供统一的 data 包装。
      period: data.period,
      periodKey: data.periodKey,
      totalParticipants: data.totalParticipants,
      ranking: data.ranking,
    });
    response.headers.set('Cache-Control', PUBLIC_RANKING_CACHE_CONTROL);
    return response;
  } catch (error) {
    const kvInsight = getKvErrorInsight(error);
    if (kvInsight.isUnavailable) {
      return NextResponse.json(
        buildKvUnavailablePayload('排行榜服务暂时不可用，请稍后重试'),
        {
          status: 503,
          headers: {
            'Retry-After': KV_UNAVAILABLE_RETRY_AFTER_SECONDS.toString(),
          },
        },
      );
    }

    console.error('Get lottery ranking error:', error);
    return NextResponse.json(
      { success: false, message: '获取幸运抽奖榜失败' },
      { status: 500 },
    );
  }
}
