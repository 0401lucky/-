/**
 * POST /api/admin/raffle/[id]/retry - 重试发放失败的奖励
 */

import { NextResponse } from "next/server";
import { checkRaffleAdmin } from "../../admin-auth";
import { retryFailedRewards } from "@/lib/raffle";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await checkRaffleAdmin();
  if ("error" in authResult) {
    return NextResponse.json(
      { success: false, message: authResult.error },
      { status: authResult.status }
    );
  }

  try {
    const { id } = await params;

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
}
