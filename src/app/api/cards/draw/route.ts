import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { drawCard } from "@/lib/cards/draw";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

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

    // 速率限制检查
    const rateLimitResult = await checkRateLimit(user.id.toString(), {
      prefix: "ratelimit:cards:draw",
    });
    if (!rateLimitResult.success) {
      return rateLimitResponse(rateLimitResult);
    }

    const result = await drawCard(user.id.toString());

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        success: true,
        card: result.card,
        isDuplicate: result.isDuplicate,
        fragmentsAdded: result.fragmentsAdded,
      },
    });
  } catch (error) {
    console.error("Draw API error:", error);
    return NextResponse.json(
      { success: false, message: "抽卡服务异常" },
      { status: 500 }
    );
  }
}
