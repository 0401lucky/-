/**
 * GET/POST /api/internal/raffle/delivery
 * 处理发奖队列（建议通过 Vercel Cron 调用）
 */

import { NextRequest, NextResponse } from "next/server";
import { processQueuedRaffleDeliveries } from "@/lib/raffle";

export const dynamic = "force-dynamic";

function sanitizeSecretValue(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .replace(/\\r\\n|\\n|\\r/g, "")
    .replace(/[\r\n]/g, "")
    .trim();
}

function parseMaxJobs(value: string | null | undefined): number {
  if (value == null || value === "") {
    return 3;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 3;
  }
  return Math.max(1, Math.min(Math.floor(parsed), 20));
}

function getAccessToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = sanitizeSecretValue(authHeader.slice(7));
    return token || null;
  }

  const customHeader = sanitizeSecretValue(request.headers.get("x-raffle-delivery-secret"));
  if (customHeader) {
    return customHeader;
  }

  return null;
}

function isAuthorized(request: NextRequest): boolean {
  const secret = sanitizeSecretValue(
    process.env.RAFFLE_DELIVERY_CRON_SECRET ?? process.env.CRON_SECRET
  );
  if (!secret) {
    return false;
  }
  const token = getAccessToken(request);
  return token === secret;
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { success: false, message: "未授权" },
      { status: 401 }
    );
  }

  try {
    let maxJobs = parseMaxJobs(new URL(request.url).searchParams.get("maxJobs"));

    if (request.method === "POST") {
      try {
        const body = await request.json() as { maxJobs?: number };
        if (body?.maxJobs !== undefined) {
          maxJobs = parseMaxJobs(String(body.maxJobs));
        }
      } catch {
        // 忽略无 body 或解析失败，使用 query/default
      }
    }

    const result = await processQueuedRaffleDeliveries(maxJobs);
    return NextResponse.json(result);
  } catch (error) {
    console.error("处理发奖队列失败:", error);
    return NextResponse.json(
      { success: false, message: "处理发奖队列失败" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
