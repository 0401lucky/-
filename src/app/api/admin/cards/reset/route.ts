import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { kv } from "@vercel/kv";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限访问" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, message: "用户ID不能为空" },
        { status: 400 }
      );
    }

    // Reset card data by deleting the key
    // getUserCardData handles missing keys by returning default state
    await kv.del(`cards:user:${userId}`);

    return NextResponse.json({
      success: true,
      message: "用户卡牌进度重置成功",
    });
  } catch (error) {
    console.error("Reset card progress error:", error);
    return NextResponse.json(
      { success: false, message: "重置失败" },
      { status: 500 }
    );
  }
}
