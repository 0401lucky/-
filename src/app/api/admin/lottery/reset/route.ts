import { NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";

// POST - 重置抽奖库存（保留发放记录用于统计）
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
    
    // 只删除库存相关的 key，保留 records（发放记录）
    const keysToDelete: string[] = [];
    
    for (const tier of tiers) {
      keysToDelete.push(`lottery:codes:${tier}`);  // 库存
      keysToDelete.push(`lottery:used:${tier}`);   // 已使用标记
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

    // 重置配置中的库存计数（保留概率设置）
    const config = await kv.get<any>('lottery:config');
    if (config && config.tiers) {
      const updatedTiers = config.tiers.map((tier: any) => ({
        ...tier,
        codesCount: 0,
        usedCount: 0,
      }));
      await kv.set('lottery:config', { ...config, tiers: updatedTiers });
    }

    return NextResponse.json({
      success: true,
      message: `库存已重置（删除了 ${deleted} 个 key），发放记录已保留`,
      deleted,
      note: "请重新上传兑换码，然后点击'重新统计'来匹配已发放记录",
    });
  } catch (error) {
    console.error("Reset lottery system error:", error);
    return NextResponse.json(
      { success: false, message: "重置失败" },
      { status: 500 }
    );
  }
}
