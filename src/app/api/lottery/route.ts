import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
  getLotteryConfig,
  getTiersStats,
  checkDailyDirectLimit,
} from "@/lib/lottery";
import { checkDailyLimit, getExtraSpinCount } from "@/lib/kv";
import {
  buildKvUnavailablePayload,
  getKvErrorInsight,
  getKvAvailabilityStatus,
  KV_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from "@/lib/kv";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const kvStatus = getKvAvailabilityStatus();
    if (!kvStatus.available) {
      return NextResponse.json(
        buildKvUnavailablePayload("抽奖服务暂时不可用，请稍后重试"),
        {
          status: 503,
          headers: {
            "Retry-After": KV_UNAVAILABLE_RETRY_AFTER_SECONDS.toString(),
          },
        }
      );
    }

    const user = await getAuthUser();

    if (!user) {
      return NextResponse.json(
        { success: false, message: "请先登录" },
        { status: 401 }
      );
    }

    // [Perf] 并行查询所有独立数据，减少串行等待
    const [config, hasSpunToday, extraSpins, tiersStats] = await Promise.all([
      getLotteryConfig(),
      checkDailyLimit(user.id),
      getExtraSpinCount(user.id),
      getTiersStats(),
    ]);

    const bypassSpinLimit = user.isAdmin;

    // [Perf] 从 tiersStats 推导 allTiersHaveCodes，不再重复查询
    const activeTierIds = new Set(
      config.tiers.filter(t => t.probability > 0).map(t => t.id)
    );
    const allTiersHaveCodes = activeTierIds.size > 0 &&
      tiersStats
        .filter(s => activeTierIds.has(s.id))
        .every(s => s.available > 0);

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

    // [Perf] 从 config 直接算 minTierValue，不再额外查 D1
    const activeTiers = config.tiers.filter(t => t.probability > 0);
    const minTierValue = activeTiers.length > 0
      ? Math.min(...activeTiers.map(t => t.value))
      : Infinity;

    // 根据模式判断是否可以抽奖
    let canSpinByMode = false;

    if (config.mode === 'direct') {
      canSpinByMode = await checkDailyDirectLimit(minTierValue);
    } else if (config.mode === 'code') {
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
      canSpin: config.enabled && canSpinByMode && (bypassSpinLimit || !hasSpunToday || extraSpins > 0),
      hasSpunToday,
      extraSpins,
      allTiersHaveCodes,
    });
  } catch (error) {
    const kvInsight = getKvErrorInsight(error);
    if (kvInsight.isUnavailable) {
      return NextResponse.json(
        buildKvUnavailablePayload("抽奖服务暂时不可用，请稍后重试"),
        {
          status: 503,
          headers: {
            "Retry-After": KV_UNAVAILABLE_RETRY_AFTER_SECONDS.toString(),
          },
        }
      );
    }

    console.error("Get lottery config error:", error);
    return NextResponse.json(
      { success: false, message: "获取抽奖配置失败" },
      { status: 500 }
    );
  }
}
