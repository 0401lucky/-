import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import type { AuthUser } from "@/lib/auth";
import { getUserCardData } from "@/lib/cards/draw";

export const dynamic = "force-dynamic";

export const GET = withAdmin(async (
  request: NextRequest,
  _user: AuthUser,
  context: { params: Promise<{ userId: string }> }
) => {
  try {
    const { userId } = await context.params;
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
});


