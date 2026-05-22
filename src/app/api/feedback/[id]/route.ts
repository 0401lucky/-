import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
  getFeedbackById,
  getFeedbackLikeState,
  getFeedbackMessages,
} from "@/lib/feedback";
import { attachFeedbackAuthorProfile } from "@/lib/feedback-author";

export const dynamic = "force-dynamic";

export async function GET(
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

    const { id } = await params;
    const feedback = await getFeedbackById(id);

    if (!feedback) {
      return NextResponse.json(
        { success: false, message: "反馈不存在" },
        { status: 404 }
      );
    }

    if (feedback.anonymous && feedback.userId !== user.id) {
      return NextResponse.json(
        { success: false, message: "无权限访问该反馈" },
        { status: 403 }
      );
    }

    const messages = await getFeedbackMessages(id);
    const likeState = await getFeedbackLikeState(id, user.id);
    const feedbackWithAuthor = await attachFeedbackAuthorProfile(feedback);

    return NextResponse.json({
      success: true,
      feedback: {
        ...feedbackWithAuthor,
        contact: feedback.userId === user.id ? feedback.contact : undefined,
        ...likeState,
      },
      messages: [...messages].reverse(),
    });
  } catch (error) {
    console.error("Get feedback detail error:", error);
    return NextResponse.json(
      { success: false, message: "获取反馈详情失败" },
      { status: 500 }
    );
  }
}
