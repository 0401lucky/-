import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import { recalculateStats } from "@/lib/lottery";

export const dynamic = "force-dynamic";

// POST - 重新统计：根据已发放记录检索真实档位
export const POST = withAdmin(async () => {
  try {
    const result = await recalculateStats();

    return NextResponse.json({
      success: true,
      message: `处理了 ${result.processed} 条记录，发现 ${result.corrected} 条档位不匹配`,
      ...result,
    });
  } catch (error) {
    console.error("Recalculate stats error:", error);
    return NextResponse.json(
      { success: false, message: "重新统计失败" },
      { status: 500 }
    );
  }
});
