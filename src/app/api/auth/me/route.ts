import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { cookies } from "next/headers";

export async function GET() {
  const user = await getAuthUser();

  if (!user) {
    return NextResponse.json(
      { success: false, message: "未登录" },
      { status: 401 }
    );
  }

  const response = NextResponse.json({
    success: true,
    user,
  });

  // 兼容：多人抽奖模块使用的 session cookie（与 app_session 同值）
  // 仅在 session 缺失时回填，避免不必要的覆写。
  const cookieStore = await cookies();
  const appSession = cookieStore.get("app_session")?.value;
  const raffleSession = cookieStore.get("session")?.value;
  if (appSession && !raffleSession) {
    response.cookies.set("session", appSession, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 天
      path: "/",
    });
  }

  return response;
}
