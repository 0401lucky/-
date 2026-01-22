import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getUserLotteryRecords } from "@/lib/lottery";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "请先登录" },
        { status: 401 }
      );
    }

    const records = await getUserLotteryRecords(user.id, 20);
    
    return NextResponse.json({
      success: true,
      records: records.map(r => ({
        id: r.id,
        tierName: r.tierName,
        tierValue: r.tierValue,
        code: r.code,
        directCredit: r.directCredit || false,  // 直充标记
        createdAt: r.createdAt
      }))
    });
  } catch (error) {
    console.error("Get lottery records error:", error);
    return NextResponse.json(
      { success: false, message: "获取记录失败" },
      { status: 500 }
    );
  }
}
