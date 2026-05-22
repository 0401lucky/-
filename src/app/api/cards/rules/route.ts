import { NextResponse } from "next/server";
import { getCardRulesConfig } from "@/lib/cards/rules";

export const dynamic = "force-dynamic";

export async function GET() {
  const rules = await getCardRulesConfig();
  return NextResponse.json({ success: true, data: rules });
}
