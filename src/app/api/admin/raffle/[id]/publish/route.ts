/**
 * POST /api/admin/raffle/[id]/publish - 发布活动
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, isAdminUsername } from "@/lib/auth";
import { publishRaffle } from "@/lib/raffle";

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
}
