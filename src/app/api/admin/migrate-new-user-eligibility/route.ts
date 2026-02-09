import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { migrateNewUserEligibilityFromHistory } from "@/lib/kv";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限操作" },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => null)) as {
      dryRun?: unknown;
    } | null;

    const dryRun = body?.dryRun === true;

    const result = await migrateNewUserEligibilityFromHistory({
      dryRun,
      chunkSize: 500,
    });

    const actionWord = dryRun ? "预览" : "迁移";

    return NextResponse.json({
      success: true,
      message: `${actionWord}完成：新人项目 ${result.scopedProjects} 个，扫描记录 ${result.scannedRecords} 条，候选用户 ${result.candidateUsers} 人，${actionWord} ${result.migratedUsers} 人，已跳过（已标记）${result.skippedClaimedUsers} 人，已跳过（处理中）${result.skippedPendingUsers} 人。`,
      result,
    });
  } catch (error) {
    console.error("Migrate new user eligibility error:", error);
    return NextResponse.json(
      { success: false, message: "迁移失败，请稍后重试" },
      { status: 500 }
    );
  }
}
