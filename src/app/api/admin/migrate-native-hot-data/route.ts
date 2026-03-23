import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import { migrateNativeHotData } from "@/lib/native-hot-migration";

export const dynamic = "force-dynamic";

export const POST = withAdmin(async (request: NextRequest) => {
  try {
    const body = (await request.json().catch(() => null)) as {
      dryRun?: unknown;
    } | null;

    const dryRun = body?.dryRun === true;
    const result = await migrateNativeHotData({ dryRun });

    return NextResponse.json({
      success: true,
      message: dryRun
        ? `预演完成：用户 ${result.users} 人，积分流水 ${result.pointsLogs} 条，签到 ${result.checkins} 条，游戏记录 ${result.gameRecords} 条。`
        : `迁移完成：用户 ${result.users} 人，积分流水 ${result.pointsLogs} 条，签到 ${result.checkins} 条，游戏记录 ${result.gameRecords} 条，今日老虎机榜 ${result.slotRankingUsers} 人。`,
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
