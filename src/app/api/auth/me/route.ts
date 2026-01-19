import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";

export async function GET() {
  const user = await getAuthUser();

  if (!user) {
    return NextResponse.json(
      { success: false, message: "未登录" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    success: true,
    user,
  });
}
