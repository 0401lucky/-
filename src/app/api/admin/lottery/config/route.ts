import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import { updateLotteryTiers, updateLotteryConfig, getLotteryConfig } from "@/lib/lottery";

export const dynamic = "force-dynamic";

export const PATCH = withAdmin(async (request: NextRequest) => {
  try {
    const body = await request.json();

    // 更新启用状态
    if (typeof body.enabled === "boolean") {
      await updateLotteryConfig({ enabled: body.enabled });
    }

    // 新版幸运抽奖统一使用站内积分，旧兑换码/美元模式只保留历史读取。
    if (body.mode && body.mode !== "points") {
      return NextResponse.json(
        { success: false, message: "当前仅支持积分抽奖模式" },
        { status: 400 }
      );
    }
    await updateLotteryConfig({ mode: "points" });

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

      // 启用奖项的概率合计必须为 100%；停用奖项不参与抽取。
      const enabledTiers = body.tiers.filter((t: { enabled?: boolean }) => t.enabled !== false);
      if (enabledTiers.length === 0) {
        return NextResponse.json(
          { success: false, message: "至少需要启用一个奖项" },
          { status: 400 }
        );
      }

      const totalProbability = enabledTiers.reduce(
        (sum: number, t: { probability: number }) => sum + (Number(t.probability) || 0),
        0
      );

      // [M4修复] 使用浮点数容差比较
      if (Math.abs(totalProbability - 100) > 0.01) {
        return NextResponse.json(
          { success: false, message: `概率总和必须为100%，当前为${totalProbability.toFixed(2)}%` },
          { status: 400 }
        );
      }

      // 验证每个奖项字段
      for (const tier of body.tiers) {
        if (typeof tier.id !== "string") {
          return NextResponse.json(
            { success: false, message: "奖项配置格式错误" },
            { status: 400 }
          );
        }
        if (typeof tier.name !== "undefined" && (typeof tier.name !== "string" || !tier.name.trim())) {
          return NextResponse.json(
            { success: false, message: "奖项名称不能为空" },
            { status: 400 }
          );
        }
        if (typeof tier.value !== "undefined" && (!Number.isSafeInteger(tier.value) || tier.value < 0)) {
          return NextResponse.json(
            { success: false, message: "奖项积分必须是非负整数" },
            { status: 400 }
          );
        }
        if (typeof tier.color !== "undefined" && (typeof tier.color !== "string" || !tier.color.trim())) {
          return NextResponse.json(
            { success: false, message: "奖项颜色不能为空" },
            { status: 400 }
          );
        }
        if (typeof tier.enabled !== "undefined" && typeof tier.enabled !== "boolean") {
          return NextResponse.json(
            { success: false, message: "启停状态格式错误" },
            { status: 400 }
          );
        }
        if (typeof tier.probability !== "number" || tier.probability < 0 || tier.probability > 100) {
          return NextResponse.json(
            { success: false, message: "概率值必须在0-100之间" },
            { status: 400 }
          );
        }
      }

      await updateLotteryTiers(body.tiers);
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
          value: t.value,
          color: t.color,
          probability: t.probability,
          enabled: t.enabled !== false,
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
});
