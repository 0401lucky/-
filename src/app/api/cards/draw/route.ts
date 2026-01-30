import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { drawCard, getUserCardData } from "@/lib/cards/draw";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { CardConfig } from "@/lib/cards/types";

export const dynamic = "force-dynamic";

interface DrawResult {
  card: CardConfig;
  isDuplicate: boolean;
  fragmentsAdded?: number;
}

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
      prefix: "ratelimit:cards:draw",
    });
    if (!rateLimitResult.success) {
      return rateLimitResponse(rateLimitResult);
    }

    // 获取抽卡次数参数
    const body = await request.json().catch(() => ({}));
    const count = Math.min(Math.max(Number(body.count) || 1, 1), 10); // 1-10次

    // 检查抽卡次数是否足够
    const userData = await getUserCardData(user.id.toString());
    if (userData.drawsAvailable < count) {
      return NextResponse.json(
        { success: false, message: `抽卡次数不足，需要${count}次，当前${userData.drawsAvailable}次` },
        { status: 400 }
      );
    }

    // 执行多次抽卡
    const results: DrawResult[] = [];
    for (let i = 0; i < count; i++) {
      const result = await drawCard(user.id.toString());
      if (!result.success) {
        // 如果中途失败，返回已抽到的卡
        if (results.length > 0) {
          break;
        }
        return NextResponse.json(
          { success: false, message: result.message },
          { status: 400 }
        );
      }
      results.push({
        card: result.card!,
        isDuplicate: result.isDuplicate || false,
        fragmentsAdded: result.fragmentsAdded,
      });
    }

    // 单抽返回旧格式，多抽返回新格式
    if (count === 1) {
      return NextResponse.json({
        success: true,
        data: {
          success: true,
          card: results[0].card,
          isDuplicate: results[0].isDuplicate,
          fragmentsAdded: results[0].fragmentsAdded,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        success: true,
        cards: results,
        count: results.length,
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
