/**
 * POST /api/admin/raffle/[id]/draw - 手动开奖
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, isAdminUsername } from "@/lib/auth";
import { executeRaffleDraw, getRaffle, processQueuedRaffleDeliveries } from "@/lib/raffle";

async function checkAdmin() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("app_session")?.value ?? cookieStore.get("session")?.value;

  if (!sessionCookie) {
    return { error: "请先登录", status: 401 };
  }

  const session = verifySession(sessionCookie);
  if (!session) {
    return { error: "登录已过期", status: 401 };
  }

  if (!isAdminUsername(session.username)) {
    return { error: "无权限访问", status: 403 };
  }

  return { session };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await checkAdmin();
  if ("error" in authResult) {
    return NextResponse.json(
      { success: false, message: authResult.error },
      { status: authResult.status }
    );
  }

  try {
    const { id } = await params;

    // 检查活动是否存在
    const raffle = await getRaffle(id);
    if (!raffle) {
      return NextResponse.json(
        { success: false, message: "活动不存在" },
        { status: 404 }
      );
    }

    if (raffle.status !== "active") {
      return NextResponse.json(
        { success: false, message: "只能对进行中的活动开奖" },
        { status: 400 }
      );
    }

    // 管理端也走入队发奖，避免大量中奖用户时请求超时
    const result = await executeRaffleDraw(id, { waitForDelivery: false });

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 400 }
      );
    }

    // 管理端触发开奖后，顺带处理一个队列任务，提升“已开奖后立即到账”体验
    const queueResult = await processQueuedRaffleDeliveries(1);

    return NextResponse.json({
      success: true,
      message: result.message,
      winners: result.winners,
      deliveryResults: result.deliveryResults,
      queueResult,
    });
  } catch (error) {
    console.error("开奖失败:", error);
    return NextResponse.json(
      { success: false, message: "开奖失败，请稍后重试" },
      { status: 500 }
    );
  }
}
