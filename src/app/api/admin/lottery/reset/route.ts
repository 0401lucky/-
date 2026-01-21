import { NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";

// POST - 完全重置抽奖系统（清除所有旧数据）
export async function POST() {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限操作" },
        { status: 403 }
      );
    }

    const tiers = ['tier_1', 'tier_3', 'tier_5', 'tier_10', 'tier_15', 'tier_20'];
    
    // 删除所有可能的旧 key（无论是 List 还是 Set 类型）
    const keysToDelete = [
      'lottery:config',
      'lottery:records',
    ];
    
    for (const tier of tiers) {
      keysToDelete.push(`lottery:codes:${tier}`);
      keysToDelete.push(`lottery:used:${tier}`);
    }
    
    let deleted = 0;
    for (const key of keysToDelete) {
      try {
        const result = await kv.del(key);
        deleted += result;
      } catch (e) {
        console.log(`Failed to delete ${key}:`, e);
      }
    }

    return NextResponse.json({
      success: true,
      message: `系统重置完成，删除了 ${deleted} 个 key`,
      deleted,
    });
  } catch (error) {
    console.error("Reset lottery system error:", error);
    return NextResponse.json(
      { success: false, message: "重置失败" },
      { status: 500 }
    );
  }
}
