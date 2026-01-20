import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { spinLottery, getLotteryConfig, checkAllTiersHaveCodes } from "@/lib/lottery";

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

    // 执行抽奖
    const result = await spinLottery(user.id, user.username);

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 400 }
      );
    }

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
