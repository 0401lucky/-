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
      const result = await spinLotteryAuto(user.id, user.username, {
        bypassSpinLimit: user.isAdmin,
      });

      if (!result.success) {
        return NextResponse.json(
          { success: false, message: result.message },
          { status: 400 }
        );
      }

      void recordUser(user.id, user.username).catch((recordError) => {
        console.error("Record lottery user failed:", recordError);
      });

      if (result.record) {
        const record = result.record;
        let rewardText: string;
        if (typeof record.pointsAwarded === 'number') {
          rewardText = record.pointsAwarded > 0
            ? `获得 ${record.tierName}（+${record.pointsAwarded} 积分已到账）`
            : `本次未中奖：${record.tierName}`;
        } else if (record.directCredit) {
          rewardText = `获得 ${record.tierValue} 美金额度（已直充）`;
        } else {
          rewardText = `获得 ${record.tierName}${record.code ? '（兑换码已发放）' : ''}`;
        }

        void createUserNotification({
          userId: user.id,
          type: "lottery_win",
          title: "抽奖中奖通知",
          content: rewardText,
          data: {
            lotteryRecordId: record.id,
            tierName: record.tierName,
            tierValue: record.tierValue,
            directCredit: record.directCredit === true,
            pointsAwarded: record.pointsAwarded,
          },
        }).catch((notifyError) => {
          console.error("Create lottery notification failed:", notifyError);
        });
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
