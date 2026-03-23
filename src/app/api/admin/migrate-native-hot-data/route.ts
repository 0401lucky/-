import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import { migrateNativeHotData } from "@/lib/native-hot-migration";

export const dynamic = "force-dynamic";

export const POST = withAdmin(async (request: NextRequest) => {
  try {
    const body = (await request.json().catch(() => null)) as {
      dryRun?: unknown;
      offset?: unknown;
      limit?: unknown;
      reset?: unknown;
      finalize?: unknown;
    } | null;

    const dryRun = body?.dryRun === true;
    const offset = Number.isFinite(Number(body?.offset)) ? Math.max(0, Math.floor(Number(body?.offset))) : 0;
    const limit = Number.isFinite(Number(body?.limit)) ? Math.max(1, Math.min(50, Math.floor(Number(body?.limit)))) : 10;
    const reset = body?.reset === true;
    const finalize = body?.finalize === true;

    const result = await migrateNativeHotData({
      dryRun,
      offset,
      limit,
      reset,
      finalize,
    });

    return NextResponse.json({
      success: true,
      message: dryRun
        ? `预演完成：总用户 ${result.users} 人，本批 ${result.migratedUsers} 人，积分流水 ${result.pointsLogs} 条，签到 ${result.checkins} 条，游戏记录 ${result.gameRecords} 条。`
        : `迁移批次完成：总用户 ${result.users} 人，本批 ${result.migratedUsers} 人，积分流水 ${result.pointsLogs} 条，签到 ${result.checkins} 条，游戏记录 ${result.gameRecords} 条，今日老虎机榜 ${result.slotRankingUsers} 人。`,
      result,
    });
  } catch (error) {
    console.error("Migrate native hot data error:", error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "迁移失败" },
      { status: 500 },
    );
  }
});
