import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import {
  addFeedbackMessage,
  getFeedbackById,
} from "@/lib/feedback";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const MAX_MESSAGE_LENGTH = 1000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user || !isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限访问" },
        { status: 403 }
      );
    }

    const rateLimitResult = await checkRateLimit(user.id.toString(), {
      prefix: "ratelimit:admin:feedback:message",
      windowSeconds: 60,
      maxRequests: 60,
    });
    if (!rateLimitResult.success) {
      return rateLimitResponse(rateLimitResult);
    }

    const { id } = await params;
    const feedback = await getFeedbackById(id);
    if (!feedback) {
      return NextResponse.json(
        { success: false, message: "反馈不存在" },
        { status: 404 }
      );
    }

    const body = (await request.json().catch(() => null)) as {
      content?: unknown;
    } | null;
    const content =
      typeof body?.content === "string" ? body.content.trim() : "";

    if (!content) {
      return NextResponse.json(
        { success: false, message: "回复内容不能为空" },
        { status: 400 }
      );
    }

    if (content.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        {
          success: false,
          message: `回复内容不能超过 ${MAX_MESSAGE_LENGTH} 字`,
        },
        { status: 400 }
      );
    }

    const result = await addFeedbackMessage(
      id,
      "admin",
      content,
      user.username
    );

    return NextResponse.json(
      {
        success: true,
        message: "回复成功",
        feedback: result.feedback,
        feedbackMessage: result.message,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Reply feedback error:", error);
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "回复失败，请稍后重试",
      },
      { status: 400 }
    );
  }
}
