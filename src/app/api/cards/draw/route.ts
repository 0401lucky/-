import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { drawCards } from "@/lib/cards/draw";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { enforceTrustedApiRequest } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const blocked = enforceTrustedApiRequest(request);
    if (blocked) {
      return blocked;
    }

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
      // 抽卡是高频操作，默认 10/min 太容易触发；这里提高到约 1 req/s
      windowSeconds: 30,
      maxRequests: 30,
    });
    if (!rateLimitResult.success) {
      return rateLimitResponse(rateLimitResult);
    }

    // 获取抽卡次数参数
    const body = await request.json().catch(() => ({}));
    const count = Math.min(Math.max(Number(body.count) || 1, 1), 10); // 1-10次

    const result = await drawCards(user.id.toString(), count);
    if (!result.success || !result.results) {
      return NextResponse.json(
        { success: false, message: result.message || "抽卡失败，请稍后重试", drawsAvailable: result.drawsAvailable },
        { status: 400 }
      );
    }

    // 单抽返回旧格式，多抽返回新格式
    if (count === 1) {
      const firstResult = result.results[0];
      return NextResponse.json({
        success: true,
        data: {
          success: true,
          card: firstResult.card,
          isDuplicate: firstResult.isDuplicate,
          fragmentsAdded: firstResult.fragmentsAdded,
          drawsAvailable: result.drawsAvailable,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        success: true,
        cards: result.results,
        count: result.results.length,
        drawsAvailable: result.drawsAvailable,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (message.startsWith("LOCK_TIMEOUT:")) {
      return NextResponse.json(
        { success: false, message: "抽卡处理中，请稍后再试" },
        { status: 409 }
      );
    }

    console.error("Draw API error:", error);
    return NextResponse.json(
      { success: false, message: "抽卡服务异常" },
      { status: 500 }
    );
  }
}
