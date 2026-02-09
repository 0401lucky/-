import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import {
  getFeedbackById,
  getFeedbackMessages,
  updateFeedbackStatus,
  type FeedbackStatus,
} from "@/lib/feedback";

export const dynamic = "force-dynamic";

const FEEDBACK_STATUSES = new Set<FeedbackStatus>([
  "open",
  "processing",
  "resolved",
  "closed",
]);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限访问" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const feedback = await getFeedbackById(id);

    if (!feedback) {
      return NextResponse.json(
        { success: false, message: "反馈不存在" },
        { status: 404 }
      );
    }

    const messages = await getFeedbackMessages(id);

    return NextResponse.json({
      success: true,
      feedback,
      messages: [...messages].reverse(),
    });
  } catch (error) {
    console.error("Get admin feedback detail error:", error);
    return NextResponse.json(
      { success: false, message: "获取反馈详情失败" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限访问" },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => null)) as {
      status?: unknown;
    } | null;
    const status = typeof body?.status === "string" ? body.status : "";

    if (!FEEDBACK_STATUSES.has(status as FeedbackStatus)) {
      return NextResponse.json(
        { success: false, message: "无效的反馈状态" },
        { status: 400 }
      );
    }

    const { id } = await params;
    const updated = await updateFeedbackStatus(id, status as FeedbackStatus);

    if (!updated) {
      return NextResponse.json(
        { success: false, message: "反馈不存在" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "状态更新成功",
      feedback: updated,
    });
  } catch (error) {
    console.error("Update admin feedback status error:", error);
    return NextResponse.json(
      { success: false, message: "状态更新失败" },
      { status: 500 }
    );
  }
}
