import { NextRequest, NextResponse } from "next/server";
import { loginToNewApi } from "@/lib/new-api";

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { success: false, message: "用户名和密码不能为空" },
        { status: 400 }
      );
    }

    const result = await loginToNewApi(username, password);

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 401 }
      );
    }

    // 从 cookies 中提取 session
    const sessionMatch = result.cookies?.match(/session=([^;]+)/);
    const sessionValue = sessionMatch?.[1];

    if (!sessionValue) {
      return NextResponse.json(
        { success: false, message: "登录失败：无法获取会话" },
        { status: 500 }
      );
    }

    const response = NextResponse.json({
      success: true,
      message: "登录成功",
      user: {
        id: result.user?.id,
        username: result.user?.username,
        displayName: result.user?.display_name || result.user?.username,
      },
    });

    // 设置 session cookie
    response.cookies.set("session", sessionValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 天
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { success: false, message: "服务器错误" },
      { status: 500 }
    );
  }
}
