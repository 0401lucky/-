'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertCircle,
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Coins,
  Flame,
  Gift,
  Info,
  Loader2,
  Moon,
  Sparkles,
  Star,
  Ticket,
  X,
  Zap,
} from 'lucide-react';
import SiteSidebar from '@/components/SiteSidebar';
import {
  BROKEN_WEEK_POINTS,
  formatDateKey,
  listWeekDateKeys,
  MAKEUP_CARD_POINTS_COST,
  parseDateKey,
  WEEK_POINTS_GRADIENT,
} from '@/lib/checkin-rules';

interface WeekStatusFromApi {
  weekdayMon0: number;
  weekBroken: boolean;
  monThruSatAllSigned: boolean;
  previewPoints: number;
  previewSpins: number;
}

interface CheckinResult {
  pointsAwarded?: number;
  extraSpinsAwarded?: number;
  weekBroken?: boolean;
  weekdayLabel?: string;
}

interface CalendarCell {
  day: number;
  muted?: boolean;
  isToday?: boolean;
  isSigned?: boolean;
  isMissed?: boolean;
}

// 本周奖励之路：周一(index 0) → 周日(index 6)
// 周一/二/三 50；周四/五 60；周六 70；周日 100
const WEEK_REWARDS: Array<{ weekday: string; reward: number; bonus?: boolean }> = [
  { weekday: '周一', reward: WEEK_POINTS_GRADIENT[0] },
  { weekday: '周二', reward: WEEK_POINTS_GRADIENT[1] },
  { weekday: '周三', reward: WEEK_POINTS_GRADIENT[2] },
  { weekday: '周四', reward: WEEK_POINTS_GRADIENT[3] },
  { weekday: '周五', reward: WEEK_POINTS_GRADIENT[4] },
  { weekday: '周六', reward: WEEK_POINTS_GRADIENT[5] },
  { weekday: '周日', reward: WEEK_POINTS_GRADIENT[6], bonus: true },
];

const RULES = [
  {
    icon: <CalendarDays />,
    title: '每日签到时间',
    desc: '每天 0:00 后即可签到，自然日内只能签到一次。错过当日签到将被记为漏签，会影响本周积分梯度。',
    accent: 'orange',
  },
  {
    icon: <Zap />,
    title: '积分梯度奖励',
    desc: `周一、周二、周三每日 ${WEEK_POINTS_GRADIENT[0]} 分；周四、周五每日 ${WEEK_POINTS_GRADIENT[3]} 分；周六 ${WEEK_POINTS_GRADIENT[5]} 分；周日 ${WEEK_POINTS_GRADIENT[6]} 分。完整连签时每天按梯度发放。`,
    accent: 'purple',
  },
  {
    icon: <Moon />,
    title: '漏签整周降级',
    desc: `本周一到昨天之间任何一天没签到，则今天起本周剩余日子签到只发 ${BROKEN_WEEK_POINTS} 积分（与梯度无关），直到你用补签卡补齐所有漏签为止。补齐后下一次签到积分立即恢复梯度。`,
    accent: 'pink',
  },
  {
    icon: <CalendarPlus />,
    title: '补签卡',
    desc: `在「福利兑换」用 ${MAKEUP_CARD_POINTS_COST} 积分购买 1 张，不限购买数量。补签卡只能补本周已经漏签的日子（周一到昨天），补签后该日视同已签到，立即恢复积分梯度，并补发该日应得的积分与额外抽奖。`,
    accent: 'green',
  },
  {
    icon: <Star />,
    title: '签到送额外抽奖',
    desc: '周一至周六每天签到送 1 次额外抽奖（可叠加、不过期）；周日若周一至周六全部签到（含补签）送 2 次，否则只送 1 次。',
    accent: 'purple',
  },
  {
    icon: <Sparkles />,
    title: '抽奖机会有两种',
    desc: '「每日抽奖」每天 0 点自动刷新 1 抽，不可叠加，当天用不完次日清零；「额外抽奖」由签到、活动、商店等渠道获取，可以累计、不会过期。',
    accent: 'orange',
  },
  {
    icon: <Info />,
    title: '不再发放账户额度',
    desc: '即日起签到不再发放账户额度（quota），改为发放本地积分。原「账户额度直充」已从福利兑换下架，请改为用积分参与抽奖、兑换抽奖次数或卡牌。',
    accent: 'pink',
  },
];


function buildWeekStatus(today: Date, signedSet: Set<string>) {
  const todayKey = formatDateKey(today);
  const weekKeys = listWeekDateKeys(today);

  const days = WEEK_REWARDS.map((cfg, i) => {
    const key = weekKeys[i] ?? todayKey;
    const date = parseDateKey(key) ?? new Date(today);
    const isSigned = signedSet.has(key);
    const isToday = key === todayKey;
    const isPast = key < todayKey;
    const isFuture = key > todayKey;
    return { ...cfg, index: i, date, key, isSigned, isToday, isPast, isFuture };
  });

  // 断签：本周一到昨天范围内有任何一天未签到
  const broken = days.some((d) => d.isPast && !d.isSigned);
  const completed = days.filter((d) => d.isSigned).length;
  // 当周一至周六全勤（含补签）才奖励周日 2 抽
  const monThruSatAllSigned = days.slice(0, 6).every((d) => d.isSigned);

  return { days, broken, completed, monThruSatAllSigned };
}

