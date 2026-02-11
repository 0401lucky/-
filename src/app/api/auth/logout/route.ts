import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { revokeSessionToken } from "@/lib/auth";

export async function POST() {
  const cookieStore = await cookies();
  const appSession = cookieStore.get("app_session")?.value;
  const legacySession = cookieStore.get("session")?.value;

  await Promise.all([
    appSession ? revokeSessionToken(appSession) : Promise.resolve(),
    legacySession ? revokeSessionToken(legacySession) : Promise.resolve(),
  ]);

  const response = NextResponse.json({
    success: true,
    message: "已退出登录",
  });

  response.cookies.set("app_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });

  response.cookies.set("session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });

  response.cookies.set("new_api_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });

  return response;
}
