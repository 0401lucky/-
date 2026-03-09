import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getLotteryPagePayload } from "@/lib/lottery";
import {
  buildKvUnavailablePayload,
  getKvErrorInsight,
  getKvAvailabilityStatus,
  KV_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from "@/lib/kv";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const kvStatus = getKvAvailabilityStatus();
    if (!kvStatus.available) {
      return NextResponse.json(
        buildKvUnavailablePayload("抽奖服务暂时不可用，请稍后重试"),
        {
          status: 503,
          headers: {
            "Retry-After": KV_UNAVAILABLE_RETRY_AFTER_SECONDS.toString(),
          },
        }
      );
    }

    const user = await getAuthUser();

    if (!user) {
      return NextResponse.json(
        { success: false, message: "请先登录" },
        { status: 401 }
      );
    }

    const payload = await getLotteryPagePayload(user);

    return NextResponse.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    const kvInsight = getKvErrorInsight(error);
    if (kvInsight.isUnavailable) {
      return NextResponse.json(
        buildKvUnavailablePayload("抽奖服务暂时不可用，请稍后重试"),
        {
          status: 503,
          headers: {
            "Retry-After": KV_UNAVAILABLE_RETRY_AFTER_SECONDS.toString(),
          },
        }
      );
    }

    console.error("Get lottery config error:", error);
    return NextResponse.json(
      { success: false, message: "获取抽奖配置失败" },
      { status: 500 }
    );
  }
}
