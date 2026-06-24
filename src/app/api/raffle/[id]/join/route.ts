/**
 * POST /api/raffle/[id]/join - 参与抽奖
 */

import { NextRequest, NextResponse } from "next/server";
import { joinRaffle, executeRaffleDraw, getRaffle, getRaffleMode, grabRedPacket, isRaffleScheduledDrawDue } from "@/lib/raffle";
import { withUserRateLimit } from "@/lib/rate-limit";

export const POST = withUserRateLimit(
  "raffle:join",
  async (
    _request: NextRequest,
    user,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      const raffle = await getRaffle(id);
      if (!raffle) {
        return NextResponse.json(
          { success: false, message: "活动不存在" },
          { status: 404 }
        );
      }

      if (raffle.status !== "active") {
        return NextResponse.json(
          { success: false, message: "活动不在进行中" },
          { status: 400 }
        );
      }

      const isRedPacket = getRaffleMode(raffle) === "red_packet";
      if (!isRedPacket && isRaffleScheduledDrawDue(raffle)) {
        const drawResult = await executeRaffleDraw(id, { waitForDelivery: false });
        return NextResponse.json(
          {
            success: false,
            message: drawResult.success
              ? "活动已到开奖时间，已自动开奖，请刷新查看结果"
              : "活动已到开奖时间，正在开奖，请稍后刷新",
          },
          { status: 400 }
        );
      }

      const result = isRedPacket
        ? await grabRedPacket(id, user.id, user.username)
        : await joinRaffle(id, user.id, user.username);

      if (!result.success) {
        return NextResponse.json(
          { success: false, message: result.message },
          { status: 400 }
        );
      }

      if (result.shouldDraw) {
        try {
          const drawResult = await executeRaffleDraw(id, { waitForDelivery: false });
          if (!drawResult.success && drawResult.message !== "正在开奖中，请稍后") {
            console.error(`自动开奖未完成: ${drawResult.message}`);
          }
        } catch (err) {
          console.error("自动开奖失败:", err);
        }
      }

      return NextResponse.json({
        success: true,
        message: result.message,
        entry: result.entry,
        reward: result.reward,
        shouldDraw: result.shouldDraw,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'RAFFLE_JOIN_BUSY') {
        return NextResponse.json(
          { success: false, message: '当前参与人数较多，请稍后重试' },
          { status: 429 }
        );
      }

      console.error("参与抽奖失败:", error);
      return NextResponse.json(
        { success: false, message: "参与失败，请稍后重试" },
        { status: 500 }
      );
    }
  },
  { unauthorizedMessage: "请先登录" }
);
