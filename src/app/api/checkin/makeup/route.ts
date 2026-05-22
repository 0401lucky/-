import { NextResponse } from "next/server";
import { withUserRateLimit } from "@/lib/rate-limit";
import { grantCheckinLocalRewards, listLocalCheckinDates } from "@/lib/kv";
import { isNativeHotStoreReady, listNativeCheckinDates } from "@/lib/hot-d1";
import { addPoints } from "@/lib/points";
import {
  addMakeupCards,
  getMakeupCardCount,
  tryConsumeMakeupCard,
} from "@/lib/makeup-cards";
import {
  calcCheckinPoints,
  calcCheckinSpins,
  formatDateKey,
  getMondayOfWeek,
  getWeekdayMon0,
  hasBrokenBeforeDate,
  isInCurrentWeek,
  isMonThruSatAllSigned,
  parseDateKey,
} from "@/lib/checkin-rules";

export const dynamic = "force-dynamic";

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/**
 * POST /api/checkin/makeup
 *
 * Body: { date: 'YYYY-MM-DD' }
 *
 * 流程：
 * 1) 校验日期合法、在本周内、且为已过去的日子（不能补今天/未来）
 * 2) 校验该日尚未签到
 * 3) 校验用户至少有 1 张补签卡
 * 4) 原子消耗 1 张补签卡
 * 5) 写入历史日期的签到状态 + 额外抽奖（与正常签到等同）
 *    若失败回滚补签卡
 * 6) 计算该日应发积分：按该日 weekday + 补签后该日之前是否仍存在漏签
 * 7) 发放积分（best-effort，失败仅记日志）
 */
export const POST = withUserRateLimit(
  'checkin:makeup',
  async (request, user) => {
    try {
      const body = (await request.json().catch(() => null)) as
        | { date?: unknown }
        | null;
      const dateRaw = body?.date;
      if (typeof dateRaw !== 'string' || !dateRaw.trim()) {
        return NextResponse.json(
          { success: false, message: '请提供需要补签的日期' },
          { status: 400 },
        );
      }
      const targetDate = parseDateKey(dateRaw.trim());
      if (!targetDate) {
        return NextResponse.json(
          { success: false, message: '日期格式不合法，应为 YYYY-MM-DD' },
          { status: 400 },
        );
      }

      const today = new Date();
      const todayKey = formatDateKey(today);

      // 必须在本周
      if (!isInCurrentWeek(targetDate, today)) {
        return NextResponse.json(
          { success: false, message: '补签卡只能补本周内的漏签' },
          { status: 400 },
        );
      }

      // 必须是已过去的日子（昨天及更早）
      const targetKey = formatDateKey(targetDate);
      if (targetKey >= todayKey) {
        return NextResponse.json(
          { success: false, message: '只能补已经过去的漏签日，不能补今天或未来' },
          { status: 400 },
        );
      }

      // 拉取签到历史，用于判断"是否已签"和"补签后该日之前是否仍漏签"
      let history: string[] = [];
      if (await isNativeHotStoreReady()) {
        try {
          history = await listNativeCheckinDates(user.id, 400);
        } catch (err) {
          console.error('Load checkin history failed:', err);
          return NextResponse.json(
            { success: false, message: '签到历史读取失败，请稍后重试' },
            { status: 500 },
          );
        }
      } else {
        try {
          history = await listLocalCheckinDates(user.id, 400, today);
        } catch (err) {
          console.error('Load local checkin history failed:', err);
          return NextResponse.json(
            { success: false, message: '签到历史读取失败，请稍后重试' },
            { status: 500 },
          );
        }
      }

      const signedSet = new Set(history);
      if (signedSet.has(targetKey)) {
        return NextResponse.json(
          { success: false, message: '该日期已签到，无需补签' },
          { status: 400 },
        );
      }

      // 校验补签卡库存
      const beforeCount = await getMakeupCardCount(user.id);
      if (beforeCount <= 0) {
        return NextResponse.json(
          { success: false, message: '补签卡数量不足，请先在福利兑换中购买' },
          { status: 400 },
        );
      }

      // 原子消耗补签卡
      const consume = await tryConsumeMakeupCard(user.id);
      if (!consume.success) {
        return NextResponse.json(
          { success: false, message: '补签卡数量不足，请先在福利兑换中购买' },
          { status: 400 },
        );
      }

      // 写入历史日期签到状态 + 额外抽奖次数
      // 计算抽奖（含周日全勤判定）：把 targetKey 视为已签后再判定
      const signedSetWithTarget = new Set(history);
      signedSetWithTarget.add(targetKey);
      const targetWeekday = getWeekdayMon0(targetDate);
      const monThruSatAllSigned = isMonThruSatAllSigned(targetDate, signedSetWithTarget);
      const extraSpinsAwarded = calcCheckinSpins(targetWeekday, monThruSatAllSigned);

      const grant = await grantCheckinLocalRewards(user.id, {
        extraSpins: extraSpinsAwarded,
        cardDraws: 0,
        signDate: targetKey,
      });

      if (!grant.granted) {
        // 标记签到失败：回滚补签卡
        try {
          await addMakeupCards(user.id, 1);
        } catch (rollbackError) {
          console.error('回滚补签卡失败:', rollbackError);
        }
        const message = grant.alreadyCheckedIn
          ? '该日期已签到，无需补签'
          : '补签失败，请稍后重试';
        return NextResponse.json(
          { success: false, message },
          { status: grant.alreadyCheckedIn ? 400 : 500 },
        );
      }

      // 计算积分：按该日之前是否仍有漏签
      // signedSetWithTarget 已包含 target，但判定的是 target 之前的日子
      const targetBroken = hasBrokenBeforeDate(targetDate, signedSetWithTarget);
      const pointsAwarded = calcCheckinPoints(targetWeekday, targetBroken);

      // best-effort 发放积分
      let pointsBalance: number | undefined;
      const weekdayLabel = WEEKDAY_LABELS[targetWeekday] ?? '';
      try {
        const result = await addPoints(
          user.id,
          pointsAwarded,
          'checkin_bonus',
          targetBroken
            ? `补签积分（${weekdayLabel} ${targetKey}，本周存在更早漏签 ${pointsAwarded} 分）`
            : `补签积分（${weekdayLabel} ${targetKey} +${pointsAwarded}）`,
        );
        pointsBalance = result.balance;
      } catch (err) {
        console.error('补签积分发放失败:', err);
      }

      // 重新读取一次本周状态，方便前端立即刷新
      const remaining = consume.remaining;
      const monday = getMondayOfWeek(today);
      const stillMissing: string[] = [];
      for (let i = 0; i < 7; i += 1) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const k = formatDateKey(d);
        if (k >= todayKey) break;
        if (!signedSetWithTarget.has(k)) stillMissing.push(k);
      }

      return NextResponse.json({
        success: true,
        message: `补签 ${weekdayLabel} 成功，获得 ${pointsAwarded} 积分与 ${extraSpinsAwarded} 次额外抽奖`,
        date: targetKey,
        pointsAwarded,
        pointsBalance,
        extraSpinsAwarded,
        extraSpins: grant.extraSpins,
        makeupCards: remaining,
        stillMissing,
      });
    } catch (error) {
      console.error('Makeup checkin error:', error);
      return NextResponse.json(
        { success: false, message: '补签服务异常' },
        { status: 500 },
      );
    }
  },
  { unauthorizedMessage: '请先登录' },
);
