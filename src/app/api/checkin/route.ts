import { NextResponse } from "next/server";
import {
  grantCheckinLocalRewards,
  hasCheckedInToday,
  getExtraSpinCount,
  checkDailyLimit,
  listLocalCheckinDates,
} from "@/lib/kv";
import { isNativeHotStoreReady, listNativeCheckinDates } from "@/lib/hot-d1";
import { withUserRateLimit } from "@/lib/rate-limit";
import { addPoints, getPointsLogs } from "@/lib/points";
import { getMakeupCardCount } from "@/lib/makeup-cards";
import {
  calcCheckinPoints,
  calcCheckinSpins,
  formatDateKey,
  getWeekdayMon0,
  hasBrokenBeforeToday,
  isMonThruSatAllSigned,
} from "@/lib/checkin-rules";

export const dynamic = "force-dynamic";

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

async function getTodayCheckinPoints(userId: number, todayKey: string): Promise<number | null> {
  try {
    const logs = await getPointsLogs(userId, 100);
    const todayLog = logs.find((log) => {
      if (log.source !== 'checkin_bonus' || log.amount <= 0) return false;
      if (!log.description.startsWith('签到积分')) return false;
      return formatDateKey(new Date(log.createdAt)) === todayKey;
    });
    return todayLog?.amount ?? null;
  } catch (error) {
    console.error("Load today checkin points error:", error);
    return null;
  }
}

/**
 * 拉取签到状态需要的所有数据并组装为统一形态。
 * 未登录由调用方处理。
 */
async function loadCheckinSnapshot(userId: number) {
  const [checkedIn, extraSpins, dailyClaimed, makeupCards, hotReady] = await Promise.all([
    hasCheckedInToday(userId),
    getExtraSpinCount(userId),
    checkDailyLimit(userId),
    getMakeupCardCount(userId),
    isNativeHotStoreReady(),
  ]);

  const today = new Date();
  let history: string[] = [];
  if (hotReady) {
    try {
      history = await listNativeCheckinDates(userId, 400);
    } catch (err) {
      console.error("Load checkin history error:", err);
    }
  } else {
    try {
      history = await listLocalCheckinDates(userId, 400, today);
    } catch (err) {
      console.error("Load local checkin history error:", err);
    }
  }

  const todayKey = formatDateKey(today);
  const signedSet = new Set(history);
  // 排除今天的签到状态对"本周漏签"判定的影响（本函数判定 today 之前是否漏签）
  const signedSetExcludingToday = new Set(history.filter((d) => d !== todayKey));

  const weekdayMon0 = getWeekdayMon0(today);
  const weekBroken = hasBrokenBeforeToday(today, signedSetExcludingToday);
  const monThruSatAllSigned = isMonThruSatAllSigned(today, signedSet);

  const previewPoints = calcCheckinPoints(weekdayMon0, weekBroken);
  const previewSpins = calcCheckinSpins(weekdayMon0, monThruSatAllSigned);
  const todayCheckinPoints = checkedIn
    ? await getTodayCheckinPoints(userId, todayKey)
    : null;

  return {
    checkedIn,
    extraSpins,
    // 每日免费抽奖：true 表示今日还未消耗
    dailyFreeAvailable: !dailyClaimed,
    makeupCards,
    history,
    weekStatus: {
      weekdayMon0,
      weekBroken,
      monThruSatAllSigned,
      previewPoints,
      previewSpins,
    },
    todayCheckinResult: checkedIn
      ? {
          pointsAwarded: todayCheckinPoints ?? previewPoints,
          extraSpinsAwarded: previewSpins,
          weekBroken,
          weekdayLabel: WEEKDAY_LABELS[weekdayMon0] ?? '',
        }
      : null,
  };
}

export async function GET() {
  try {
    const { getAuthUser } = await import("@/lib/auth");
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        {
          checkedIn: false,
          extraSpins: 0,
          dailyFreeAvailable: false,
          makeupCards: 0,
          history: [],
          weekStatus: null,
          todayCheckinResult: null,
        },
        { status: 401 },
      );
    }

    const snapshot = await loadCheckinSnapshot(user.id);
    return NextResponse.json(snapshot);
  } catch (error) {
    console.error("Check status error:", error);
    return NextResponse.json(
      {
        checkedIn: false,
        extraSpins: 0,
        dailyFreeAvailable: false,
        makeupCards: 0,
        history: [],
        weekStatus: null,
        todayCheckinResult: null,
      },
      { status: 500 },
    );
  }
}

