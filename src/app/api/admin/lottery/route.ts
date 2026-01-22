import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import {
  getLotteryConfig,
  getTiersStats,
  getLotteryRecords,
  getTodayDirectTotal,
} from "@/lib/lottery";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限访问" },
        { status: 403 }
      );
    }

    // 分页参数
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = (page - 1) * limit;

    const config = await getLotteryConfig();
    const tiersStats = await getTiersStats();
    const records = await getLotteryRecords(limit, offset);
    const todayDirectTotal = await getTodayDirectTotal();

    // 构建概率映射表（tierId -> probability）
    const probabilityMap: Record<string, number> = {};
    config.tiers.forEach((tier) => {
      probabilityMap[tier.id] = tier.probability;
      // 也用 tierName 作为 key，方便前端查找
      probabilityMap[tier.name] = tier.probability;
    });

    // 合并档位信息和库存统计
    const tiersWithStats = config.tiers.map((tier) => {
      const stats = tiersStats.find((s) => s.id === tier.id);
      return {
        ...tier,
        available: stats?.available ?? 0,
      };
    });

    // 统计总数
    const totalCodes = tiersWithStats.reduce((sum, t) => sum + t.codesCount, 0);
    const totalUsed = tiersWithStats.reduce((sum, t) => sum + t.usedCount, 0);
    const totalAvailable = tiersWithStats.reduce((sum, t) => sum + t.available, 0);

    return NextResponse.json({
      success: true,
      config: {
        enabled: config.enabled,
        mode: config.mode,
        dailyDirectLimit: config.dailyDirectLimit,
      },
      todayDirectTotal,
      tiers: tiersWithStats,
      probabilityMap, // 新增：概率映射表
      stats: {
        totalCodes,
        totalUsed,
        totalAvailable,
      },
      records,
      pagination: {
        page,
        limit,
        hasMore: records.length === limit, // 如果返回数量等于 limit，可能还有更多
      },
    });
  } catch (error) {
    console.error("Get admin lottery data error:", error);
    return NextResponse.json(
      { success: false, message: "获取数据失败" },
      { status: 500 }
    );
  }
}
