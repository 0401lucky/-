import { NextRequest, NextResponse } from "next/server";
import { loginToNewApi } from "@/lib/new-api";
import { createSessionToken } from "@/lib/auth";

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

    if (!result.user) {
      return NextResponse.json(
        { success: false, message: "登录失败：无法获取用户信息" },
        { status: 500 }
      );
    }

    // 创建自己的 session token，包含用户信息
    const sessionData = {
      id: result.user.id,
      username: result.user.username,
      displayName: result.user.display_name || result.user.username,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 天过期
    };

    // 使用 HMAC 签名创建安全的 session token
    const sessionToken = createSessionToken(sessionData);

    const response = NextResponse.json({
      success: true,
      message: "登录成功",
      user: {
        id: result.user.id,
        username: result.user.username,
        displayName: result.user.display_name || result.user.username,
      },
    });

    // 设置我们自己的 session cookie
    response.cookies.set("app_session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 天
      path: "/",
    });

    // 保存 new-api 的原始 session cookie（用于签到等需要调用 new-api 的功能）
    if (result.cookies) {
      // 从 set-cookie 头解析出 session 值
      const sessionMatch = result.cookies.match(/session=([^;]+)/);
      if (sessionMatch) {
        response.cookies.set("new_api_session", sessionMatch[1], {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 7, // 7 天
          path: "/",
        });
      }
    }

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { success: false, message: "服务器错误" },
      { status: 500 }
    );
  }
}
