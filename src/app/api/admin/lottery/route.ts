import { NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import {
  getLotteryConfig,
  getTiersStats,
  getLotteryRecords,
} from "@/lib/lottery";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限访问" },
        { status: 403 }
      );
    }

    const config = await getLotteryConfig();
    const tiersStats = await getTiersStats();
    const records = await getLotteryRecords(100);

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
      },
      tiers: tiersWithStats,
      stats: {
        totalCodes,
        totalUsed,
        totalAvailable,
      },
      records,
    });
  } catch (error) {
    console.error("Get admin lottery data error:", error);
    return NextResponse.json(
      { success: false, message: "获取数据失败" },
      { status: 500 }
    );
  }
}
