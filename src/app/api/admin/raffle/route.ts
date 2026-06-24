/**
 * GET /api/admin/raffle - 获取管理列表
 * POST /api/admin/raffle - 创建活动
 */

import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import {
  getRaffleList,
  createRaffle,
  processQueuedRaffleDeliveries,
  normalizeRaffleRewardPoints,
  normalizeRedPacketConfig,
} from "@/lib/raffle";
import { parseChinaDateTimeInput } from "@/lib/time";
import type { CreateRaffleInput } from "@/lib/types/raffle";

function normalizeChinaTimestamp(value: unknown): number | null | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  return parseChinaDateTimeInput(value);
}

export const GET = withAdmin(async (request: Request) => {
  try {
    // Hobby 计划下 Cron 触发频率有限，管理端访问时顺带推进一轮队列。
    try {
      await processQueuedRaffleDeliveries(1);
    } catch (error) {
      console.error("管理端列表触发发奖队列失败:", error);
    }

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get("status");

    const raffles = await getRaffleList({
      status: statusFilter as 'draft' | 'active' | 'ended' | 'cancelled' | undefined,
    });

    return NextResponse.json({
      success: true,
      raffles,
    });
  } catch (error) {
    console.error("获取活动列表失败:", error);
    return NextResponse.json(
      { success: false, message: "获取活动列表失败" },
      { status: 500 }
    );
  }
});

export const POST = withAdmin(async (request: Request, user) => {
  try {
    const rawBody = await request.json() as CreateRaffleInput & { scheduledDrawAt?: unknown };
    const scheduledDrawAt = normalizeChinaTimestamp(rawBody.scheduledDrawAt);
    const body: CreateRaffleInput = {
      ...rawBody,
      scheduledDrawAt: scheduledDrawAt ?? undefined,
    };
    const mode = body.mode === "red_packet" ? "red_packet" : "draw";

    // 验证必填字段
    if (!body.title?.trim()) {
      return NextResponse.json(
        { success: false, message: "请填写活动标题" },
        { status: 400 }
      );
    }

    if (!body.description?.trim()) {
      return NextResponse.json(
        { success: false, message: "请填写活动描述" },
        { status: 400 }
      );
    }

    if (mode === "draw" && (!body.prizes || body.prizes.length === 0)) {
      return NextResponse.json(
        { success: false, message: "请至少配置一个奖品" },
        { status: 400 }
      );
    }

    if (mode === "draw") {
      // 验证奖品配置
      for (const prize of body.prizes ?? []) {
        if (!prize.name?.trim()) {
          return NextResponse.json(
            { success: false, message: "奖品名称不能为空" },
            { status: 400 }
          );
        }
        if (normalizeRaffleRewardPoints(prize.points, prize.dollars) === null) {
          return NextResponse.json(
            { success: false, message: "奖品积分必须大于0" },
            { status: 400 }
          );
        }
        if (!Number.isSafeInteger(prize.quantity) || prize.quantity <= 0) {
          return NextResponse.json(
            { success: false, message: "奖品数量必须为正整数" },
            { status: 400 }
          );
        }
      }
    } else {
      try {
        normalizeRedPacketConfig(body);
      } catch (error) {
        const message = error instanceof Error ? error.message : "红包配置不正确";
        return NextResponse.json(
          { success: false, message },
          { status: 400 }
        );
      }
    }

    if (
      mode === "draw"
      && body.triggerType === "threshold"
      && (!Number.isSafeInteger(body.threshold) || (body.threshold ?? 0) <= 0)
    ) {
      return NextResponse.json(
        { success: false, message: "人数阈值必须为正整数" },
        { status: 400 }
      );
    }

    if (mode === "draw" && body.triggerType === "scheduled") {
      if (scheduledDrawAt === null) {
        return NextResponse.json(
          { success: false, message: "开奖时间格式不正确，请按中国时间选择有效时间" },
          { status: 400 }
        );
      }
      if (scheduledDrawAt === undefined) {
        return NextResponse.json(
          { success: false, message: "请选择到点开奖时间" },
          { status: 400 }
        );
      }
    }

    const raffle = await createRaffle(body, user.id);

    return NextResponse.json({
      success: true,
      message: "活动创建成功",
      raffle,
    });
  } catch (error) {
    console.error("创建活动失败:", error);
    return NextResponse.json(
      { success: false, message: "创建活动失败" },
      { status: 500 }
    );
  }
});
