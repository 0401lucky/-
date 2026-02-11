/**
 * POST /api/admin/raffle/[id]/cancel - 取消活动
 */

import { NextResponse } from "next/server";
import { checkRaffleAdmin } from "../../admin-auth";
import { cancelRaffle } from "@/lib/raffle";

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

    const raffle = await cancelRaffle(id);
    if (!raffle) {
      return NextResponse.json(
        { success: false, message: "活动不存在" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "活动已取消",
      raffle,
    });
  } catch (error) {
    console.error("取消活动失败:", error);
    const message = error instanceof Error ? error.message : "取消失败";
    return NextResponse.json(
      { success: false, message },
      { status: 400 }
    );
  }
}
