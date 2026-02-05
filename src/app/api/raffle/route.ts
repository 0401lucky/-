/**
 * GET /api/raffle - 获取活动列表
 */

import { NextResponse } from "next/server";
import { getRaffleList, getActiveRaffles } from "@/lib/raffle";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get("status");
    const activeOnly = searchParams.get("active") === "true";

    let raffles;

    if (activeOnly) {
      raffles = await getActiveRaffles();
    } else {
      raffles = await getRaffleList({
        status: statusFilter as 'draft' | 'active' | 'ended' | 'cancelled' | undefined,
      });
    }

    // 用户端只返回活动中和已结束的活动
    const publicRaffles = raffles.filter(
      (r) => r.status === "active" || r.status === "ended"
    );

    return NextResponse.json({
      success: true,
      raffles: publicRaffles,
    });
  } catch (error) {
    console.error("获取活动列表失败:", error);
    return NextResponse.json(
      { success: false, message: "获取活动列表失败" },
      { status: 500 }
    );
  }
}
