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

    // 更新发放模式
    if (body.mode && ['code', 'direct', 'hybrid'].includes(body.mode)) {
      await updateLotteryConfig({ mode: body.mode });
    }

    // 更新每日直充上限
    if (typeof body.dailyDirectLimit === "number" && body.dailyDirectLimit >= 0) {
      await updateLotteryConfig({ dailyDirectLimit: body.dailyDirectLimit });
    }

    // 更新概率配置
    if (Array.isArray(body.tiers)) {
      // [M4修复] 获取当前配置，确保提交了所有档位
      const currentConfig = await getLotteryConfig();
      const requiredTierIds = new Set(currentConfig.tiers.map(t => t.id));
      const submittedTierIds = new Set(body.tiers.map((t: { id: string }) => t.id));
      
      // 检查是否提交了所有必需的档位
      const missingTiers = [...requiredTierIds].filter(id => !submittedTierIds.has(id));
      if (missingTiers.length > 0) {
        return NextResponse.json(
          { success: false, message: `缺少档位配置: ${missingTiers.join(', ')}` },
          { status: 400 }
        );
      }
      
      // 验证概率总和
      const totalProbability = body.tiers.reduce(
        (sum: number, t: { probability: number }) => sum + (t.probability || 0),
        0
      );

      // [M4修复] 使用浮点数容差比较
      if (Math.abs(totalProbability - 100) > 0.01) {
        return NextResponse.json(
          { success: false, message: `概率总和必须为100%，当前为${totalProbability.toFixed(2)}%` },
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
        mode: updatedConfig.mode,
        dailyDirectLimit: updatedConfig.dailyDirectLimit,
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
