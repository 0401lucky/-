import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import { getCardRulesConfig, updateCardRulesConfig } from "@/lib/cards/rules";

export const dynamic = "force-dynamic";

export const GET = withAdmin(async () => {
  const rules = await getCardRulesConfig();
  return NextResponse.json({ success: true, data: rules });
});

export const PATCH = withAdmin(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const rules = await updateCardRulesConfig(body);
    return NextResponse.json({ success: true, data: rules, message: "卡牌规则已保存" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存卡牌规则失败";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
});
