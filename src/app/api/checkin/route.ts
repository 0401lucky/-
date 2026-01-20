import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { checkinToNewApi } from "@/lib/new-api";
import { hasCheckedInToday, setCheckedInToday, addExtraSpinCount } from "@/lib/kv";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ checkedIn: false }, { status: 401 });
    }

    const checkedIn = await hasCheckedInToday(user.id);
    return NextResponse.json({ checkedIn });
  } catch (error) {
    console.error("Check status error:", error);
    return NextResponse.json({ checkedIn: false }, { status: 500 });
  }
}

export async function POST() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "请先登录" },
        { status: 401 }
      );
    }

    // 1. 检查本地签到状态
    const alreadyCheckedIn = await hasCheckedInToday(user.id);
    if (alreadyCheckedIn) {
      return NextResponse.json(
        { success: false, message: "今天已经签到过了" },
        { status: 400 }
      );
    }

    // 2. 调用 New API 签到
    // 获取 new-api 的原始 session cookie
    const cookieStore = await cookies();
    const newApiSession = cookieStore.get("new_api_session")?.value;
    
    if (!newApiSession) {
      return NextResponse.json(
        { success: false, message: "请重新登录以启用签到功能" },
        { status: 401 }
      );
    }
    
    // 构造请求头需要的 cookie 格式
    const cookieHeader = `session=${newApiSession}`;

    const result = await checkinToNewApi(cookieHeader, user.username);

    if (!result.success) {
      // 如果 API 返回失败，但消息是"已签到"，我们也视为本地成功并同步状态
      if (result.message.includes("已经签到") || result.message.includes("Duplicate entry")) {
        await setCheckedInToday(user.id);
        return NextResponse.json({
          success: true,
          message: "今天已经签到过了（同步状态成功）"
        });
      }
      
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 400 }
      );
    }

    // 3. 签到成功处理
    await setCheckedInToday(user.id);
    await addExtraSpinCount(user.id, 1); // 奖励1次额外抽奖机会

    return NextResponse.json({
      success: true,
      message: "签到成功！获得1次额外抽奖机会",
    });

  } catch (error) {
    console.error("Checkin error:", error);
    return NextResponse.json(
      { success: false, message: "签到服务异常" },
      { status: 500 }
    );
  }
}
