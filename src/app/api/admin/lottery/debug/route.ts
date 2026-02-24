import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import { kv } from '@/lib/d1-kv';
import { getLotteryRecords } from "@/lib/lottery";

export const dynamic = "force-dynamic";

const TIERS = ["tier_1", "tier_3", "tier_5", "tier_10", "tier_15", "tier_20"] as const;
type TierId = (typeof TIERS)[number];

type DebugCodeInfo = {
  code: string;
  codeLength: number;
  recordedTier: string;
  foundIn: TierId | null;
  hasPadding?: true;
  trimmedCode?: string;
  foundInAfterTrim?: TierId;
};

type TierSample = {
  count: number;
  sample: string | null;
  sampleLength: number;
};

// GET - 调试：查看已发放记录中的码是否存在于各档位
export const GET = withAdmin(async () => {
  try {
    const records = await getLotteryRecords(50);

    const debugInfo: DebugCodeInfo[] = await Promise.all(
      records.slice(0, 10).map(async (record) => {
        const codeInfo: DebugCodeInfo = {
          code: record.code,
          codeLength: record.code.length,
          recordedTier: record.tierName,
          foundIn: null,
        };

        // 并行检查所有档位
        const memberChecks = await Promise.all(
          TIERS.map((tierId) => kv.sismember(`lottery:codes:${tierId}`, record.code))
        );
        for (let i = 0; i < TIERS.length; i++) {
          if (memberChecks[i] === 1) {
            codeInfo.foundIn = TIERS[i];
            break;
          }
        }

        // 也检查 trim 后的码
        const trimmedCode = record.code.trim();
        if (trimmedCode !== record.code) {
          codeInfo.hasPadding = true;
          codeInfo.trimmedCode = trimmedCode;
          const trimChecks = await Promise.all(
            TIERS.map((tierId) => kv.sismember(`lottery:codes:${tierId}`, trimmedCode))
          );
          for (let i = 0; i < TIERS.length; i++) {
            if (trimChecks[i] === 1) {
              codeInfo.foundInAfterTrim = TIERS[i];
              break;
            }
          }
        }

        return codeInfo;
      })
    );

    // 并行获取各档位的样本码
    const tierEntries = await Promise.all(
      TIERS.map(async (tierId) => {
        const [sample, count] = await Promise.all([
          kv.srandmember(`lottery:codes:${tierId}`),
          kv.scard(`lottery:codes:${tierId}`),
        ]);
        return [tierId, {
          count,
          sample: sample ? String(sample) : null,
          sampleLength: sample ? String(sample).length : 0,
        }] as const;
      })
    );
    const tierSamples = Object.fromEntries(tierEntries) as Record<TierId, TierSample>;

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
});
