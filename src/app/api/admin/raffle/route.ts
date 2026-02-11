/**
 * GET /api/admin/raffle - 获取管理列表
 * POST /api/admin/raffle - 创建活动
 */

import { NextResponse } from "next/server";
import { checkRaffleAdmin } from "./admin-auth";
import { getRaffleList, createRaffle } from "@/lib/raffle";
import type { CreateRaffleInput } from "@/lib/types/raffle";

export async function GET(request: Request) {
  const authResult = await checkRaffleAdmin();
  if ("error" in authResult) {
    return NextResponse.json(
      { success: false, message: authResult.error },
      { status: authResult.status }
    );
  }

  try {
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
}

export async function POST(request: Request) {
  const authResult = await checkRaffleAdmin();
  if ("error" in authResult) {
    return NextResponse.json(
      { success: false, message: authResult.error },
      { status: authResult.status }
    );
  }

  try {
    const body = await request.json() as CreateRaffleInput;

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

    if (!body.prizes || body.prizes.length === 0) {
      return NextResponse.json(
        { success: false, message: "请至少配置一个奖品" },
        { status: 400 }
      );
    }

    // 验证奖品配置
    for (const prize of body.prizes) {
      if (!prize.name?.trim()) {
        return NextResponse.json(
          { success: false, message: "奖品名称不能为空" },
          { status: 400 }
        );
      }
      if (typeof prize.dollars !== "number" || prize.dollars <= 0) {
        return NextResponse.json(
          { success: false, message: "奖品金额必须大于0" },
          { status: 400 }
        );
      }
      if (typeof prize.quantity !== "number" || prize.quantity <= 0) {
        return NextResponse.json(
          { success: false, message: "奖品数量必须大于0" },
          { status: 400 }
        );
      }
    }

    if (body.triggerType === "threshold" && (!body.threshold || body.threshold <= 0)) {
      return NextResponse.json(
        { success: false, message: "人数阈值必须大于0" },
        { status: 400 }
      );
    }

    const raffle = await createRaffle(body, authResult.userId);

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
}
