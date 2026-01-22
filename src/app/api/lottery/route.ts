import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
  getLotteryConfig,
  checkAllTiersHaveCodes,
  getTiersStats,
  checkDailyDirectLimit,
  getMinTierValue,
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

    // 根据模式判断是否可以抽奖
    // direct 模式：不需要兑换码库存，只需要直充额度
    // code 模式：需要兑换码库存
    // hybrid 模式：只要其中一个可用即可
    let canSpinByMode = false;
    const minTierValue = await getMinTierValue();
    
    if (config.mode === 'direct') {
      // 直充模式：检查每日直充额度是否还有剩余（用最低可中奖档位判断）
      canSpinByMode = await checkDailyDirectLimit(minTierValue);
    } else if (config.mode === 'code') {
      // 兑换码模式：需要所有档位都有库存
      canSpinByMode = allTiersHaveCodes;
    } else {
      // hybrid 模式：直充可用 OR 兑换码可用
      const directAvailable = await checkDailyDirectLimit(minTierValue);
      canSpinByMode = directAvailable || allTiersHaveCodes;
    }

    return NextResponse.json({
      success: true,
      enabled: config.enabled,
      mode: config.mode,
      tiers: tiersWithStats,
      canSpin: config.enabled && (!hasSpunToday || extraSpins > 0) && canSpinByMode,
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
