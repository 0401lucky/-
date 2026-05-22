import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import { previewNumberBombSystemNumber } from "@/lib/number-bomb";

export const dynamic = "force-dynamic";

export const GET = withAdmin(async () => {
  try {
    const preview = await previewNumberBombSystemNumber();
    return NextResponse.json({
      success: true,
      data: preview,
    });
  } catch (error) {
    console.error("Preview number bomb system number error:", error);
    return NextResponse.json(
      { success: false, message: "获取数字炸弹明日数字失败" },
      { status: 500 },
    );
  }
});
