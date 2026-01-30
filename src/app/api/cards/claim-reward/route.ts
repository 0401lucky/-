import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { claimCollectionReward, getAlbumRewardStatuses, RewardType } from "@/lib/cards/rewards";
import { getUserCardData } from "@/lib/cards/draw";
import { getAlbumById } from "@/lib/cards/config";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

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

    // 速率限制检查
    const rateLimitResult = await checkRateLimit(user.id.toString(), {
      prefix: "ratelimit:cards:claim-reward",
    });
    if (!rateLimitResult.success) {
      return rateLimitResponse(rateLimitResult);
    }

    const body = await request.json();
    const { rewardType, albumId } = body as { rewardType?: RewardType; albumId?: string };

    if (!rewardType || !VALID_REWARD_TYPES.includes(rewardType)) {
      return NextResponse.json(
        { success: false, message: "无效的奖励类型" },
        { status: 400 }
      );
    }

    if (!albumId || !getAlbumById(albumId)) {
      return NextResponse.json(
        { success: false, message: "无效的卡册ID" },
        { status: 400 }
      );
    }

    const result = await claimCollectionReward(user.id.toString(), rewardType, albumId);

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

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "请先登录" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const albumId = searchParams.get('albumId');

    if (!albumId || !getAlbumById(albumId)) {
      return NextResponse.json(
        { success: false, message: "无效的卡册ID" },
        { status: 400 }
      );
    }

    const userData = await getUserCardData(user.id.toString());
    const statuses = await getAlbumRewardStatuses(userData, albumId);

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
