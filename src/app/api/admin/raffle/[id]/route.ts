/**
 * GET /api/admin/raffle/[id] - 获取活动详情（管理）
 * PUT /api/admin/raffle/[id] - 更新活动
 * DELETE /api/admin/raffle/[id] - 删除活动
 */

import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import type { AuthUser } from "@/lib/auth";
import {
  getRaffle,
  updateRaffle,
  deleteRaffle,
  getRaffleEntries,
  processQueuedRaffleDeliveries,
} from "@/lib/raffle";
import type { UpdateRaffleInput } from "@/lib/types/raffle";

export const GET = withAdmin(async (
  _request: Request,
  _user: AuthUser,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await context.params;

    // Hobby 计划下 Cron 触发频率有限，管理端详情访问时顺带推进一轮队列。
    try {
      await processQueuedRaffleDeliveries(1);
    } catch (error) {
      console.error("管理端详情触发发奖队列失败:", error);
    }

    const raffle = await getRaffle(id);
    if (!raffle) {
      return NextResponse.json(
        { success: false, message: "活动不存在" },
        { status: 404 }
      );
    }

    // 获取参与者列表
    const entries = await getRaffleEntries(id, 100, 0);

    return NextResponse.json({
      success: true,
      raffle,
      entries,
    });
  } catch (error) {
    console.error("获取活动详情失败:", error);
    return NextResponse.json(
      { success: false, message: "获取活动详情失败" },
      { status: 500 }
    );
  }
});

export const PUT = withAdmin(async (
  request: Request,
  _user: AuthUser,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await context.params;
    const body = await request.json() as UpdateRaffleInput;

    const raffle = await updateRaffle(id, body);
    if (!raffle) {
      return NextResponse.json(
        { success: false, message: "活动不存在" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "更新成功",
      raffle,
    });
  } catch (error) {
    console.error("更新活动失败:", error);
    const message = error instanceof Error ? error.message : "更新失败";
    return NextResponse.json(
      { success: false, message },
      { status: 400 }
    );
  }
});

export const DELETE = withAdmin(async (
  _request: Request,
  _user: AuthUser,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await context.params;

    const success = await deleteRaffle(id);
    if (!success) {
      return NextResponse.json(
        { success: false, message: "活动不存在" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "删除成功",
    });
  } catch (error) {
    console.error("删除活动失败:", error);
    const message = error instanceof Error ? error.message : "删除失败";
    return NextResponse.json(
      { success: false, message },
      { status: 400 }
    );
  }
});