function formatCalendarDateKey(year: number, month: number, day: number): string {
  return [
    String(year).padStart(4, '0'),
    String(month + 1).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return formatCalendarDateKey(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function buildCalendarCells(
  year: number,
  month: number,
  todayKey: string,
  signedSet: Set<string>
) {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const startWeek = firstDay.getUTCDay();
  const prevMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: CalendarCell[] = [];
  for (let i = startWeek - 1; i >= 0; i -= 1) {
    cells.push({ day: prevMonthDays - i, muted: true });
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = formatCalendarDateKey(year, month, d);
    const isSigned = signedSet.has(key);
    const isToday = key === todayKey;
    cells.push({
      day: d,
      isToday,
      isSigned,
      isMissed: !isSigned && key < todayKey,
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: cells.length - daysInMonth - startWeek + 1, muted: true });
  }
  return cells;
}

function computeStats(signedSet: Set<string>, today: Date) {
  // 当前连续：从今天/昨天倒推
  let streak = 0;
  let cursorKey = formatDateKey(today);
  // 若今日未签，允许从昨天起算
  if (!signedSet.has(cursorKey)) {
    cursorKey = shiftDateKey(cursorKey, -1);
  }
  while (signedSet.has(cursorKey)) {
    streak += 1;
    cursorKey = shiftDateKey(cursorKey, -1);
  }

  return { streak };
}

export default function CheckinPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);
  const [extraSpins, setExtraSpins] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [makeupCards, setMakeupCards] = useState(0);
  const [dailyFreeAvailable, setDailyFreeAvailable] = useState(true);
  const [weekStatusFromApi, setWeekStatusFromApi] = useState<WeekStatusFromApi | null>(null);
  const [checkinResult, setCheckinResult] = useState<CheckinResult | null>(null);
  const [makeupTarget, setMakeupTarget] = useState<{
    date: string;
    weekdayLabel: string;
    previewPoints: number;
    previewSpins: number;
  } | null>(null);
  const [makeupSubmitting, setMakeupSubmitting] = useState(false);
  const [makeupError, setMakeupError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const [userRes, statusRes] = await Promise.all([
        fetch('/api/auth/me', { cache: 'no-store' }),
        fetch('/api/checkin', { cache: 'no-store' }),
      ]);

      if (!userRes.ok) {
        router.push('/login?redirect=/checkin');
        return;
      }

      const userData = await userRes.json();
      if (!userData.success) {
        router.push('/login?redirect=/checkin');
        return;
      }

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setCheckedIn(!!statusData.checkedIn);
        setExtraSpins(Number(statusData.extraSpins) || 0);
        setMakeupCards(Number(statusData.makeupCards) || 0);
        setDailyFreeAvailable(statusData.dailyFreeAvailable !== false);
        if (Array.isArray(statusData.history)) {
          setHistory(statusData.history as string[]);
        }
        if (statusData.weekStatus) {
          setWeekStatusFromApi(statusData.weekStatus as WeekStatusFromApi);
        } else {
          setWeekStatusFromApi(null);
        }
        if (statusData.checkedIn && statusData.todayCheckinResult) {
          setCheckinResult(statusData.todayCheckinResult as CheckinResult);
        } else if (!statusData.checkedIn) {
          setCheckinResult(null);
        }
      }
    } catch (error) {
      console.error('Failed to fetch status:', error);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const handleCheckin = async () => {
    if (submitting || checkedIn) return;
    setSubmitting(true);

    try {
      const res = await fetch('/api/checkin', { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        setCheckedIn(true);
        setExtraSpins(Number(data.extraSpins) || extraSpins + (data.extraSpinsAwarded || 1));
        setHistory((prev) => {
          const todayKey = formatDateKey(new Date());
          return prev.includes(todayKey) ? prev : [todayKey, ...prev];
        });
        setCheckinResult({
          pointsAwarded: data.pointsAwarded,
          extraSpinsAwarded: data.extraSpinsAwarded,
          weekBroken: data.weekBroken,
          weekdayLabel: data.weekdayLabel,
        });
        // 签到后刷新一次，确保 weekStatus 等数据最新
        void checkStatus();
        import('canvas-confetti').then(({ default: confetti }) => {
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#f97316', '#fbbf24', '#ffffff'],
          });
        });
      } else {
        alert(data.message || '签到失败');
      }
    } catch {
      alert('签到请求失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const openMakeupConfirm = (info: {
    date: string;
    weekdayLabel: string;
    previewPoints: number;
    previewSpins: number;
  }) => {
    setMakeupError(null);
    setMakeupTarget(info);
  };

  const closeMakeupConfirm = () => {
    if (makeupSubmitting) return;
    setMakeupTarget(null);
    setMakeupError(null);
  };

  const handleMakeup = async () => {
    if (!makeupTarget || makeupSubmitting) return;
    if (makeupCards <= 0) {
      setMakeupError('补签卡数量不足，请先在福利兑换中购买');
      return;
    }
    setMakeupSubmitting(true);
    setMakeupError(null);
    try {
      const res = await fetch('/api/checkin/makeup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: makeupTarget.date }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || '补签失败');
      }
      // 立即更新本地状态
      setMakeupCards(Number(data.makeupCards) || Math.max(0, makeupCards - 1));
      setExtraSpins(Number(data.extraSpins) || extraSpins + (data.extraSpinsAwarded || 1));
      setHistory((prev) =>
        prev.includes(makeupTarget.date) ? prev : [makeupTarget.date, ...prev],
      );
      // 后端已经精确算出本周还差几天，再调一次刷新数据
      void checkStatus();
      setMakeupTarget(null);
      import('canvas-confetti').then(({ default: confetti }) => {
        confetti({
          particleCount: 60,
          spread: 50,
          origin: { y: 0.6 },
          colors: ['#10b981', '#34d399', '#ffffff'],
        });
      });
    } catch (err) {
      setMakeupError(err instanceof Error ? err.message : '补签失败');
    } finally {
      setMakeupSubmitting(false);
    }
  };

  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => formatDateKey(today), [today]);
  const [calendarYear, calendarMonth] = useMemo(() => {
    const [year, month] = todayKey.split('-').map(Number);
    return [year, month - 1] as const;
  }, [todayKey]);
  const signedSet = useMemo(() => new Set(history), [history]);
  const calendarCells = useMemo(
    () => buildCalendarCells(calendarYear, calendarMonth, todayKey, signedSet),
    [calendarYear, calendarMonth, todayKey, signedSet]
  );
  const stats = useMemo(() => computeStats(signedSet, today), [signedSet, today]);
  const week = useMemo(() => buildWeekStatus(today, signedSet), [today, signedSet]);

  const streakDay = stats.streak;

  // 今日预估积分与抽奖：优先用后端的精确判定，否则前端用 week 兜底
  const previewPoints = weekStatusFromApi?.previewPoints ?? (week.broken ? BROKEN_WEEK_POINTS : (week.days.find((d) => d.isToday)?.reward ?? BROKEN_WEEK_POINTS));
  const previewSpins = weekStatusFromApi?.previewSpins ?? (() => {
    const todayDay = week.days.find((d) => d.isToday);
    if (!todayDay) return 1;
    if (todayDay.index === 6) return week.monThruSatAllSigned ? 2 : 1;
    return 1;
  })();
  const previewBroken = weekStatusFromApi?.weekBroken ?? week.broken;
  const checkedInPoints = checkinResult?.pointsAwarded ?? previewPoints;
  const checkedInSpins = checkinResult?.extraSpinsAwarded ?? previewSpins;
  const checkedInBroken = checkinResult?.weekBroken ?? previewBroken;

  if (loading) {
    return (
      <div className="lucky-checkin-loading">
        <Loader2 className="spinner" />
        <style jsx>{`
          .lucky-checkin-loading {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: #f8fafc;
          }
          .spinner {
            width: 32px;
            height: 32px;
            color: #f97316;
            animation: spin 1s linear infinite;
          }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="lucky-checkin">
      <div className="mesh-bg" />

      <div className="layout">
        {/* 左侧固定栏 */}
        <SiteSidebar activeNav="checkin" />

        {/* 右侧滚动区 */}
        <main className="panel-right">
          {/* 返回链接（移动端仅显示） */}
          <Link href="/" className="mobile-back">
            <ChevronLeft />
            返回首页
          </Link>

          {/* 页面顶部 */}
          <div className="page-header">
            <div>
              <h2 className="section-title">
                <CalendarDays />
                每日签到
              </h2>
              <p className="header-subtitle">坚持签到积累幸运值，连签解锁专属奖励。</p>
            </div>
          </div>

          {/* 签到主卡片 */}
          <section className="checkin-hero">
            <div className="hero-row">
              <div className="streak-info">
                <div className="streak-icon">
                  <Flame />
                </div>
                <div className="streak-text">
                  <div className="label">{checkedIn ? '今日已签到' : '连续签到'}</div>
                  <div className="value">
                    {streakDay}
                    <span className="day">天</span>
                  </div>
                  <div className="sub">
                    {checkedIn ? (
                      <>
                        本次签到 <strong>+{checkedInPoints} 积分</strong>
                        {checkedInSpins ? (
                          <> · <strong>+{checkedInSpins} 抽</strong></>
                        ) : null}
                        {checkedInBroken ? <>（本周已断签）</> : null}
                      </>
                    ) : (
                      <>
                        今日签到可获 <strong>+{previewPoints} 积分</strong> 与{' '}
                        <strong>+{previewSpins} 次额外抽奖</strong>
                        {previewBroken ? <>（本周已断签，仅发保底）</> : null}
                      </>
                    )}
                  </div>
                </div>
              </div>
              <button
                className={`checkin-btn ${checkedIn ? 'checked' : ''}`}
                onClick={handleCheckin}
                disabled={checkedIn || submitting}
              >
                {submitting ? (
                  <Loader2 className="btn-spin" />
                ) : checkedIn ? (
                  <>
                    <Check />
                    今日已签到
                  </>
                ) : (
                  <>
                    <Check />
                    立即签到 +{previewPoints} 积分
                  </>
                )}
              </button>
            </div>

            {/* 本周奖励之路（周一 → 周日） */}
            <div className="reward-track">
              <div className="reward-track-header">
                <span>
                  <strong>本周奖励之路</strong> ·{' '}
                  {week.broken
                    ? `本周已断签，今日及剩余每日仅发 ${BROKEN_WEEK_POINTS} 积分（用补签卡补齐后梯度恢复）`
                    : '保持完整连签即可按梯度发放积分'}
                </span>
                <span>
                  已完成 <strong>{week.completed} / 7</strong>
                </span>
              </div>
              <div className="reward-days">
                {week.days.map((d) => {
                  const isDone = d.isSigned;
                  const isToday = d.isToday;
                  const isMissed = d.isPast && !d.isSigned;
                  const canMakeup = isMissed && makeupCards > 0;
                  const cls = [
                    'reward-day',
                    isDone ? 'done' : '',
                    isToday ? 'today' : '',
                    isMissed ? 'missed' : '',
                    canMakeup ? 'can-makeup' : '',
                    d.bonus ? 'bonus' : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  // 补签预估积分：按该日 weekday + "补签后该日之前是否仍漏签"
                  const earlierMissBeforeThisDay = week.days
                    .slice(0, d.index)
                    .some((earlier) => earlier.isPast && !earlier.isSigned);
                  const previewPointsForMakeup = earlierMissBeforeThisDay
                    ? BROKEN_WEEK_POINTS
                    : d.reward;
                  // 补签当日抽奖：周日要看其它 6 天是否补齐后全签；其他日子固定 1
                  const previewSpinsForMakeup =
                    d.index === 6
                      ? week.days.slice(0, 6).every((other) => other.isSigned || other.key === d.key)
                        ? 2
                        : 1
                      : 1;
                  const displayReward = week.broken ? BROKEN_WEEK_POINTS : d.reward;
                  const handleClick = () => {
                    if (!canMakeup) return;
                    openMakeupConfirm({
                      date: d.key,
                      weekdayLabel: d.weekday,
                      previewPoints: previewPointsForMakeup,
                      previewSpins: previewSpinsForMakeup,
                    });
                  };
                  return (
                    <div
                      key={d.index}
                      className={cls}
                      role={canMakeup ? 'button' : undefined}
                      tabIndex={canMakeup ? 0 : -1}
                      onClick={handleClick}
                      onKeyDown={(e) => {
                        if (canMakeup && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          handleClick();
                        }
                      }}
                      aria-label={
                        canMakeup
                          ? `补签 ${d.weekday}（消耗 1 张补签卡）`
                          : undefined
                      }
                    >
                      <div className="d-num">{d.weekday}</div>
                      <div className="d-icon">
                        {d.bonus && !isMissed ? (
                          <Star fill="currentColor" stroke="none" />
                        ) : isDone ? (
                          <Check />
                        ) : isToday ? (
                          <span className="dot" />
                        ) : isMissed ? (
                          canMakeup ? (
                            <CalendarPlus />
                          ) : (
                            <span className="cross">×</span>
                          )
                        ) : (
                          <span className="ring" />
                        )}
                      </div>
                      <div className="d-reward">+{displayReward}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 抽奖快捷入口 */}
            {checkedIn && extraSpins > 0 && (
              <Link href="/lottery" className="lottery-cta">
                <Gift />
                你还有 <strong>{extraSpins}</strong> 次额外抽奖机会，立即去抽奖
                <ChevronRight />
              </Link>
            )}
          </section>

          {/* 数据统计：本次积分 / 每日抽奖 / 额外抽奖 / 补签卡 */}
          <section className="stats-grid">
            <div className="stat-card s-1">
              <div className="stat-icon">
                <Coins />
              </div>
              <div className="stat-label">本次积分</div>
              <div className="stat-value">
                {checkedIn ? `+${checkedInPoints}` : `+${previewPoints}`}
              </div>
            </div>
            <div className="stat-card s-2">
              <div className="stat-icon">
                <Ticket />
              </div>
              <div className="stat-label">每日抽奖</div>
              <div className="stat-value">
                {dailyFreeAvailable ? 1 : 0}
                <span className="unit">/ 1</span>
              </div>
            </div>
            <div className="stat-card s-3">
              <div className="stat-icon">
                <Gift />
              </div>
              <div className="stat-label">额外抽奖</div>
              <div className="stat-value">
                {extraSpins}
                <span className="unit">次</span>
              </div>
            </div>
            <Link href="/store" className="stat-card s-4 stat-link">
              <div className="stat-icon">
                <CalendarPlus />
              </div>
              <div className="stat-label">补签卡</div>
              <div className="stat-value">
                {makeupCards}
                <span className="unit">张</span>
              </div>
              <div className="stat-foot">前往兑换 →</div>
            </Link>
          </section>

          {/* 双列：日历 + 规则 */}
          <section className="two-col">
            <div className="panel-card">
              <div className="panel-card-header">
                <h3 className="panel-card-title">
                  <CalendarDays />
                  本月签到日历
                </h3>
                <div className="cal-nav">
                  <button className="cal-nav-btn" type="button" aria-label="上个月" disabled>
                    <ChevronLeft />
                  </button>
                  <span className="cal-month-label">
                    {calendarYear} 年 {calendarMonth + 1} 月
                  </span>
                  <button className="cal-nav-btn" type="button" aria-label="下个月" disabled>
                    <ChevronRight />
                  </button>
                </div>
              </div>

              <div className="cal-weekdays">
                {['日', '一', '二', '三', '四', '五', '六'].map((w) => (
                  <div key={w} className="cal-weekday">
                    {w}
                  </div>
                ))}
              </div>

              <div className="cal-grid">
                {calendarCells.map((c, i) => {
                  const cls = [
                    'cal-day',
                    c.muted ? 'muted' : '',
                    c.isToday ? 'today' : '',
                    c.isSigned ? 'signed' : '',
                    c.isMissed ? 'miss' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <div key={i} className={cls}>
                      {c.day}
                    </div>
                  );
                })}
              </div>

              <div className="cal-legend">
                <div className="legend-item">
                  <span className="legend-dot today" />
                  <span>今天</span>
                </div>
                <div className="legend-item">
                  <span className="legend-dot signed" />
                  <span>已签到</span>
                </div>
                <div className="legend-item">
                  <span className="legend-dot miss" />
                  <span>漏签</span>
                </div>
              </div>
            </div>

            <div className="panel-card">
              <div className="panel-card-header">
                <h3 className="panel-card-title">
                  <Info />
                  签到规则
                </h3>
              </div>
              <div className="rule-list">
                {RULES.map((r, i) => (
                  <div key={i} className={`rule-item r-${r.accent}`}>
                    <div className="rule-icon">{r.icon}</div>
                    <div className="rule-text">
                      <h5>{r.title}</h5>
                      <p>{r.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* 补签确认弹窗 */}
      {makeupTarget && (
        <div
          className="makeup-mask"
          role="dialog"
          aria-modal="true"
          aria-label="补签确认"
          onClick={closeMakeupConfirm}
        >
          <div className="makeup-modal" onClick={(e) => e.stopPropagation()}>
            <div className="makeup-header">
              <div className="makeup-icon">
                <CalendarPlus size={20} strokeWidth={2.4} />
              </div>
              <div className="makeup-title-block">
                <h3>补签 {makeupTarget.weekdayLabel}</h3>
                <p>{makeupTarget.date}</p>
              </div>
              <button
                type="button"
                className="makeup-close"
                onClick={closeMakeupConfirm}
                aria-label="关闭"
              >
                <X size={18} strokeWidth={2.4} />
              </button>
            </div>
            <div className="makeup-body">
              <p className="makeup-desc">
                消耗 <strong>1 张补签卡</strong> 补签该日，立即视同已签到，并补发该日应得的积分与额外抽奖。
              </p>
              <div className="makeup-rewards">
                <div className="makeup-reward">
                  <Coins size={16} strokeWidth={2.4} />
                  <span>积分 +{makeupTarget.previewPoints}</span>
                </div>
                <div className="makeup-reward">
                  <Gift size={16} strokeWidth={2.4} />
                  <span>额外抽奖 +{makeupTarget.previewSpins}</span>
                </div>
              </div>
              <div className="makeup-stock">
                当前持有补签卡：<strong>{makeupCards}</strong> 张
              </div>
              {makeupError && (
                <div className="makeup-error">
                  <AlertCircle size={14} strokeWidth={2.4} />
                  <span>{makeupError}</span>
                </div>
              )}
            </div>
            <div className="makeup-footer">
              <button
                type="button"
                className="makeup-btn ghost"
                onClick={closeMakeupConfirm}
                disabled={makeupSubmitting}
              >
                取消
              </button>
              <button
                type="button"
                className="makeup-btn primary"
                onClick={handleMakeup}
                disabled={makeupSubmitting || makeupCards <= 0}
              >
                {makeupSubmitting ? (
                  <>
                    <Loader2 className="btn-spin" />
                    补签中…
                  </>
                ) : (
                  <>
                    <CalendarPlus size={14} strokeWidth={2.4} />
                    使用 1 张补签卡
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .lucky-checkin {
          --text-main: #0f172a;
          --text-light: #64748b;
          --card-bg: rgba(255, 255, 255, 0.65);
          --card-border: rgba(255, 255, 255, 1);
          --card-shadow: 0 24px 48px rgba(15, 23, 42, 0.05);
          --radius-xl: 32px;
          --radius-lg: 24px;
          --c-green: #10b981;
          --c-purple: #8b5cf6;
          --c-orange: #f97316;
          --c-red: #f43f5e;
          --c-blue: #3b82f6;
          --c-pink: #ec4899;
          background-color: #f8fafc;
          color: var(--text-main);
          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
          min-height: 100vh;
          position: relative;
          isolation: isolate;
          -webkit-font-smoothing: antialiased;
          -webkit-tap-highlight-color: transparent;
        }

        .lucky-checkin * {
          box-sizing: border-box;
        }

        .lucky-checkin a {
          color: inherit;
          text-decoration: none;
        }

        .lucky-checkin button,
        .lucky-checkin .nav-item,
        .lucky-checkin .checkin-btn,
        .lucky-checkin .cal-day,
        .lucky-checkin .cal-nav-btn,
        .lucky-checkin .reward-day {
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }

        .lucky-checkin .mesh-bg {
          position: fixed;
          inset: 0;
          z-index: -1;
          background-image:
            radial-gradient(circle at 15% 50%, rgba(255, 228, 230, 0.8) 0%, transparent 50%),
            radial-gradient(circle at 85% 30%, rgba(224, 231, 255, 0.8) 0%, transparent 50%),
            radial-gradient(circle at 50% 90%, rgba(254, 243, 199, 0.8) 0%, transparent 50%),
            radial-gradient(circle at 50% 10%, rgba(243, 232, 255, 0.8) 0%, transparent 50%);
          filter: blur(60px);
          animation: ck-fluid 15s infinite alternate ease-in-out;
        }

        @keyframes ck-fluid {
          0% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.05) rotate(2deg); }
          100% { transform: scale(1.1) rotate(-2deg); }
        }

        .lucky-checkin .layout {
          display: flex;
          min-height: 100vh;
          max-width: 1600px;
          margin: 0 auto;
        }

        /* 左栏 */
        .lucky-checkin .panel-left {
          width: 40%;
          padding: 4rem 5rem;
          position: sticky;
          top: 0;
          height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .lucky-checkin .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: var(--text-main);
        }

        .lucky-checkin .brand-icon {
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 10px 20px rgba(255, 122, 0, 0.3);
        }

        .lucky-checkin .brand-icon svg {
          width: 24px;
          height: 24px;
          color: #fff;
          stroke-width: 2.5;
        }

        .lucky-checkin .hero-content {
          margin-top: -5vh;
        }

        .lucky-checkin .hero-title {
          font-size: 64px;
          font-weight: 800;
          line-height: 1.1;
          letter-spacing: -2px;
          margin: 0 0 24px;
        }

        .lucky-checkin .hero-title span {
          background: linear-gradient(135deg, #ff5a00, #ff0080);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .lucky-checkin .nav-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .lucky-checkin .nav-item {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px 24px;
          background: rgba(255, 255, 255, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.6);
          border-radius: 20px;
          font-size: 16px;
          font-weight: 600;
          color: var(--text-main);
          cursor: pointer;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
          width: fit-content;
          min-width: 200px;
        }

        .lucky-checkin .nav-item svg {
          width: 20px;
          height: 20px;
        }

        .lucky-checkin .nav-item:hover,
        .lucky-checkin .nav-item.active {
          background: rgba(255, 255, 255, 0.9);
          transform: translateX(8px);
          box-shadow: 0 10px 20px rgba(0, 0, 0, 0.03);
          color: var(--c-orange);
        }

        .lucky-checkin .user-profile {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px;
          background: #fff;
          border-radius: 999px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
          width: fit-content;
          cursor: pointer;
          transition: transform 0.2s;
        }

        .lucky-checkin .user-profile:hover {
          transform: scale(1.02);
        }

        .lucky-checkin .avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
        }

        .lucky-checkin .user-info h4 {
          font-size: 16px;
          font-weight: 700;
          margin: 0 0 2px;
        }

        .lucky-checkin .user-info p {
          font-size: 13px;
          color: var(--text-light);
          margin: 0;
        }

        .lucky-checkin .profile-arrow {
          width: 20px;
          height: 20px;
          color: #64748b;
          margin-left: auto;
        }

        /* 右栏 */
        .lucky-checkin .panel-right {
          width: 60%;
          padding: 4rem 5rem 4rem 0;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .lucky-checkin .mobile-back {
          display: none;
          align-items: center;
          gap: 4px;
          color: var(--text-light);
          font-size: 14px;
          font-weight: 600;
        }

        .lucky-checkin .mobile-back svg {
          width: 16px;
          height: 16px;
        }

        .lucky-checkin .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 8px;
        }

        .lucky-checkin .section-title {
          font-size: 24px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 10px;
          color: var(--text-main);
          margin: 0 0 4px;
          letter-spacing: -0.5px;
        }

        .lucky-checkin .section-title svg {
          width: 28px;
          height: 28px;
          color: var(--c-orange);
          stroke-width: 2.5;
        }

        .lucky-checkin .header-subtitle {
          font-size: 14px;
          color: var(--text-light);
          margin: 0;
        }

        /* 签到主卡片 */
        .lucky-checkin .checkin-hero {
          background: var(--card-bg);
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid var(--card-border);
          border-radius: var(--radius-xl);
          padding: 32px;
          box-shadow: var(--card-shadow);
          position: relative;
          overflow: hidden;
        }

        .lucky-checkin .checkin-hero::before {
          content: '';
          position: absolute;
          top: -50%;
          right: -20%;
          width: 400px;
          height: 400px;
          background: radial-gradient(circle, rgba(255, 122, 0, 0.15) 0%, transparent 70%);
          pointer-events: none;
        }

        .lucky-checkin .hero-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 24px;
          position: relative;
          z-index: 1;
          flex-wrap: wrap;
        }

        .lucky-checkin .streak-info {
          display: flex;
          align-items: center;
          gap: 20px;
        }

        .lucky-checkin .streak-icon {
          width: 72px;
          height: 72px;
          border-radius: 24px;
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 16px 32px rgba(255, 122, 0, 0.25);
          flex-shrink: 0;
        }

        .lucky-checkin .streak-icon svg {
          width: 32px;
          height: 32px;
          color: #fff;
          stroke-width: 2.5;
        }

        .lucky-checkin .streak-text .label {
          font-size: 14px;
          color: var(--text-light);
          font-weight: 600;
          margin-bottom: 4px;
        }

        .lucky-checkin .streak-text .value {
          font-size: 42px;
          font-weight: 800;
          letter-spacing: -1.5px;
          line-height: 1;
          display: flex;
          align-items: baseline;
          gap: 6px;
        }

        .lucky-checkin .streak-text .value .day {
          font-size: 20px;
          color: var(--text-light);
          font-weight: 600;
        }

        .lucky-checkin .streak-text .sub {
          font-size: 13px;
          color: var(--text-light);
          margin-top: 6px;
        }

        .lucky-checkin .streak-text .sub strong {
          color: var(--c-orange);
          font-weight: 700;
        }

        .lucky-checkin .checkin-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 16px 32px;
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          color: #fff;
          font-size: 16px;
          font-weight: 700;
          border: none;
          border-radius: 999px;
          cursor: pointer;
          box-shadow: 0 12px 24px rgba(255, 122, 0, 0.3);
          transition: transform 0.3s, box-shadow 0.3s;
          white-space: nowrap;
        }

        .lucky-checkin .checkin-btn svg {
          width: 18px;
          height: 18px;
          stroke-width: 2.5;
        }

        .lucky-checkin .checkin-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 18px 32px rgba(255, 122, 0, 0.4);
        }

        .lucky-checkin .checkin-btn.checked {
          background: rgba(16, 185, 129, 0.1);
          color: var(--c-green);
          box-shadow: none;
          cursor: default;
        }

        .lucky-checkin .checkin-btn:disabled {
          cursor: default;
        }

        .lucky-checkin .btn-spin {
          width: 18px;
          height: 18px;
          animation: ck-spin 1s linear infinite;
        }

        @keyframes ck-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        /* 7日奖励 */
        .lucky-checkin .reward-track {
          margin-top: 28px;
          position: relative;
          z-index: 1;
        }

        .lucky-checkin .reward-track-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          font-size: 13px;
          color: var(--text-light);
        }

        .lucky-checkin .reward-track-header strong {
          color: var(--text-main);
          font-weight: 700;
        }

        .lucky-checkin .reward-days {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 10px;
        }

        .lucky-checkin .reward-day {
          background: rgba(255, 255, 255, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.8);
          border-radius: 16px;
          padding: 12px 8px;
          text-align: center;
          transition: all 0.3s ease;
          position: relative;
        }

        .lucky-checkin .reward-day .d-num {
          font-size: 11px;
          color: var(--text-light);
          font-weight: 600;
          margin-bottom: 6px;
        }

        .lucky-checkin .reward-day .d-icon {
          width: 32px;
          height: 32px;
          margin: 0 auto 6px;
          background: rgba(15, 23, 42, 0.05);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-light);
          transition: all 0.3s;
        }

        .lucky-checkin .reward-day .d-icon svg {
          width: 14px;
          height: 14px;
        }

        .lucky-checkin .reward-day .d-icon .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
        }

        .lucky-checkin .reward-day .d-icon .ring {
          width: 12px;
          height: 12px;
          border: 2px solid currentColor;
          border-radius: 50%;
        }

        .lucky-checkin .reward-day .d-reward {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-main);
        }

        .lucky-checkin .reward-day.done {
          background: rgba(16, 185, 129, 0.08);
          border-color: rgba(16, 185, 129, 0.2);
        }

        .lucky-checkin .reward-day.done .d-icon {
          background: var(--c-green);
          color: #fff;
        }

        .lucky-checkin .reward-day.today {
          background: linear-gradient(135deg, rgba(255, 122, 0, 0.12), rgba(255, 0, 76, 0.08));
          border-color: rgba(255, 122, 0, 0.3);
          transform: translateY(-4px);
          box-shadow: 0 12px 24px rgba(255, 122, 0, 0.15);
        }

        .lucky-checkin .reward-day.today .d-icon {
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          color: #fff;
        }

        .lucky-checkin .reward-day.today .d-num {
          color: var(--c-orange);
        }

        .lucky-checkin .reward-day.bonus .d-icon {
          background: linear-gradient(135deg, #fbbf24, #f97316);
          color: #fff;
        }

        .lucky-checkin .reward-day.missed {
          background: rgba(244, 63, 94, 0.06);
          border-color: rgba(244, 63, 94, 0.2);
          opacity: 0.85;
        }

        .lucky-checkin .reward-day.missed .d-icon {
          background: rgba(244, 63, 94, 0.12);
          color: var(--c-red);
        }

        .lucky-checkin .reward-day.missed .d-reward {
          color: var(--text-light);
        }

        .lucky-checkin .reward-day .d-icon .cross {
          font-size: 14px;
          font-weight: 800;
          line-height: 1;
        }

        /* 漏签且持有补签卡：可点击 */
        .lucky-checkin .reward-day.can-makeup {
          cursor: pointer;
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.10), rgba(20, 184, 166, 0.06));
          border-color: rgba(16, 185, 129, 0.32);
          opacity: 1;
          transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        }

        .lucky-checkin .reward-day.can-makeup .d-icon {
          background: rgba(16, 185, 129, 0.18);
          color: var(--c-green);
        }

        .lucky-checkin .reward-day.can-makeup .d-reward {
          color: var(--c-green);
          font-weight: 700;
        }

        .lucky-checkin .reward-day.can-makeup:hover {
          transform: translateY(-2px);
          border-color: rgba(16, 185, 129, 0.55);
          box-shadow: 0 14px 28px rgba(16, 185, 129, 0.18);
        }

        .lucky-checkin .reward-day.can-makeup:focus-visible {
          outline: 2px solid var(--c-green);
          outline-offset: 2px;
        }

        /* 抽奖入口 */
        .lucky-checkin .lottery-cta {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 20px;
          padding: 14px 20px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(249, 115, 22, 0.25);
          color: var(--text-main);
          font-size: 14px;
          font-weight: 600;
          position: relative;
          z-index: 1;
          transition: all 0.3s;
        }

        .lucky-checkin .lottery-cta:hover {
          background: #fff;
          transform: translateX(4px);
        }

        .lucky-checkin .lottery-cta svg {
          width: 18px;
          height: 18px;
          color: var(--c-orange);
        }

        .lucky-checkin .lottery-cta strong {
          color: var(--c-orange);
        }

        .lucky-checkin .lottery-cta > svg:last-child {
          margin-left: auto;
          color: var(--text-light);
        }

        /* 数据统计 */
        .lucky-checkin .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }

        .lucky-checkin .stat-card {
          background: var(--card-bg);
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid var(--card-border);
          border-radius: var(--radius-lg);
          padding: 20px;
          box-shadow: var(--card-shadow);
          transition: all 0.3s ease;
          position: relative;
          overflow: hidden;
        }

        .lucky-checkin .stat-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 30px 50px rgba(15, 23, 42, 0.08);
        }

        .lucky-checkin .stat-icon {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #fff;
          margin-bottom: 12px;
        }

        .lucky-checkin .stat-icon svg {
          width: 20px;
          height: 20px;
        }

        .lucky-checkin .stat-card.s-1 .stat-icon { color: var(--c-orange); box-shadow: 0 10px 20px rgba(249, 115, 22, 0.15); }
        .lucky-checkin .stat-card.s-2 .stat-icon { color: var(--c-green); box-shadow: 0 10px 20px rgba(16, 185, 129, 0.15); }
        .lucky-checkin .stat-card.s-3 .stat-icon { color: var(--c-purple); box-shadow: 0 10px 20px rgba(139, 92, 246, 0.15); }
        .lucky-checkin .stat-card.s-4 .stat-icon { color: var(--c-blue); box-shadow: 0 10px 20px rgba(59, 130, 246, 0.15); }

        .lucky-checkin .stat-label {
          font-size: 12px;
          color: var(--text-light);
          font-weight: 600;
          margin-bottom: 4px;
        }

        .lucky-checkin .stat-value {
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -1px;
          line-height: 1.1;
        }

        .lucky-checkin .stat-value .unit {
          font-size: 13px;
          color: var(--text-light);
          font-weight: 600;
          margin-left: 2px;
        }

        /* 可点击的统计卡（如"补签卡"）：保持卡片样式，加上 hover 反馈与说明文 */
        .lucky-checkin .stat-link {
          display: block;
          color: inherit;
          text-decoration: none;
        }

        .lucky-checkin .stat-card.stat-link:hover {
          border-color: rgba(16, 185, 129, 0.4);
          box-shadow: 0 30px 50px rgba(16, 185, 129, 0.18);
        }

        .lucky-checkin .stat-foot {
          margin-top: 6px;
          font-size: 11px;
          color: var(--c-green);
          font-weight: 700;
          letter-spacing: 0.3px;
        }

        /* === 补签确认弹窗 === */
        .lucky-checkin .makeup-mask {
          position: fixed;
          inset: 0;
          z-index: 200;
          background: radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.45) 0%, rgba(6, 78, 59, 0.78) 45%, rgba(15, 23, 42, 0.92) 100%);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          animation: makeup-mask-in 0.25s ease;
        }
        @keyframes makeup-mask-in { from { opacity: 0; } to { opacity: 1; } }

        .lucky-checkin .makeup-modal {
          width: min(480px, 100%);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(236, 253, 245, 0.92));
          border: 1px solid rgba(255, 255, 255, 1);
          border-radius: 24px;
          box-shadow: 0 30px 60px rgba(6, 78, 59, 0.4), inset 0 1px 0 rgba(255, 255, 255, 1);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          position: relative;
          animation: makeup-pop 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes makeup-pop {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .lucky-checkin .makeup-modal::before {
          content: '';
          position: absolute;
          top: -40%;
          right: -20%;
          width: 320px;
          height: 320px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(52, 211, 153, 0.25), transparent 60%);
          filter: blur(36px);
          pointer-events: none;
        }

        .lucky-checkin .makeup-header {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 20px 24px;
          border-bottom: 1px solid rgba(16, 185, 129, 0.14);
          background: linear-gradient(135deg, rgba(220, 252, 231, 0.7), rgba(204, 251, 241, 0.5));
          flex-shrink: 0;
          position: relative;
          z-index: 1;
        }

        .lucky-checkin .makeup-icon {
          width: 42px;
          height: 42px;
          border-radius: 14px;
          background: linear-gradient(135deg, #34d399, #10b981);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 12px 24px rgba(16, 185, 129, 0.35);
          flex-shrink: 0;
        }

        .lucky-checkin .makeup-title-block {
          flex: 1;
          min-width: 0;
        }

        .lucky-checkin .makeup-title-block h3 {
          font-size: 17px;
          font-weight: 900;
          color: #065f46;
          margin: 0;
          letter-spacing: -0.3px;
        }

        .lucky-checkin .makeup-title-block p {
          font-size: 12px;
          color: var(--text-light);
          margin: 4px 0 0;
          font-weight: 600;
        }

        .lucky-checkin .makeup-close {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: rgba(15, 23, 42, 0.05);
          border: none;
          color: var(--text-light);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          flex-shrink: 0;
        }
        .lucky-checkin .makeup-close:hover {
          background: rgba(16, 185, 129, 0.18);
          color: #047857;
          transform: rotate(90deg);
        }

        .lucky-checkin .makeup-body {
          padding: 20px 24px 4px;
          position: relative;
          z-index: 1;
        }

        .lucky-checkin .makeup-desc {
          font-size: 13.5px;
          color: #334155;
          line-height: 1.7;
          margin: 0 0 14px;
        }

        .lucky-checkin .makeup-desc strong {
          color: #047857;
        }

        .lucky-checkin .makeup-rewards {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 14px;
        }

        .lucky-checkin .makeup-reward {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: 999px;
          background: rgba(16, 185, 129, 0.10);
          color: #047857;
          border: 1px solid rgba(16, 185, 129, 0.25);
          font-size: 12.5px;
          font-weight: 700;
        }

        .lucky-checkin .makeup-stock {
          font-size: 12px;
          color: var(--text-light);
          font-weight: 600;
          padding: 8px 12px;
          background: rgba(15, 23, 42, 0.04);
          border-radius: 10px;
        }

        .lucky-checkin .makeup-stock strong {
          color: var(--text-main);
        }

        .lucky-checkin .makeup-error {
          margin-top: 10px;
          padding: 8px 12px;
          background: rgba(244, 63, 94, 0.08);
          border: 1px solid rgba(244, 63, 94, 0.25);
          border-radius: 10px;
          color: #be123c;
          font-size: 12.5px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .lucky-checkin .makeup-footer {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding: 14px 24px 20px;
          border-top: 1px solid rgba(15, 23, 42, 0.06);
          position: relative;
          z-index: 1;
        }

        .lucky-checkin .makeup-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 9px 16px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 800;
          border: none;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
        }

        .lucky-checkin .makeup-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .lucky-checkin .makeup-btn.ghost {
          background: rgba(15, 23, 42, 0.05);
          color: var(--text-main);
        }

        .lucky-checkin .makeup-btn.ghost:hover:not(:disabled) {
          background: rgba(15, 23, 42, 0.10);
        }

        .lucky-checkin .makeup-btn.primary {
          color: #ffffff;
          background: linear-gradient(135deg, #34d399, #10b981);
          box-shadow: 0 10px 20px rgba(16, 185, 129, 0.35);
        }

        .lucky-checkin .makeup-btn.primary:hover:not(:disabled) {
          transform: translateY(-1px) scale(1.02);
        }

        .lucky-checkin .makeup-btn .btn-spin {
          width: 14px;
          height: 14px;
          animation: spin 1s linear infinite;
        }

        /* 通用面板 */
        .lucky-checkin .panel-card {
          background: var(--card-bg);
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid var(--card-border);
          border-radius: var(--radius-xl);
          padding: 28px;
          box-shadow: var(--card-shadow);
        }

        .lucky-checkin .panel-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .lucky-checkin .panel-card-title {
          font-size: 17px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 8px;
          letter-spacing: -0.3px;
          margin: 0;
        }

        .lucky-checkin .panel-card-title svg {
          width: 18px;
          height: 18px;
          color: var(--c-orange);
          stroke-width: 2.5;
        }

        /* 日历 */
        .lucky-checkin .cal-nav {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .lucky-checkin .cal-nav-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--text-light);
          transition: all 0.2s;
        }

        .lucky-checkin .cal-nav-btn svg {
          width: 14px;
          height: 14px;
          stroke-width: 2.5;
        }

        .lucky-checkin .cal-nav-btn:hover:not(:disabled) {
          background: #fff;
          color: var(--text-main);
        }

        .lucky-checkin .cal-nav-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .lucky-checkin .cal-month-label {
          font-size: 14px;
          font-weight: 700;
          min-width: 90px;
          text-align: center;
        }

        .lucky-checkin .cal-weekdays {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 6px;
          margin-bottom: 8px;
        }

        .lucky-checkin .cal-weekday {
          text-align: center;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-light);
          padding: 6px 0;
        }

        .lucky-checkin .cal-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 6px;
        }

        .lucky-checkin .cal-day {
          aspect-ratio: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-main);
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
          background: transparent;
        }

        .lucky-checkin .cal-day:hover {
          background: rgba(255, 255, 255, 0.7);
        }

        .lucky-checkin .cal-day.muted {
          color: rgba(15, 23, 42, 0.25);
        }

        .lucky-checkin .cal-day.signed {
          background: rgba(16, 185, 129, 0.12);
          color: var(--c-green);
          font-weight: 700;
        }

        .lucky-checkin .cal-day.signed::after {
          content: '';
          position: absolute;
          bottom: 4px;
          left: 50%;
          transform: translateX(-50%);
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: var(--c-green);
        }

        .lucky-checkin .cal-day.miss {
          background: rgba(244, 63, 94, 0.08);
          color: #e11d48;
          font-weight: 800;
          border: 1px solid rgba(244, 63, 94, 0.16);
        }

        .lucky-checkin .cal-day.miss::after {
          content: '×';
          position: absolute;
          bottom: 3px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 10px;
          line-height: 1;
          color: #e11d48;
          font-weight: 900;
        }

        .lucky-checkin .cal-day.today {
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          color: #fff;
          box-shadow: 0 8px 16px rgba(255, 122, 0, 0.3);
        }

        .lucky-checkin .cal-day.today.signed {
          background: linear-gradient(135deg, #10b981 0%, #f97316 100%);
          color: #fff;
          box-shadow: 0 8px 18px rgba(16, 185, 129, 0.24), 0 0 0 3px rgba(249, 115, 22, 0.14);
        }

        .lucky-checkin .cal-day.today.signed::after {
          background: #fff;
        }

        .lucky-checkin .cal-legend {
          display: flex;
          gap: 16px;
          margin-top: 16px;
          padding-top: 16px;
          border-top: 1px solid rgba(15, 23, 42, 0.05);
          flex-wrap: wrap;
        }

        .lucky-checkin .legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--text-light);
          font-weight: 600;
        }

        .lucky-checkin .legend-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }

        .lucky-checkin .legend-dot.signed { background: var(--c-green); }
        .lucky-checkin .legend-dot.today { background: linear-gradient(135deg, #ff7a00, #ff004c); }
        .lucky-checkin .legend-dot.miss { background: rgba(244, 63, 94, 0.4); }

        /* 双列 */
        .lucky-checkin .two-col {
          display: grid;
          /* 两列等宽：规则面板宽度与日历一致 */
          grid-template-columns: 1fr 1fr;
          gap: 24px;
          /* grid 默认 align-items: stretch，让两列高度对齐，规则区域内部滚动 */
          align-items: stretch;
        }

        .lucky-checkin .two-col > .panel-card {
          display: flex;
          flex-direction: column;
          /* 让 panel-card 不超过 grid 行高，使内部 rule-list 能正确启用 overflow */
          min-height: 0;
        }

        /* 规则面板独立限高（与日历视觉等高），超出由 .rule-list 内部滚动 */
        .lucky-checkin .two-col > .panel-card:nth-child(2) {
          max-height: min(560px, 70vh);
        }

        .lucky-checkin .two-col .rule-list {
          flex: 1;
          /* 内容溢出时可纵向滑动，与日历区域等高 */
          min-height: 0;
          overflow-y: auto;
          /* 给底部一点呼吸空间，避免最后一条规则贴边 */
          padding-right: 4px;
        }
        .lucky-checkin .two-col .rule-list::-webkit-scrollbar {
          width: 6px;
        }
        .lucky-checkin .two-col .rule-list::-webkit-scrollbar-thumb {
          background: rgba(15, 23, 42, 0.18);
          border-radius: 999px;
        }
        .lucky-checkin .two-col .rule-list::-webkit-scrollbar-thumb:hover {
          background: rgba(15, 23, 42, 0.32);
        }
        .lucky-checkin .two-col .rule-list::-webkit-scrollbar-track {
          background: transparent;
        }

        /* 规则 */
        .lucky-checkin .rule-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .lucky-checkin .rule-item {
          display: flex;
          gap: 14px;
          align-items: flex-start;
        }

        .lucky-checkin .rule-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .lucky-checkin .rule-icon svg {
          width: 18px;
          height: 18px;
        }

        .lucky-checkin .rule-item.r-orange .rule-icon { background: rgba(255, 122, 0, 0.1); color: var(--c-orange); }
        .lucky-checkin .rule-item.r-purple .rule-icon { background: rgba(139, 92, 246, 0.1); color: var(--c-purple); }
        .lucky-checkin .rule-item.r-green .rule-icon { background: rgba(16, 185, 129, 0.1); color: var(--c-green); }
        .lucky-checkin .rule-item.r-pink .rule-icon { background: rgba(236, 72, 153, 0.1); color: var(--c-pink); }

        .lucky-checkin .rule-text {
          flex: 1;
        }

        .lucky-checkin .rule-text h5 {
          font-size: 14px;
          font-weight: 700;
          margin: 0 0 2px;
        }

        .lucky-checkin .rule-text p {
          font-size: 12.5px;
          color: var(--text-light);
          line-height: 1.5;
          margin: 0;
        }

        /* 响应式 */
        @media (max-width: 1200px) {
          .lucky-checkin .hero-title { font-size: 42px; }
          .lucky-checkin .panel-left { padding: 3rem; }
          .lucky-checkin .panel-right { padding: 3rem 3rem 3rem 0; gap: 20px; }
          .lucky-checkin .checkin-hero { padding: 24px; }
          .lucky-checkin .stats-grid { gap: 12px; }
          .lucky-checkin .stat-value { font-size: 22px; }
          .lucky-checkin .two-col { grid-template-columns: 1fr; }
        }

        @media (max-width: 992px) {
          .lucky-checkin .layout {
            flex-direction: column;
            padding-left: env(safe-area-inset-left);
            padding-right: env(safe-area-inset-right);
          }

          .lucky-checkin .panel-left {
            width: 100%;
            height: auto;
            position: relative;
            padding: 1.5rem 2rem 0;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            text-align: left;
            z-index: 10;
            padding-top: max(1.5rem, env(safe-area-inset-top));
          }

          .lucky-checkin .brand { font-size: 20px; }
          .lucky-checkin .brand-icon { width: 32px; height: 32px; border-radius: 10px; }
          .lucky-checkin .brand-icon svg { width: 18px; height: 18px; }

          .lucky-checkin .user-profile {
            position: absolute;
            top: max(1.5rem, env(safe-area-inset-top));
            right: 2rem;
            margin: 0;
            padding: 0;
            width: auto;
            background: transparent;
            border: none;
            box-shadow: none;
          }
          .lucky-checkin .user-profile .user-info,
          .lucky-checkin .user-profile .profile-arrow { display: none; }
          .lucky-checkin .user-profile .avatar { width: 40px; height: 40px; margin: 0; }

          .lucky-checkin .hero-content { margin-top: 1rem; width: 100%; }
          .lucky-checkin .hero-title { font-size: 36px; margin-bottom: 16px; }

          .lucky-checkin .nav-list {
            flex-direction: row;
            flex-wrap: nowrap;
            overflow-x: auto;
            width: 100%;
            gap: 12px;
            padding-bottom: 16px;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
          }
          .lucky-checkin .nav-list::-webkit-scrollbar { display: none; }
          .lucky-checkin .nav-item {
            flex: 0 0 auto;
            padding: 10px 16px;
            font-size: 14px;
            min-width: 0;
            min-height: 40px;
          }
          .lucky-checkin .nav-item:hover,
          .lucky-checkin .nav-item.active { transform: none; }

          .lucky-checkin .panel-right {
            width: 100%;
            padding: 1rem 2rem 4rem;
            padding-bottom: max(4rem, calc(2rem + env(safe-area-inset-bottom)));
            gap: 20px;
          }

          .lucky-checkin .stats-grid { grid-template-columns: repeat(4, 1fr); }
          .lucky-checkin .reward-days { gap: 6px; }
          .lucky-checkin .reward-day { padding: 10px 4px; }
          .lucky-checkin .reward-day .d-icon { width: 28px; height: 28px; }
          .lucky-checkin .checkin-btn { min-height: 48px; }
          .lucky-checkin .cal-nav-btn { width: 36px; height: 36px; }
        }

        @media (max-width: 640px) {
          .lucky-checkin .panel-left { padding: 1rem 1.25rem 0; }
          .lucky-checkin .brand { font-size: 18px; gap: 10px; }
          .lucky-checkin .brand-icon { width: 30px; height: 30px; }
          .lucky-checkin .user-profile { right: 1.25rem; }
          .lucky-checkin .user-profile .avatar { width: 36px; height: 36px; }

          .lucky-checkin .hero-content { margin-top: 0.5rem; }
          .lucky-checkin .hero-title { font-size: 28px; line-height: 1.2; word-wrap: break-word; margin-bottom: 12px; }

          .lucky-checkin .nav-item { padding: 9px 14px; font-size: 13px; }
          .lucky-checkin .nav-item svg { width: 16px; height: 16px; }

          .lucky-checkin .panel-right {
            padding: 0.875rem 1rem max(3rem, calc(2rem + env(safe-area-inset-bottom)));
            gap: 14px;
          }

          .lucky-checkin .page-header { margin-bottom: 0; }
          .lucky-checkin .section-title { font-size: 21px; gap: 8px; }
          .lucky-checkin .section-title svg { width: 22px; height: 22px; }
          .lucky-checkin .header-subtitle { font-size: 13px; }

          .lucky-checkin .checkin-hero { padding: 18px; border-radius: 22px; }
          .lucky-checkin .checkin-hero::before { width: 280px; height: 280px; }
          .lucky-checkin .hero-row { flex-direction: column; align-items: stretch; gap: 16px; }
          .lucky-checkin .streak-info { gap: 14px; }
          .lucky-checkin .streak-icon { width: 52px; height: 52px; border-radius: 16px; }
          .lucky-checkin .streak-icon svg { width: 24px; height: 24px; }
          .lucky-checkin .streak-text .label { font-size: 13px; }
          .lucky-checkin .streak-text .value { font-size: 30px; }
          .lucky-checkin .streak-text .value .day { font-size: 16px; }
          .lucky-checkin .streak-text .sub { font-size: 12px; line-height: 1.45; }
          .lucky-checkin .checkin-btn {
            width: 100%;
            justify-content: center;
            padding: 14px 24px;
            font-size: 15px;
            min-height: 48px;
          }

          .lucky-checkin .reward-track { margin-top: 20px; }
          .lucky-checkin .reward-track-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
            font-size: 12px;
          }
          .lucky-checkin .reward-days { gap: 3px; }
          .lucky-checkin .reward-day { padding: 8px 2px; border-radius: 11px; }
          .lucky-checkin .reward-day .d-icon { width: 22px; height: 22px; margin-bottom: 4px; }
          .lucky-checkin .reward-day .d-icon svg { width: 11px; height: 11px; }
          .lucky-checkin .reward-day .d-num { font-size: 9px; margin-bottom: 4px; }
          .lucky-checkin .reward-day .d-reward { font-size: 10px; }

          .lucky-checkin .stats-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
          .lucky-checkin .stat-card { padding: 14px; border-radius: 18px; }
          .lucky-checkin .stat-icon { width: 36px; height: 36px; border-radius: 10px; margin-bottom: 8px; }
          .lucky-checkin .stat-icon svg { width: 18px; height: 18px; }
          .lucky-checkin .stat-label { font-size: 11px; }
          .lucky-checkin .stat-value { font-size: 22px; }
          .lucky-checkin .stat-value .unit { font-size: 12px; }

          .lucky-checkin .panel-card { padding: 16px; border-radius: 20px; }
          .lucky-checkin .panel-card-header { flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
          .lucky-checkin .panel-card-title { font-size: 15px; }
          .lucky-checkin .two-col .panel-card:last-child {
            width: 100%;
            justify-self: stretch;
            margin-inline: 0;
            max-height: min(420px, 58vh);
          }

          .lucky-checkin .cal-nav { gap: 4px; }
          .lucky-checkin .cal-nav-btn { width: 32px; height: 32px; }
          .lucky-checkin .cal-month-label { font-size: 13px; min-width: 80px; }
          .lucky-checkin .cal-weekdays { gap: 4px; margin-bottom: 4px; }
          .lucky-checkin .cal-weekday { font-size: 11px; padding: 4px 0; }
          .lucky-checkin .cal-grid { gap: 4px; }
          .lucky-checkin .cal-day { font-size: 12px; border-radius: 10px; }
          .lucky-checkin .cal-legend { gap: 12px; margin-top: 12px; padding-top: 12px; }
          .lucky-checkin .legend-item { font-size: 11px; }

          .lucky-checkin .rule-list { gap: 12px; }
          .lucky-checkin .rule-item { gap: 12px; }
          .lucky-checkin .rule-icon { width: 32px; height: 32px; border-radius: 9px; }
          .lucky-checkin .rule-icon svg { width: 16px; height: 16px; }
          .lucky-checkin .rule-text h5 { font-size: 13px; }
          .lucky-checkin .rule-text p { font-size: 12px; }
        }

        @media (max-width: 480px) {
          .lucky-checkin .panel-left { padding: 0.875rem 1rem 0; }
          .lucky-checkin .panel-right { padding: 0.75rem 0.875rem 2.5rem; }
          .lucky-checkin .user-profile { right: 1rem; }

          .lucky-checkin .hero-title { font-size: 26px; }
          .lucky-checkin .hero-content { margin-top: 0.25rem; }

          .lucky-checkin .checkin-hero { padding: 16px; border-radius: 20px; }
          .lucky-checkin .streak-icon { width: 48px; height: 48px; border-radius: 15px; }
          .lucky-checkin .streak-text .value { font-size: 28px; }

          .lucky-checkin .reward-day { padding: 6px 1px; border-radius: 9px; }
          .lucky-checkin .reward-day .d-icon { width: 20px; height: 20px; margin-bottom: 3px; }
          .lucky-checkin .reward-day .d-num { font-size: 8.5px; margin-bottom: 3px; }
          .lucky-checkin .reward-day .d-reward { font-size: 9.5px; }

          .lucky-checkin .stat-card { padding: 13px; }
          .lucky-checkin .stat-value { font-size: 20px; }
          .lucky-checkin .panel-card { padding: 14px; border-radius: 18px; }
          .lucky-checkin .two-col .panel-card:last-child {
            max-height: min(360px, 54vh);
          }
        }
      `}</style>
    </div>
  );
}
