/**
 * POST /api/internal/scheduled-maintenance
 * Cloudflare Cron 定时维护：自动暂停到点项目、自动开奖到点抽奖。
 */

import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { pauseDueProjects } from "@/lib/kv";
import { processDueScheduledRaffleDraws } from "@/lib/raffle";
import { enforceTrustedApiRequest } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function sanitizeSecretValue(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/\\r\\n|\\n|\\r/g, "")
    .replace(/[\r\n]/g, "")
    .trim();
}

function getAccessToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = sanitizeSecretValue(authHeader.slice(7));
    return token || null;
  }

  const scheduledHeader = sanitizeSecretValue(request.headers.get("x-scheduled-maintenance-secret"));
  if (scheduledHeader) return scheduledHeader;

  const fallbackHeader = sanitizeSecretValue(request.headers.get("x-raffle-delivery-secret"));
  if (fallbackHeader) return fallbackHeader;

  return null;
}

function isAuthorized(request: NextRequest): boolean {
  const secret = sanitizeSecretValue(
    process.env.SCHEDULED_MAINTENANCE_SECRET ??
    process.env.RAFFLE_DELIVERY_CRON_SECRET ??
    process.env.CRON_SECRET
  );
  if (!secret) return false;

  const token = getAccessToken(request);
  if (!token || token.length !== secret.length) return false;

  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

function parseNow(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function resolveNow(request: NextRequest): Promise<number> {
  const queryNow = parseNow(new URL(request.url).searchParams.get("now"));
  if (queryNow !== undefined) return queryNow;

  if (request.method === "POST") {
    try {
      const body = await request.json() as { now?: number };
      const bodyNow = parseNow(body?.now);
      if (bodyNow !== undefined) return bodyNow;
    } catch {
      // 忽略空 body 或非 JSON body
    }
  }

  return Date.now();
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { success: false, message: "未授权" },
      { status: 401 }
    );
  }

  try {
    const now = await resolveNow(request);
    const [projects, raffles] = await Promise.all([
      pauseDueProjects(now),
      processDueScheduledRaffleDraws(now),
    ]);

    return NextResponse.json({
      success: true,
      now,
      projects,
      raffles,
    });
  } catch (error) {
    console.error("定时维护任务失败:", error);
    return NextResponse.json(
      { success: false, message: "定时维护任务失败" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  const blocked = enforceTrustedApiRequest(request);
  if (blocked) {
    return blocked;
  }

  return handle(request);
}
