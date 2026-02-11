import { NextResponse } from "next/server";
import { getUserLotteryRecords } from "@/lib/lottery";
import { withUserRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export const GET = withUserRateLimit(
  'lottery:records',
  async (_request, user) => {
    try {
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
  },
  { unauthorizedMessage: '请先登录' }
);
