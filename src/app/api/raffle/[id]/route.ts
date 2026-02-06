/**
 * GET /api/raffle/[id] - 获取活动详情
 */

import { NextResponse } from "next/server";
import { getRaffle, getRaffleEntries, getUserRaffleStatus } from "@/lib/raffle";
import { verifySession } from "@/lib/auth";
import { cookies } from "next/headers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const raffle = await getRaffle(id);
    if (!raffle) {
      return NextResponse.json(
        { success: false, message: "活动不存在" },
        { status: 404 }
      );
    }

    // 用户端不显示草稿状态的活动
    if (raffle.status === "draft") {
      return NextResponse.json(
        { success: false, message: "活动不存在" },
        { status: 404 }
      );
    }

    // 获取参与者列表（最近50人）
    const entries = await getRaffleEntries(id, 50, 0);

    // 检查当前用户的参与状态
    let userStatus = null;
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("app_session")?.value ?? cookieStore.get("session")?.value;

    if (sessionCookie) {
      const session = verifySession(sessionCookie);
      if (session) {
        userStatus = await getUserRaffleStatus(id, session.userId);
      }
    }

    return NextResponse.json({
      success: true,
      raffle: {
        id: raffle.id,
        title: raffle.title,
        description: raffle.description,
        coverImage: raffle.coverImage,
        prizes: raffle.prizes,
        triggerType: raffle.triggerType,
        threshold: raffle.threshold,
        status: raffle.status,
        participantsCount: raffle.participantsCount,
        winnersCount: raffle.winnersCount,
        drawnAt: raffle.drawnAt,
        // 仅在已结束时返回中奖者
        winners: raffle.status === "ended" ? raffle.winners : undefined,
        createdAt: raffle.createdAt,
      },
      entries,
      userStatus,
    });
  } catch (error) {
    console.error("获取活动详情失败:", error);
    return NextResponse.json(
      { success: false, message: "获取活动详情失败" },
      { status: 500 }
    );
  }
}