export const POST = withUserRateLimit(
  'checkin',
  async (_request, user) => {
    try {
      // 1) 防御：今日是否已签到（双路径都靠原子写入兜底，但提前返回友好错误）
      const alreadyCheckedIn = await hasCheckedInToday(user.id);
      if (alreadyCheckedIn) {
        return NextResponse.json(
          { success: false, message: "今天已经签到过了" },
          { status: 400 },
        );
      }

      // 2) 拉取签到历史（用于判断本周漏签 / 全勤）
      const today = new Date();
      let history: string[] = [];
      if (await isNativeHotStoreReady()) {
        try {
          history = await listNativeCheckinDates(user.id, 400);
        } catch (err) {
          // 历史拉取失败时降级为"无前置漏签"，给用户最大限度的体验
          console.error("Load checkin history error:", err);
        }
      } else {
        try {
          history = await listLocalCheckinDates(user.id, 400, today);
        } catch (err) {
          console.error("Load local checkin history error:", err);
        }
      }

      const todayKey = formatDateKey(today);
      const weekdayMon0 = getWeekdayMon0(today);
      const signedSetExcludingToday = new Set(history.filter((d) => d !== todayKey));
      const weekBroken = hasBrokenBeforeToday(today, signedSetExcludingToday);

      // 3) 计算积分（梯度 or 50 保底）
      const pointsReward = calcCheckinPoints(weekdayMon0, weekBroken);

      // 4) 计算额外抽奖（周日要看是否周一到周六全勤；其他日子固定 1）
      // 周日若今日尚未补签前已经周一到周六全签，则 +2
      const sundaySignedSet = new Set(history); // 今日尚未签，所以不含 today
      const monThruSatAllSigned = isMonThruSatAllSigned(today, sundaySignedSet);
      const extraSpins = calcCheckinSpins(weekdayMon0, monThruSatAllSigned);

      // 5) 写入签到状态 + 额外抽奖次数（原子操作；带回滚）
      const localRewards = await grantCheckinLocalRewards(user.id, {
        extraSpins,
        cardDraws: 0,
      });
      if (localRewards.alreadyCheckedIn) {
        return NextResponse.json(
          { success: false, message: "今天已经签到过了" },
          { status: 400 },
        );
      }
      if (!localRewards.granted) {
        return NextResponse.json(
          { success: false, message: "签到奖励发放失败，请稍后重试" },
          { status: 500 },
        );
      }

      // 6) 发放积分（best-effort：失败仅记日志，签到状态保留以避免重复消耗用户次数）
      let pointsBalance: number | undefined;
      const weekdayLabel = WEEKDAY_LABELS[weekdayMon0] ?? '';
      try {
        const result = await addPoints(
          user.id,
          pointsReward,
          'checkin_bonus',
          weekBroken
            ? `签到积分（${weekdayLabel}，本周已断签 ${pointsReward} 分）`
            : `签到积分（${weekdayLabel} +${pointsReward}）`,
        );
        pointsBalance = result.balance;
      } catch (err) {
        console.error('签到积分发放失败:', err);
      }

      const broken50Hint = weekBroken ? '（本周已断签，仅发放保底积分）' : '';
      return NextResponse.json({
        success: true,
        message: `签到成功！获得 ${pointsReward} 积分${broken50Hint}与 ${extraSpins} 次额外抽奖`,
        pointsAwarded: pointsReward,
        pointsBalance,
        extraSpinsAwarded: extraSpins,
        extraSpins: localRewards.extraSpins,
        weekBroken,
        weekdayLabel,
      });
    } catch (error) {
      console.error("Checkin error:", error);
      return NextResponse.json(
        { success: false, message: "签到服务异常" },
        { status: 500 },
      );
    }
  },
  { unauthorizedMessage: '请先登录' },
);
