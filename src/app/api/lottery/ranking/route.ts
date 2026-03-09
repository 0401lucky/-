import { NextRequest, NextResponse } from 'next/server';
import { getLotteryDailyRanking } from '@/lib/lottery';
import {
  buildKvUnavailablePayload,
  getKvAvailabilityStatus,
  getKvErrorInsight,
  KV_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from '@/lib/kv';
import { getTodayDateString } from '@/lib/time';

const PUBLIC_RANKING_CACHE_CONTROL = 'public, max-age=15, stale-while-revalidate=45';

// GET - 获取今日运气最佳排行榜
export async function GET(request: NextRequest) {
  try {
    const kvStatus = getKvAvailabilityStatus();
    if (!kvStatus.available) {
      return NextResponse.json(
        buildKvUnavailablePayload("排行榜服务暂时不可用，请稍后重试"),
        {
          status: 503,
          headers: {
            "Retry-After": KV_UNAVAILABLE_RETRY_AFTER_SECONDS.toString(),
          },
        }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50);
    const date = searchParams.get('date') || getTodayDateString();
    const data = await getLotteryDailyRanking(limit, date);

    const response = NextResponse.json({
      success: true,
      date: data.date,
      totalParticipants: data.totalParticipants,
      ranking: data.ranking,
    });
    response.headers.set('Cache-Control', PUBLIC_RANKING_CACHE_CONTROL);
    return response;
  } catch (error) {
    const kvInsight = getKvErrorInsight(error);
    if (kvInsight.isUnavailable) {
      return NextResponse.json(
        buildKvUnavailablePayload("排行榜服务暂时不可用，请稍后重试"),
        {
          status: 503,
          headers: {
            "Retry-After": KV_UNAVAILABLE_RETRY_AFTER_SECONDS.toString(),
          },
        }
      );
    }

    console.error("Get today ranking error:", error);
    return NextResponse.json(
      { success: false, message: "获取排行榜失败" },
      { status: 500 }
    );
  }
}
