import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getFeedbackById, getFeedbackMessages } from "@/lib/feedback";

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

    if (feedback.userId !== user.id) {
      return NextResponse.json(
        { success: false, message: "无权限访问该反馈" },
        { status: 403 }
      );
    }

    const messages = await getFeedbackMessages(id);

    return NextResponse.json({
      success: true,
      feedback,
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
