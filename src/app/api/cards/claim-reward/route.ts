import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { claimCollectionReward, getRewardStatuses, RewardType } from "@/lib/cards/rewards";
import { getUserCardData } from "@/lib/cards/draw";

export const dynamic = "force-dynamic";

const VALID_REWARD_TYPES: RewardType[] = [
  'common', 'rare', 'epic', 'legendary', 'legendary_rare', 'full_set'
];

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "请先登录" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { rewardType } = body as { rewardType?: RewardType };

    if (!rewardType || !VALID_REWARD_TYPES.includes(rewardType)) {
      return NextResponse.json(
        { success: false, message: "无效的奖励类型" },
        { status: 400 }
      );
    }

    const result = await claimCollectionReward(user.id.toString(), rewardType);

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      pointsAwarded: result.pointsAwarded,
      newBalance: result.newBalance,
    });
  } catch (error) {
    console.error("Claim reward API error:", error);
    return NextResponse.json(
      { success: false, message: "领取奖励服务异常" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "请先登录" },
        { status: 401 }
      );
    }

    const userData = await getUserCardData(user.id.toString());
    const statuses = getRewardStatuses(userData);

    return NextResponse.json({
      success: true,
      rewards: statuses,
    });
  } catch (error) {
    console.error("Get rewards API error:", error);
    return NextResponse.json(
      { success: false, message: "获取奖励状态异常" },
      { status: 500 }
    );
  }
}
