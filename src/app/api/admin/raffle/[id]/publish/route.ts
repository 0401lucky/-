/**
 * POST /api/admin/raffle/[id]/publish - 发布活动
 */

import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import { publishRaffle } from "@/lib/raffle";

export const POST = withAdmin(async (
  _request: Request,
  _user,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await context.params;

    const raffle = await publishRaffle(id);
    if (!raffle) {
      return NextResponse.json(
        { success: false, message: "活动不存在" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "活动已发布",
      raffle,
    });
  } catch (error) {
    console.error("发布活动失败:", error);
    const message = error instanceof Error ? error.message : "发布失败";
    return NextResponse.json(
      { success: false, message },
      { status: 400 }
    );
  }
});
