import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import { deleteUserCardData } from "@/lib/cards/draw";

export const POST = withAdmin(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, message: "用户ID不能为空" },
        { status: 400 }
      );
    }

    // 重置卡牌数据，兼容旧 KV 和 native 热路径。
    await deleteUserCardData(String(userId));

    return NextResponse.json({
      success: true,
      message: "用户卡牌进度重置成功",
    });
  } catch (error) {
    console.error("Reset card progress error:", error);
    return NextResponse.json(
      { success: false, message: "重置失败" },
      { status: 500 }
    );
  }
});
