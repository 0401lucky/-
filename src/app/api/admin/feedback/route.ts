import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { listAllFeedback, type FeedbackStatus } from "@/lib/feedback";

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

    const statusRaw = searchParams.get("status");
    const status = parseStatus(statusRaw);
    if (statusRaw && !status) {
      return NextResponse.json(
        { success: false, message: "无效的反馈状态" },
        { status: 400 }
      );
    }

    const { items, pagination } = await listAllFeedback({
      page,
      limit,
      status: status ?? undefined,
    });

    return NextResponse.json({
      success: true,
      items,
      pagination,
    });
  } catch (error) {
    console.error("List admin feedback error:", error);
    return NextResponse.json(
      { success: false, message: "获取反馈列表失败" },
      { status: 500 }
    );
  }
}
