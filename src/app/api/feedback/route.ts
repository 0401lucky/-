import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
  createFeedback,
  getFeedbackLikeState,
  getFeedbackMessages,
  listAllFeedback,
  listUserFeedback,
  type FeedbackStatus,
} from "@/lib/feedback";
import {
  normalizeFeedbackImages,
  type FeedbackImage,
} from "@/lib/feedback-image";
import {
  attachFeedbackAuthorProfile,
  attachFeedbackAuthorProfiles,
} from "@/lib/feedback-author";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { enforceTrustedApiRequest } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const FEEDBACK_STATUSES = new Set<FeedbackStatus>([
  "open",
  "processing",
  "resolved",
  "closed",
]);

const MAX_CONTENT_LENGTH = 1000;
const MAX_CONTACT_LENGTH = 100;

function parsePage(value: string | null): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, parsed);
}

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? "20", 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(50, parsed));
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
    if (!user) {
      return NextResponse.json(
        { success: false, message: "请先登录" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = parsePage(searchParams.get("page"));
    const limit = parseLimit(searchParams.get("limit"));
    const scope = searchParams.get("scope");

    const statusRaw = searchParams.get("status");
    const status = parseStatus(statusRaw);
    if (statusRaw && !status) {
      return NextResponse.json(
        { success: false, message: "无效的反馈状态" },
        { status: 400 }
      );
    }

    if (scope === "wall") {
      const { items, pagination } = await listAllFeedback({
        page,
        limit,
        status: status ?? undefined,
      });

      const publicItems = items.filter((item) => !item.anonymous);
      const publicItemsWithAuthor = await attachFeedbackAuthorProfiles(publicItems);
      const wallItems = await Promise.all(
        publicItemsWithAuthor.map(async (item) => {
          const messages = [...(await getFeedbackMessages(item.id, 20))].reverse();
          const firstUserMessage = messages.find((message) => message.role === "user") ?? null;
          const latestAdminReply = [...messages].reverse().find((message) => message.role === "admin") ?? null;

          return {
            ...item,
            contact: undefined,
            firstMessage: firstUserMessage,
            latestAdminReply,
            replyCount: Math.max(0, messages.length - 1),
            ...(await getFeedbackLikeState(item.id, user.id)),
          };
        })
      );

      return NextResponse.json({
        success: true,
        items: wallItems,
        pagination,
      });
    }

    const { items, pagination } = await listUserFeedback(user.id, {
      page,
      limit,
      status: status ?? undefined,
    });

    const itemsWithAuthor = await attachFeedbackAuthorProfiles(items);
    const itemsWithLatestMessage = await Promise.all(
      itemsWithAuthor.map(async (item) => {
        const latestMessages = await getFeedbackMessages(item.id, 1);
        const latestMessage = latestMessages[0] ?? null;

        return {
          ...item,
          latestMessageRole: latestMessage?.role ?? null,
          latestMessageAt: latestMessage?.createdAt ?? null,
        };
      })
    );

    return NextResponse.json({
      success: true,
      items: itemsWithLatestMessage,
      pagination,
    });
  } catch (error) {
    console.error("List feedback error:", error);
    return NextResponse.json(
      { success: false, message: "获取反馈列表失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const blocked = enforceTrustedApiRequest(request);
    if (blocked) {
      return blocked;
    }

    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "请先登录" },
        { status: 401 }
      );
    }

    const rateLimitResult = await checkRateLimit(user.id.toString(), {
      prefix: "ratelimit:feedback:create",
      windowSeconds: 600,
      maxRequests: 5,
    });
    if (!rateLimitResult.success) {
      return rateLimitResponse(rateLimitResult);
    }

    const body = (await request.json().catch(() => null)) as {
      content?: unknown;
      contact?: unknown;
      images?: unknown;
      anonymous?: unknown;
    } | null;

    const content =
      typeof body?.content === "string" ? body.content.trim() : "";
    const contact =
      typeof body?.contact === "string" ? body.contact.trim() : "";
    const anonymous = body?.anonymous === true;

    let images: FeedbackImage[] = [];
    try {
      images = normalizeFeedbackImages(body?.images);
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          message:
            error instanceof Error ? error.message : "附件参数错误，请重试",
        },
        { status: 400 }
      );
    }

    if (!content && images.length === 0) {
      return NextResponse.json(
        { success: false, message: "反馈内容或图片/视频至少填写一项" },
        { status: 400 }
      );
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      return NextResponse.json(
        {
          success: false,
          message: `反馈内容不能超过 ${MAX_CONTENT_LENGTH} 字`,
        },
        { status: 400 }
      );
    }

    if (contact.length > MAX_CONTACT_LENGTH) {
      return NextResponse.json(
        {
          success: false,
          message: `联系方式不能超过 ${MAX_CONTACT_LENGTH} 字`,
        },
        { status: 400 }
      );
    }

    const result = await createFeedback(
      user.id,
      user.username,
      content,
      contact || undefined,
      images,
      anonymous
    );
    const feedback = await attachFeedbackAuthorProfile(result.feedback);

    return NextResponse.json(
      {
        success: true,
        message: "反馈提交成功",
        feedback,
        firstMessage: result.message,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create feedback error:", error);
    const safeMessage =
      error instanceof Error && /视频上传|附件/.test(error.message)
        ? error.message
        : "提交反馈失败";
    return NextResponse.json(
      { success: false, message: safeMessage },
      { status: safeMessage === "提交反馈失败" ? 500 : 400 }
    );
  }
}
