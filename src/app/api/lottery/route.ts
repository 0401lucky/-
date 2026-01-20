import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
  getLotteryConfig,
  checkAllTiersHaveCodes,
  getTiersStats,
} from "@/lib/lottery";
import { checkDailyLimit, getExtraSpinCount } from "@/lib/kv";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getAuthUser();

    if (!user) {
      return NextResponse.json(
        { success: false, message: "请先登录" },
        { status: 401 }
      );
    }

    const config = await getLotteryConfig();
    const hasSpunToday = await checkDailyLimit(user.id);
    const extraSpins = await getExtraSpinCount(user.id);
    const allTiersHaveCodes = await checkAllTiersHaveCodes();
    const tiersStats = await getTiersStats();

    // 为前端返回带有库存状态的档位信息
    const tiersWithStats = config.tiers.map((tier) => {
      const stats = tiersStats.find((s) => s.id === tier.id);
      return {
        id: tier.id,
        name: tier.name,
        value: tier.value,
        color: tier.color,
        hasStock: (stats?.available ?? 0) > 0,
      };
    });

    return NextResponse.json({
      success: true,
      enabled: config.enabled,
      tiers: tiersWithStats,
      canSpin: config.enabled && (!hasSpunToday || extraSpins > 0) && allTiersHaveCodes,
      hasSpunToday,
      extraSpins,
      allTiersHaveCodes,
    });
  } catch (error) {
    console.error("Get lottery config error:", error);
    return NextResponse.json(
      { success: false, message: "获取抽奖配置失败" },
      { status: 500 }
    );
  }
}
