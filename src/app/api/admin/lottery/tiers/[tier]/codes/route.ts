import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import type { AuthUser } from "@/lib/auth";
import { addCodesToTier, getLotteryConfig, getTierAvailableCodesCount, clearTierCodes } from "@/lib/lottery";

export const dynamic = "force-dynamic";

export const POST = withAdmin(async (
  request: NextRequest,
  _user: AuthUser,
  context: { params: Promise<{ tier: string }> }
) => {
  try {
    const { tier: tierId } = await context.params;

    // 验证档位是否存在
    const config = await getLotteryConfig();
    const tierExists = config.tiers.some((t) => t.id === tierId);
    if (!tierExists) {
      return NextResponse.json(
        { success: false, message: "档位不存在" },
        { status: 404 }
      );
    }

    const formData = await request.formData();
    const codesFile = formData.get("codes") as File | null;

    if (!codesFile) {
      return NextResponse.json(
        { success: false, message: "请上传兑换码文件" },
        { status: 400 }
      );
    }

    const text = await codesFile.text();
    const codes = text
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (codes.length === 0) {
      return NextResponse.json(
        { success: false, message: "文件中没有有效的兑换码" },
        { status: 400 }
      );
    }

    await addCodesToTier(tierId, codes);
    const available = await getTierAvailableCodesCount(tierId);

    return NextResponse.json({
      success: true,
      message: `成功添加 ${codes.length} 个兑换码`,
      codesAdded: codes.length,
      available,
    });
  } catch (error) {
    console.error("Add lottery codes error:", error);
    const errorMessage = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json(
      { success: false, message: `添加兑换码失败: ${errorMessage}` },
      { status: 500 }
    );
  }
});

export const GET = withAdmin(async (
  _request: NextRequest,
  _user: AuthUser,
  context: { params: Promise<{ tier: string }> }
) => {
  try {
    const { tier: tierId } = await context.params;

    // 验证档位是否存在
    const config = await getLotteryConfig();
    const tier = config.tiers.find((t) => t.id === tierId);
    if (!tier) {
      return NextResponse.json(
        { success: false, message: "档位不存在" },
        { status: 404 }
      );
    }

    const available = await getTierAvailableCodesCount(tierId);

    return NextResponse.json({
      success: true,
      tier: {
        ...tier,
        available,
      },
    });
  } catch (error) {
    console.error("Get tier codes info error:", error);
    return NextResponse.json(
      { success: false, message: "获取档位信息失败" },
      { status: 500 }
    );
  }
});

// DELETE - 清空档位库存
export const DELETE = withAdmin(async (
  _request: NextRequest,
  _user: AuthUser,
  context: { params: Promise<{ tier: string }> }
) => {
  try {
    const { tier: tierId } = await context.params;

    // 验证档位是否存在
    const config = await getLotteryConfig();
    const tierExists = config.tiers.some((t) => t.id === tierId);
    if (!tierExists) {
      return NextResponse.json(
        { success: false, message: "档位不存在" },
        { status: 404 }
      );
    }

    const result = await clearTierCodes(tierId);

    return NextResponse.json({
      success: true,
      message: `已清空 ${result.cleared} 个兑换码`,
      cleared: result.cleared,
    });
  } catch (error) {
    console.error("Clear tier codes error:", error);
    return NextResponse.json(
      { success: false, message: "清空库存失败" },
      { status: 500 }
    );
  }
});


