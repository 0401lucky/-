import { NextResponse } from "next/server";
import { getUserLotteryRecords } from "@/lib/lottery";
import { withUserRateLimit } from "@/lib/rate-limit";
import {
  buildKvUnavailablePayload,
  getKvAvailabilityStatus,
  getKvErrorInsight,
  KV_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from "@/lib/kv";

export const dynamic = "force-dynamic";

export const GET = withUserRateLimit(
  'lottery:records',
  async (_request, user) => {
    try {
      const kvStatus = getKvAvailabilityStatus();
      if (!kvStatus.available) {
        return NextResponse.json(
          buildKvUnavailablePayload("抽奖记录服务暂时不可用，请稍后重试"),
          {
            status: 503,
            headers: {
              "Retry-After": KV_UNAVAILABLE_RETRY_AFTER_SECONDS.toString(),
            },
          }
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
      const kvInsight = getKvErrorInsight(error);
      if (kvInsight.isUnavailable) {
        return NextResponse.json(
          buildKvUnavailablePayload("抽奖记录服务暂时不可用，请稍后重试"),
          {
            status: 503,
            headers: {
              "Retry-After": KV_UNAVAILABLE_RETRY_AFTER_SECONDS.toString(),
            },
          }
        );
      }

      console.error("Get lottery records error:", error);
      return NextResponse.json(
        { success: false, message: "获取记录失败" },
        { status: 500 }
      );
    }
  },
  { unauthorizedMessage: '请先登录' }
);
