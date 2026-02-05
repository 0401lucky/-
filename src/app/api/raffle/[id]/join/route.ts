/**
 * POST /api/raffle/[id]/join - 参与抽奖
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/auth";
import { joinRaffle, executeRaffleDraw, getRaffle } from "@/lib/raffle";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 验证登录状态
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("session")?.value;

    if (!sessionCookie) {
      return NextResponse.json(
        { success: false, message: "请先登录" },
        { status: 401 }
      );
    }

    const session = verifySession(sessionCookie);
    if (!session) {
      return NextResponse.json(
        { success: false, message: "登录已过期，请重新登录" },
        { status: 401 }
      );
    }

    // 检查活动是否存在且状态正确
    const raffle = await getRaffle(id);
    if (!raffle) {
      return NextResponse.json(
        { success: false, message: "活动不存在" },
        { status: 404 }
      );
    }

    if (raffle.status !== "active") {
      return NextResponse.json(
        { success: false, message: "活动不在进行中" },
        { status: 400 }
      );
    }

    // 参与抽奖
    const result = await joinRaffle(id, session.userId, session.username);

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 400 }
      );
    }

    // 检查是否需要自动开奖
    if (result.shouldDraw) {
      // 异步触发开奖，不阻塞响应
      executeRaffleDraw(id).catch((err) => {
        console.error("自动开奖失败:", err);
      });
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      entry: result.entry,
      shouldDraw: result.shouldDraw,
    });
  } catch (error) {
    console.error("参与抽奖失败:", error);
    return NextResponse.json(
      { success: false, message: "参与失败，请稍后重试" },
      { status: 500 }
    );
  }
}
