import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";

// GET - 获取档位的所有兑换码（分已使用和未使用）
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tier: string }> }
) {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限访问" },
        { status: 403 }
      );
    }

    const { tier: tierId } = await params;

    // 获取该档位的所有码
    const allCodes = await kv.smembers(`lottery:codes:${tierId}`) as string[];
    // 获取已使用的码
    const usedCodes = await kv.smembers(`lottery:used:${tierId}`) as string[];
    
    const usedSet = new Set(usedCodes);
    
    // 分类
    const used: string[] = [];
    const available: string[] = [];
    
    for (const code of allCodes) {
      if (usedSet.has(code)) {
        used.push(code);
      } else {
        available.push(code);
      }
    }
    
    // 排序
    used.sort();
    available.sort();

    return NextResponse.json({
      success: true,
      tierId,
      total: allCodes.length,
      usedCount: used.length,
      availableCount: available.length,
      used,
      available,
    });
  } catch (error) {
    console.error("Get tier detail error:", error);
    return NextResponse.json(
      { success: false, message: "获取档位详情失败" },
      { status: 500 }
    );
  }
}
