import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { kv } from "@vercel/kv";
import { getLotteryRecords } from "@/lib/lottery";

export const dynamic = "force-dynamic";

// GET - 调试：查看已发放记录中的码是否存在于各档位
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限操作" },
        { status: 403 }
      );
    }

    const records = await getLotteryRecords(50);
    const tiers = ['tier_1', 'tier_3', 'tier_5', 'tier_10', 'tier_15', 'tier_20'];
    
    const debugInfo = [];
    
    for (const record of records.slice(0, 10)) {
      const codeInfo: any = {
        code: record.code,
        codeLength: record.code.length,
        recordedTier: record.tierName,
        foundIn: null,
      };
      
      // 检查这个码存在于哪个档位
      for (const tierId of tiers) {
        const exists = await kv.sismember(`lottery:codes:${tierId}`, record.code);
        if (exists === 1) {
          codeInfo.foundIn = tierId;
          break;
        }
      }
      
      // 也检查 trim 后的码
      const trimmedCode = record.code.trim();
      if (trimmedCode !== record.code) {
        codeInfo.hasPadding = true;
        codeInfo.trimmedCode = trimmedCode;
        for (const tierId of tiers) {
          const exists = await kv.sismember(`lottery:codes:${tierId}`, trimmedCode);
          if (exists === 1) {
            codeInfo.foundInAfterTrim = tierId;
            break;
          }
        }
      }
      
      debugInfo.push(codeInfo);
    }
    
    // 获取各档位的一些样本码
    const tierSamples: any = {};
    for (const tierId of tiers) {
      const sample = await kv.srandmember(`lottery:codes:${tierId}`);
      const count = await kv.scard(`lottery:codes:${tierId}`);
      tierSamples[tierId] = {
        count,
        sample: sample ? String(sample) : null,
        sampleLength: sample ? String(sample).length : 0,
      };
    }

    return NextResponse.json({
      success: true,
      recordsChecked: debugInfo.length,
      records: debugInfo,
      tierSamples,
    });
  } catch (error) {
    console.error("Debug error:", error);
    return NextResponse.json(
      { success: false, message: String(error) },
      { status: 500 }
    );
  }
}
