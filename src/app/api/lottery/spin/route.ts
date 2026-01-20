import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { spinLottery, getLotteryConfig, checkAllTiersHaveCodes } from "@/lib/lottery";
import { recordUser, getExtraSpinCount, checkDailyLimit } from "@/lib/kv";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const user = await getAuthUser();

    if (!user) {
      return NextResponse.json(
        { success: false, message: "请先登录" },
        { status: 401 }
      );
    }

    // 检查抽奖是否启用
    const config = await getLotteryConfig();
    if (!config.enabled) {
      return NextResponse.json(
        { success: false, message: "抽奖活动暂未开放" },
        { status: 400 }
      );
    }

    // 检查所有档位是否有库存
    const allHaveCodes = await checkAllTiersHaveCodes();
    if (!allHaveCodes) {
      return NextResponse.json(
        { success: false, message: "库存不足，暂时无法抽奖" },
        { status: 400 }
      );
    }

    // 检查是否有资格抽奖（免费次数 或 额外次数）
    const hasFreeSpin = !(await checkDailyLimit(user.id));
    const extraSpins = await getExtraSpinCount(user.id);
    
    if (!hasFreeSpin && extraSpins <= 0) {
      return NextResponse.json(
        { success: false, message: "今日免费次数已用完，请签到获取更多机会" },
        { status: 400 }
      );
    }

    // 执行抽奖
    const result = await spinLottery(user.id, user.username);

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 400 }
      );
    }

    // 记录用户信息（如果是新用户会自动记录）
    await recordUser(user.id, user.username);

    return NextResponse.json({
      success: true,
      message: result.message,
      record: result.record,
    });
  } catch (error) {
    console.error("Spin lottery error:", error);
    return NextResponse.json(
      { success: false, message: "抽奖失败，请重试" },
      { status: 500 }
    );
  }
}
