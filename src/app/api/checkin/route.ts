import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { checkinToNewApi } from "@/lib/new-api";
import { grantCheckinLocalRewards, hasCheckedInToday, getExtraSpinCount } from "@/lib/kv";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const CHECKIN_SUCCESS_MESSAGE = "签到成功！获得1次额外抽奖机会和1次卡牌抽卡机会";

export async function GET() {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ checkedIn: false }, { status: 401 });
    }

    const [checkedIn, extraSpins] = await Promise.all([
      hasCheckedInToday(user.id),
      getExtraSpinCount(user.id)
    ]);
    
    return NextResponse.json({ checkedIn, extraSpins });
  } catch (error) {
    console.error("Check status error:", error);
    return NextResponse.json({ checkedIn: false, extraSpins: 0 }, { status: 500 });
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

    const result = await checkinToNewApi(cookieHeader, user.id);

    if (!result.success) {
      // 如果 API 返回失败，但消息是"已签到"，说明用户今天在 new-api 已签到
      // 福利站本地没签过，仍然给额外抽奖次数
      const msg = result.message || "";
      if (msg.includes("已经签到") || msg.includes("已签到") || msg.includes("Duplicate entry")) {
        const localRewards = await grantCheckinLocalRewards(user.id);
        if (!localRewards.granted && !localRewards.alreadyCheckedIn) {
          return NextResponse.json(
            { success: false, message: "本地签到奖励发放失败，请稍后重试" },
            { status: 500 }
          );
        }
        
        return NextResponse.json({
          success: true,
          message: CHECKIN_SUCCESS_MESSAGE,
          quotaDisplay: "已在主站领取",
          extraSpins: localRewards.extraSpins,
        });
      }
      
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 400 }
      );
    }

    // 3. 签到成功处理
    const localRewards = await grantCheckinLocalRewards(user.id);
    if (!localRewards.granted && !localRewards.alreadyCheckedIn) {
      return NextResponse.json(
        { success: false, message: "本地签到奖励发放失败，请稍后重试" },
        { status: 500 }
      );
    }
    
    // 格式化额度显示（new-api 的 quota 单位通常是 1/500000 美元）
    const quotaAwarded = result.quotaAwarded || 0;
    const quotaDisplay = quotaAwarded > 0 ? (quotaAwarded / 500000).toFixed(4) : "0";

    return NextResponse.json({
      success: true,
      message: CHECKIN_SUCCESS_MESSAGE,
      quotaAwarded,
      quotaDisplay: `$${quotaDisplay}`,
      extraSpins: localRewards.extraSpins,
    });

  } catch (error) {
    console.error("Checkin error:", error);
    return NextResponse.json(
      { success: false, message: "签到服务异常" },
      { status: 500 }
    );
  }
}
