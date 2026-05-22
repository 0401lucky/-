import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getFeedbackById, toggleFeedbackLike } from "@/lib/feedback";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "请先登录" },
        { status: 401 }
      );
    }

    const rateLimitResult = await checkRateLimit(user.id.toString(), {
      prefix: "ratelimit:feedback:like",
      windowSeconds: 60,
      maxRequests: 60,
    });
    if (!rateLimitResult.success) {
      return rateLimitResponse(rateLimitResult);
    }

    const { id } = await params;
    const feedback = await getFeedbackById(id);
    if (!feedback || feedback.anonymous) {
      return NextResponse.json(
        { success: false, message: "反馈不存在" },
        { status: 404 }
      );
    }

    const likeState = await toggleFeedbackLike(id, user.id);

    return NextResponse.json({
      success: true,
      ...likeState,
    });
  } catch (error) {
    console.error("Toggle feedback like error:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "点赞失败，请稍后重试",
      },
      { status: 400 }
    );
  }
}
