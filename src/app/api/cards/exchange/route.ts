import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { exchangeFragmentsForCard } from "@/lib/cards/fragments";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

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
      prefix: "ratelimit:cards:exchange",
      maxRequests: 10, // 每分钟限制次数
      windowSeconds: 60,
    });
    if (!rateLimitResult.success) {
      return rateLimitResponse(rateLimitResult);
    }

    const body = await request.json();
    const { cardId } = body as { cardId?: string };

    if (!cardId) {
      return NextResponse.json(
        { success: false, message: "无效的卡片 ID" },
        { status: 400 }
      );
    }

    const result = await exchangeFragmentsForCard(user.id.toString(), cardId);

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message || "兑换失败" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "兑换成功"
    });
  } catch (error) {
    console.error("Exchange card API error:", error);
    return NextResponse.json(
      { success: false, message: "兑换服务异常" },
      { status: 500 }
    );
  }
}
