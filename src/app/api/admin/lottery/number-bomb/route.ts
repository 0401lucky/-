import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import {
  getNumberBombRecentAdminStats,
  previewNumberBombSystemNumber,
} from "@/lib/number-bomb";

export const dynamic = "force-dynamic";

export const GET = withAdmin(async () => {
  try {
    const [preview, recentStats] = await Promise.all([
      previewNumberBombSystemNumber(),
      getNumberBombRecentAdminStats(7),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        ...preview,
        recentStats,
      },
    });
  } catch (error) {
    console.error("Preview number bomb system number error:", error);
    return NextResponse.json(
      { success: false, message: "获取数字炸弹今天数字失败" },
      { status: 500 },
    );
  }
});
