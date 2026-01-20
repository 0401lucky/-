import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { addCodesToTier, getLotteryConfig, getTierAvailableCodesCount } from "@/lib/lottery";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tier: string }> }
) {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限操作" },
        { status: 403 }
      );
    }

    const { tier: tierId } = await params;

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
    return NextResponse.json(
      { success: false, message: "添加兑换码失败" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tier: string }> }
) {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限访问" },
        { status: 403 }
      );
    }

    const { tier: tierId } = await params;

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
}
