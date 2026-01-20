import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { updateTiersProbability, updateLotteryConfig, getLotteryConfig } from "@/lib/lottery";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限操作" },
        { status: 403 }
      );
    }

    const body = await request.json();

    // 更新启用状态
    if (typeof body.enabled === "boolean") {
      await updateLotteryConfig({ enabled: body.enabled });
    }

    // 更新概率配置
    if (Array.isArray(body.tiers)) {
      // 验证概率总和
      const totalProbability = body.tiers.reduce(
        (sum: number, t: { probability: number }) => sum + (t.probability || 0),
        0
      );

      if (totalProbability !== 100) {
        return NextResponse.json(
          { success: false, message: `概率总和必须为100%，当前为${totalProbability}%` },
          { status: 400 }
        );
      }

      // 验证每个概率值
      for (const tier of body.tiers) {
        if (typeof tier.id !== "string" || typeof tier.probability !== "number") {
          return NextResponse.json(
            { success: false, message: "概率配置格式错误" },
            { status: 400 }
          );
        }
        if (tier.probability < 0 || tier.probability > 100) {
          return NextResponse.json(
            { success: false, message: "概率值必须在0-100之间" },
            { status: 400 }
          );
        }
      }

      await updateTiersProbability(body.tiers);
    }

    const updatedConfig = await getLotteryConfig();

    return NextResponse.json({
      success: true,
      message: "配置更新成功",
      config: {
        enabled: updatedConfig.enabled,
        tiers: updatedConfig.tiers.map((t) => ({
          id: t.id,
          name: t.name,
          probability: t.probability,
        })),
      },
    });
  } catch (error) {
    console.error("Update lottery config error:", error);
    return NextResponse.json(
      { success: false, message: "更新配置失败" },
      { status: 500 }
    );
  }
}
