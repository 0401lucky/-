import { NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { recalculateStats } from "@/lib/lottery";

export const dynamic = "force-dynamic";

// POST - 重新统计：根据已发放记录检索真实档位
export async function POST() {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限操作" },
        { status: 403 }
      );
    }

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
}
