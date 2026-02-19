/**
 * POST /api/admin/raffle/[id]/retry - 重试发放失败的奖励
 */

import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import { retryFailedRewards } from "@/lib/raffle";

export const POST = withAdmin(async (
  _request: Request,
  _user,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await context.params;

    const result = await retryFailedRewards(id);

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      deliveryResults: result.deliveryResults,
    });
  } catch (error) {
    console.error("重试发放失败:", error);
    return NextResponse.json(
      { success: false, message: "重试发放失败，请稍后重试" },
      { status: 500 }
    );
  }
});
