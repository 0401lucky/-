import { NextResponse } from "next/server";
import {
  spinLotteryAuto,
  getLotteryConfig,
  checkAllTiersHaveCodes,
  checkDailyDirectLimit,
  getMinTierValue,
} from "@/lib/lottery";
import { recordUser, getExtraSpinCount, checkDailyLimit } from "@/lib/kv";
import { withUserRateLimit } from "@/lib/rate-limit";
import { createUserNotification } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export const POST = withUserRateLimit(
  "lottery:spin",
  async (_request, user) => {
    try {
      // 检查抽奖是否启用
      const config = await getLotteryConfig();
      if (!config.enabled) {
        return NextResponse.json(
          { success: false, message: "抽奖活动暂未开放" },
          { status: 400 }
        );
      }

      // 根据模式检查可用性
      // direct 模式：只检查直充额度
      // code 模式：只检查兑换码库存
      // hybrid 模式：至少有一个可用即可（具体由 spinLotteryAuto 内部处理降级）
      const minTierValue = await getMinTierValue();

      if (config.mode === "code") {
        const allHaveCodes = await checkAllTiersHaveCodes();
        if (!allHaveCodes) {
          return NextResponse.json(
            { success: false, message: "库存不足，暂时无法抽奖" },
            { status: 400 }
          );
        }
      } else if (config.mode === "direct") {
        const canDirect = await checkDailyDirectLimit(minTierValue);
        if (!canDirect) {
          return NextResponse.json(
            { success: false, message: "今日发放额度已达上限，请明日再试" },
            { status: 400 }
          );
        }
      } else if (config.mode === "hybrid") {
        // hybrid 模式：直充可用 OR 兑换码可用
        const canDirect = await checkDailyDirectLimit(minTierValue);
        const allHaveCodes = await checkAllTiersHaveCodes();
        if (!canDirect && !allHaveCodes) {
          return NextResponse.json(
            { success: false, message: "当前无法抽奖（直充额度已满且库存不足）" },
            { status: 400 }
          );
        }
      }

      // 检查是否有资格抽奖（免费次数 或 额外次数）
      // 管理员：仅绕过“次数限制”，仍遵守库存/直充日额度等限制
      if (!user.isAdmin) {
        const hasFreeSpin = !(await checkDailyLimit(user.id));
        const extraSpins = await getExtraSpinCount(user.id);

        if (!hasFreeSpin && extraSpins <= 0) {
          return NextResponse.json(
            { success: false, message: "今日免费次数已用完，请签到获取更多机会" },
            { status: 400 }
          );
        }
      }

      // 执行抽奖（根据配置自动选择模式：直充/兑换码/混合）
      const result = await spinLotteryAuto(user.id, user.username, {
        bypassSpinLimit: user.isAdmin,
      });

      if (!result.success) {
        return NextResponse.json(
          { success: false, message: result.message },
          { status: 400 }
        );
      }

      // 记录用户信息（如果是新用户会自动记录）
      await recordUser(user.id, user.username);

      if (result.record) {
        try {
          const rewardText = result.record.directCredit
            ? "获得 " + result.record.tierValue + " 美金额度（已直充）"
            : "获得 " +
              result.record.tierName +
              (result.record.code ? "（兑换码已发放）" : "");

          await createUserNotification({
            userId: user.id,
            type: "lottery_win",
            title: "抽奖中奖通知",
            content: rewardText,
            data: {
              lotteryRecordId: result.record.id,
              tierName: result.record.tierName,
              tierValue: result.record.tierValue,
              directCredit: result.record.directCredit === true,
            },
          });
        } catch (notifyError) {
          console.error("Create lottery notification failed:", notifyError);
        }
      }

      return NextResponse.json({
        success: true,
        message: result.message,
        record: result.record,
      });
    } catch (error) {
      console.error("Spin lottery error:", error);
      return NextResponse.json(
        { success: false, message: "抽奖失败，请重试" },
        { status: 500 }
      );
    }
  },
  { unauthorizedMessage: "请先登录" }
);
