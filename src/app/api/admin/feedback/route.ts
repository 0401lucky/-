import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import {
  archiveClosedFeedback,
  listAllFeedback,
  type FeedbackStatus,
} from "@/lib/feedback";

export const dynamic = "force-dynamic";

const FEEDBACK_STATUSES = new Set<FeedbackStatus>([
  "open",
  "processing",
  "resolved",
  "closed",
]);

function parsePage(value: string | null): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, parsed);
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? "50", 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(100, parsed));
}

function parseStatus(value: string | null): FeedbackStatus | null {
  if (!value) return null;
  if (FEEDBACK_STATUSES.has(value as FeedbackStatus)) {
    return value as FeedbackStatus;
  }
  return null;
}

function parseBoolean(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();
    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限访问" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = parsePage(searchParams.get("page"));
    const limit = parseLimit(searchParams.get("limit"));
    const includeArchived = parseBoolean(searchParams.get("includeArchived"));

    const statusRaw = searchParams.get("status");
    const status = parseStatus(statusRaw);
    if (!includeArchived && statusRaw && !status) {
      return NextResponse.json(
        { success: false, message: "无效的反馈状态" },
        { status: 400 }
      );
    }

    let archiveResult:
      | {
          archivedCount: number;
          scannedCount: number;
          thresholdTime: number;
          remainingCount: number;
        }
      | null = null;

    if (!includeArchived) {
      try {
        archiveResult = await archiveClosedFeedback({
          olderThanDays: 60,
          limit: 200,
        });
      } catch (archiveError) {
        console.error("Archive closed feedback error:", archiveError);
      }
    }

    const { items, pagination } = await listAllFeedback({
      page,
      limit,
      status: includeArchived ? undefined : status ?? undefined,
      includeArchived,
    });

    return NextResponse.json({
      success: true,
      items,
      pagination,
      includeArchived,
      archive: archiveResult,
    });
  } catch (error) {
    console.error("List admin feedback error:", error);
    return NextResponse.json(
      { success: false, message: "获取反馈列表失败" },
      { status: 500 }
    );
  }
}
