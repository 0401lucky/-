import { NextResponse } from "next/server";
import {
  spinLotteryAuto,
} from "@/lib/lottery";
import { recordUser } from "@/lib/kv";
import { withUserRateLimit } from "@/lib/rate-limit";
import { createUserNotification } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export const POST = withUserRateLimit(
  "lottery:spin",
  async (_request, user) => {
    try {
      // 执行抽奖（内部已包含库存/额度/次数等校验）
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
