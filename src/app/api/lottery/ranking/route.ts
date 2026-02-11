import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import {
  buildKvUnavailablePayload,
  getKvAvailabilityStatus,
  getKvErrorInsight,
  KV_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from "@/lib/kv";

export const dynamic = "force-dynamic";

interface LotteryRecord {
  id: string;
  oderId: string;
  username: string;
  tierName: string;
  tierValue: number;
  code: string;
  createdAt: number;
}

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
    const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 50);

    // 获取今日的开始时间（中国时区）
    const now = new Date();
    const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const todayStart = new Date(chinaTime);
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStartUTC = new Date(todayStart.getTime() - 8 * 60 * 60 * 1000);
    const todayStartTimestamp = todayStartUTC.getTime();

    // 获取所有抽奖记录
    const allRecords = await kv.lrange<LotteryRecord>("lottery:records", 0, 500);

    // 筛选今日记录
    const todayRecords = allRecords.filter(
      (record) => record.createdAt >= todayStartTimestamp
    );

    // 按用户聚合，计算每个用户今日获得的总价值
    const userStats: Record<
      string,
      { username: string; totalValue: number; bestPrize: string; count: number }
    > = {};

    for (const record of todayRecords) {
      const key = record.oderId; // 用户ID
      if (!userStats[key]) {
        userStats[key] = {
          username: record.username,
          totalValue: 0,
          bestPrize: record.tierName,
          count: 0,
        };
      }
      userStats[key].totalValue += record.tierValue;
      userStats[key].count += 1;
      // 更新最佳奖品
      if (record.tierValue > getTierValueFromName(userStats[key].bestPrize)) {
        userStats[key].bestPrize = record.tierName;
      }
    }

    // 转换为数组并排序
    const ranking = Object.entries(userStats)
      .map(([userId, stats]) => ({
        rank: 0,
        userId,
        username: stats.username,
        totalValue: stats.totalValue,
        bestPrize: stats.bestPrize,
        count: stats.count,
      }))
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, limit)
      .map((item, index) => ({ ...item, rank: index + 1 }));

    const response = NextResponse.json({
      success: true,
      date: chinaTime.toISOString().split("T")[0],
      totalParticipants: Object.keys(userStats).length,
      ranking,
    });
    response.headers.set("Cache-Control", "no-store");
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

function getTierValueFromName(tierName: string): number {
  const match = tierName.match(/(\d+)/);
  return match ? parseInt(match[1]) : 0;
}
