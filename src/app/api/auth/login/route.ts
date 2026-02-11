import { NextRequest, NextResponse } from "next/server";
import { isIP } from "node:net";
import { loginToNewApi } from "@/lib/new-api";
import {
  clearLoginFailures,
  createSessionToken,
  getLoginLockStatus,
  recordLoginFailure,
} from "@/lib/auth";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const TRUSTED_IP_HEADERS = ["cf-connecting-ip", "true-client-ip", "x-real-ip"] as const;

function normalizeIp(rawValue: string): string | null {
  const trimmed = rawValue.trim().replace(/^"(.+)"$/, "$1");
  if (!trimmed || trimmed.toLowerCase() === "unknown") {
    return null;
  }

  let candidate = trimmed;
  const bracketedMatch = candidate.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketedMatch) {
    candidate = bracketedMatch[1];
  } else {
    const ipv4WithPortMatch = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
    if (ipv4WithPortMatch) {
      candidate = ipv4WithPortMatch[1];
    }
  }

  const zoneIndex = candidate.indexOf("%");
  if (zoneIndex >= 0) {
    candidate = candidate.slice(0, zoneIndex);
  }

  return isIP(candidate) ? candidate : null;
}

function extractLastValidForwardedIp(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }

  const candidates = headerValue
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const normalized = normalizeIp(candidates[index]);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function getClientIp(request: NextRequest): string {
  for (const headerName of TRUSTED_IP_HEADERS) {
    const headerValue = request.headers.get(headerName);
    if (!headerValue) {
      continue;
    }

    const normalized = normalizeIp(headerValue);
    if (normalized) {
      return normalized;
    }
  }

  const forwardedForIp = extractLastValidForwardedIp(request.headers.get("x-forwarded-for"));
  if (forwardedForIp) {
    return forwardedForIp;
  }

  const vercelForwardedForIp = extractLastValidForwardedIp(request.headers.get("x-vercel-forwarded-for"));
  if (vercelForwardedForIp) {
    return vercelForwardedForIp;
  }

  return "unknown";
}

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();
    const normalizedUsername = String(username ?? "").trim().toLowerCase();

    if (!username || !password) {
      return NextResponse.json(
        { success: false, message: "用户名和密码不能为空" },
        { status: 400 }
      );
    }

    const lockStatus = await getLoginLockStatus(normalizedUsername);
    if (lockStatus.locked) {
      return NextResponse.json(
        {
          success: false,
          message: `登录失败次数过多，请 ${lockStatus.remainingSeconds} 秒后再试`,
          retryAfter: lockStatus.remainingSeconds,
        },
        { status: 429 }
      );
    }

    const ipRateLimitResult = await checkRateLimit(getClientIp(request), RATE_LIMITS['auth:login:ip']);
    if (!ipRateLimitResult.success) {
      return rateLimitResponse(ipRateLimitResult);
    }

    const usernameRateLimitResult = await checkRateLimit(normalizedUsername, RATE_LIMITS['auth:login:user']);
    if (!usernameRateLimitResult.success) {
      return rateLimitResponse(usernameRateLimitResult);
    }

    const result = await loginToNewApi(username, password);

    if (!result.success) {
      const failure = await recordLoginFailure(normalizedUsername);
      const failureMessage = failure.locked
        ? `登录失败次数过多，请 ${failure.remainingSeconds} 秒后再试`
        : result.message;
      return NextResponse.json(
        {
          success: false,
          message: failureMessage,
          retryAfter: failure.locked ? failure.remainingSeconds : undefined,
        },
        { status: failure.locked ? 429 : 401 }
      );
    }

    await clearLoginFailures(normalizedUsername);

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
      iat: Date.now(),
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

    // 兼容：多人抽奖模块使用的 session cookie（与 app_session 同值）
    response.cookies.set("session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 天
      path: "/",
    });

    // 保存 new-api 的原始 session cookie（用于签到等需要调用 new-api 的功能）
    // 注意：若本次登录未拿到 new-api 的 session，则清理旧 cookie，避免残留导致“错号签到”
    const sessionMatch = result.cookies?.match(/(?:^|;\s*)session=([^;]+)/);
    if (sessionMatch?.[1]) {
      response.cookies.set("new_api_session", sessionMatch[1], {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 天
        path: "/",
      });
    } else {
      response.cookies.set("new_api_session", "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 0,
        path: "/",
      });
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
