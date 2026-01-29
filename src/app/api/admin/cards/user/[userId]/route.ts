import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { getUserCardData } from "@/lib/cards/draw";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限访问" },
        { status: 403 }
      );
    }
    
    const { userId } = await params;
    if (!userId) {
      return NextResponse.json(
         { success: false, message: "User ID required" },
         { status: 400 }
      );
    }

    const cardData = await getUserCardData(userId);
    return NextResponse.json({ success: true, data: cardData });
  } catch (error) {
    console.error("Get user card data error:", error);
    return NextResponse.json(
      { success: false, message: "获取数据失败" },
      { status: 500 }
    );
  }
}
