'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Bomb,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  Flame,
  Gift,
  Home,
  Loader2,
  RotateCcw,
  Sparkles,
  Ticket,
  X,
} from 'lucide-react';
import type { PublicAchievement } from '@/lib/profile-achievements';

// ============================================================================
// 奖品配置（视觉角度按概率不等划分，让大奖扇区更窄）
// 与后端 DEFAULT_TIERS（src/lib/lottery.ts）保持一致
// ============================================================================
const PRIZES = [
  { id: 'pts_200', name: '橙子', value: 200, visualAngle: 28.8 },
  { id: 'pts_150', name: '钻石', value: 150, visualAngle: 21.6 },
  { id: 'pts_100', name: '金币', value: 100, visualAngle: 43.2 },
  { id: 'pts_50', name: '星星', value: 50, visualAngle: 64.8 },
  { id: 'pts_30', name: '小狗', value: 30, visualAngle: 79.2 },
  { id: 'pts_10', name: '小猫', value: 10, visualAngle: 86.4 },
  { id: 'pts_0', name: '谢谢惠顾', value: 0, visualAngle: 36 },
];

// 每个奖品对应的视觉风格（颜色 / icon emoji）
const PRIZE_STYLES: Record<string, { color: string; icon: string; textColor: string }> = {
  pts_200: { color: '#fb923c', icon: '🍊', textColor: '#9a3412' },
  pts_150: { color: '#8b5cf6', icon: '💎', textColor: '#5b21b6' },
  pts_100: { color: '#facc15', icon: '🪙', textColor: '#854d0e' },
  pts_50: { color: '#3b82f6', icon: '⭐', textColor: '#1d4ed8' },
  pts_30: { color: '#10b981', icon: '🐶', textColor: '#047857' },
  pts_10: { color: '#06b6d4', icon: '🐱', textColor: '#0e7490' },
  pts_0: { color: '#ec4899', icon: '❤️', textColor: '#9d174d' },
};

const calculateAngles = () => {
  let currentAngle = 0;
  return PRIZES.map((prize) => {
    const startAngle = currentAngle;
    const endAngle = currentAngle + prize.visualAngle;
    currentAngle = endAngle;
    return { ...prize, startAngle, endAngle };
  });
};

const PRIZES_WITH_ANGLES = calculateAngles();

// ----- 业务常量 -----
// 转盘减速旋转总时长（一次性从快到慢）
const SPIN_DECELERATION_MS = 4500;
// 减速阶段额外旋转圈数（保证视觉冲击力）
const SPIN_EXTRA_ROUNDS = 5;
// 数字炸弹倍率显示标签
const NUMBER_BOMB_MULTIPLIER_LABELS: Record<number, string> = {
  1: '不加倍',
  2: 'X2',
  5: 'X5',
  10: 'X10',
};

// ----- 类型 -----
interface UserData {
  id: number;
  username: string;
  displayName: string;
  isAdmin?: boolean;
}

interface LotteryRecord {
  id: string;
  tierName: string;
  tierValue: number;
  code: string;
  directCredit?: boolean;
  pointsAwarded?: number;
  createdAt: number;
}

interface LotteryApiPayload {
  success: boolean;
  user: UserData;
  records: LotteryRecord[];
  canSpin: boolean;
  hasSpunToday: boolean;
  extraSpins: number;
  dailySpinLimit: number;
  dailySpinUsed: number;
  dailySpinRemaining: number;
}

interface LotterySpinResponse {
  success: boolean;
  message?: string;
  record?: LotteryRecord;
}

interface MyProfile {
  displayName: string | null;
  avatarUrl: string | null;
  equippedAchievement: PublicAchievement | null;
}

// ----- 数字炸弹类型 -----
type NumberBombMultiplier = 1 | 2 | 5 | 10;
type NumberBombStatus = 'pending' | 'won' | 'lost' | 'cancelled';

interface NumberBombBet {
  id: string;
  userId: number;
  username: string;
  date: string;
  selectedNumber: number;
  multiplier: NumberBombMultiplier;
  ticketCost: number;
  status: NumberBombStatus;
  systemNumber?: number;
  rewardPoints?: number;
  createdAt: number;
  updatedAt: number;
  settledAt?: number;
}

interface NumberBombState {
  date: string;
  yesterday: string;
  balance: number;
  baseTicketCost: number;
  multipliers: NumberBombMultiplier[];
  todayBet: NumberBombBet | null;
  yesterdayBet: NumberBombBet | null;
  todaySystemNumber: number | null;
  yesterdaySystemNumber: number | null;
}

// ============================================================================
// 主组件
// ============================================================================
export default function LotteryPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [myProfile, setMyProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [canSpin, setCanSpin] = useState(false);
  const [hasSpunToday, setHasSpunToday] = useState(false);
  const [extraSpins, setExtraSpins] = useState(0);
  const [dailySpinLimit, setDailySpinLimit] = useState(10);
  const [dailySpinRemaining, setDailySpinRemaining] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [spinTransition, setSpinTransition] = useState<string>('none');
  const [result, setResult] = useState<{
    name: string;
    code: string;
    directCredit?: boolean;
    value?: number;
    pointsAwarded?: number;
  } | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ----- 数字炸弹状态 -----
  const [bombState, setBombState] = useState<NumberBombState | null>(null);
  const [bombLoading, setBombLoading] = useState(true);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [selectedMultiplier, setSelectedMultiplier] = useState<NumberBombMultiplier>(1);
  const [bombSubmitting, setBombSubmitting] = useState(false);
  const [bombMessage, setBombMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 清理引用
  const spinTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const confettiFrameRef = useRef<number | null>(null);
  const confettiEndTimeRef = useRef<number>(0);
  const modalCopyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const bombMessageTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ---------- 卸载清理 ----------
  useEffect(() => {
    return () => {
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
      if (confettiFrameRef.current) cancelAnimationFrame(confettiFrameRef.current);
      if (modalCopyTimeoutRef.current) clearTimeout(modalCopyTimeoutRef.current);
      if (bombMessageTimeoutRef.current) clearTimeout(bombMessageTimeoutRef.current);
    };
  }, []);

  const showBombMessage = useCallback((type: 'success' | 'error', text: string) => {
    setBombMessage({ type, text });
    if (bombMessageTimeoutRef.current) clearTimeout(bombMessageTimeoutRef.current);
    bombMessageTimeoutRef.current = setTimeout(() => setBombMessage(null), 3500);
  }, []);

  // ---------- 数据加载 ----------
  const fetchData = useCallback(async () => {
    try {
      const [lotteryRes, profileRes] = await Promise.all([
        fetch('/api/lottery'),
        fetch('/api/profile/settings', { cache: 'no-store' }).catch(() => null),
      ]);
      const data: LotteryApiPayload = await lotteryRes.json();

      if (lotteryRes.status === 401 || !data.success || !data.user) {
        router.push('/login?redirect=/lottery');
        return;
      }

      setUser(data.user);
      setCanSpin(Boolean(data.canSpin));
      setHasSpunToday(Boolean(data.hasSpunToday));
      setExtraSpins(typeof data.extraSpins === 'number' ? data.extraSpins : 0);
      setDailySpinLimit(typeof data.dailySpinLimit === 'number' ? data.dailySpinLimit : 10);
      setDailySpinRemaining(typeof data.dailySpinRemaining === 'number' ? data.dailySpinRemaining : 0);
      setError(null);

      if (profileRes && profileRes.ok) {
        const profileJson = await profileRes.json().catch(() => ({ success: false }));
        if (profileJson?.success && profileJson.data) {
          setMyProfile({
            displayName: profileJson.data.displayName ?? null,
            avatarUrl: profileJson.data.avatarUrl ?? null,
            equippedAchievement: profileJson.data.equippedAchievement ?? null,
          });
        }
      }
    } catch (err) {
      console.error('加载失败', err);
      setError('网络连接失败');
    } finally {
      setLoading(false);
    }
  }, [router]);

  const fetchBomb = useCallback(async (silent = false) => {
    if (!silent) setBombLoading(true);
    try {
      const res = await fetch('/api/lottery/number-bomb', { cache: 'no-store' });
      if (res.status === 401) {
        router.push('/login?redirect=/lottery');
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || '获取数字炸弹状态失败');
      }
      const state = data.data as NumberBombState;
      setBombState(state);

      // 已下注或已取消时，将选择项同步为当前下注，让用户能看到
      if (state.todayBet && state.todayBet.status === 'pending') {
        setSelectedNumber(state.todayBet.selectedNumber);
        setSelectedMultiplier(state.todayBet.multiplier);
      }
    } catch (err) {
      console.error('获取数字炸弹状态失败', err);
    } finally {
      setBombLoading(false);
    }
  }, [router]);

  const handleNumberBombBet = useCallback(async () => {
    if (selectedNumber === null) {
      showBombMessage('error', '请先在 0~9 中选择一个数字');
      return;
    }
    if (bombSubmitting) return;
    setBombSubmitting(true);
    try {
      const res = await fetch('/api/lottery/number-bomb/bet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selectedNumber, multiplier: selectedMultiplier }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showBombMessage('error', data.message || '下注失败');
        return;
      }
      showBombMessage('success', data.message || '下注成功');
      await fetchBomb(true);
    } catch (err) {
      console.error('数字炸弹下注失败', err);
      showBombMessage('error', '网络异常，请稍后重试');
    } finally {
      setBombSubmitting(false);
    }
  }, [selectedNumber, selectedMultiplier, bombSubmitting, fetchBomb, showBombMessage]);

  const handleNumberBombCancel = useCallback(async () => {
    if (bombSubmitting) return;
    setBombSubmitting(true);
    try {
      const res = await fetch('/api/lottery/number-bomb/cancel', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showBombMessage('error', data.message || '取消失败');
        return;
      }
      showBombMessage('success', data.message || '已退还门票');
      setSelectedNumber(null);
      setSelectedMultiplier(1);
      await fetchBomb(true);
    } catch (err) {
      console.error('数字炸弹取消失败', err);
      showBombMessage('error', '网络异常，请稍后重试');
    } finally {
      setBombSubmitting(false);
    }
  }, [bombSubmitting, fetchBomb, showBombMessage]);

  // ---------- 初始化 ----------
  useEffect(() => {
    void fetchData();
    void fetchBomb();
  }, [fetchData, fetchBomb]);

  // ---------- 抽奖 ----------
  const handleSpin = useCallback(async () => {
    if (!canSpin || spinning) return;

    setSpinning(true);
    setError(null);

    try {
      const res = await fetch('/api/lottery/spin', { method: 'POST' });
      const data: LotterySpinResponse = await res.json();

      if (!data.success) {
        setError(data.message || '抽奖失败');
        setSpinning(false);
        return;
      }

      const record = data.record;
      if (!record) {
        setError('系统错误：中奖结果缺失');
        setSpinning(false);
        return;
      }

      const prize = PRIZES_WITH_ANGLES.find((p) => p.value === Number(record.tierValue));
      if (!prize) {
        setError('系统错误：未知奖品');
        setSpinning(false);
        return;
      }

      // === 一次性减速旋转 ===
      // 1. 应用 cubic-bezier 减速曲线，从快到慢
      // 2. 旋转量 = N 圈 + 落到目标扇区中心的偏移
      const normalize = (deg: number) => ((deg % 360) + 360) % 360;
      const centerAngle = (prize.startAngle + prize.endAngle) / 2;
      const targetAngle = normalize(360 - centerAngle);

      setSpinTransition(`transform ${SPIN_DECELERATION_MS}ms cubic-bezier(0.17, 0.67, 0.16, 1)`);
      setRotation((prev) => {
        const current = normalize(prev);
        const delta = normalize(targetAngle - current);
        return prev + 360 * SPIN_EXTRA_ROUNDS + delta;
      });

      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
      spinTimeoutRef.current = setTimeout(async () => {
        spinTimeoutRef.current = null;
        setSpinning(false);

        setResult({
          name: record.tierName,
          code: record.code || '',
          directCredit: record.directCredit || false,
          value: record.tierValue,
          pointsAwarded: record.pointsAwarded,
        });
        setShowResultModal(true);

        if (user?.isAdmin) {
          setCanSpin(true);
        } else if (extraSpins > 0) {
          setExtraSpins((prev) => Math.max(0, prev - 1));
          setDailySpinRemaining((prev) => Math.max(0, prev - 1));
          setCanSpin(dailySpinRemaining > 1);
          setHasSpunToday(true);
        } else {
          setHasSpunToday(true);
          setDailySpinRemaining((prev) => Math.max(0, prev - 1));
          setCanSpin(false);
        }

        void fetchData();

        // 中奖（含积分>0）才放礼花，谢谢惠顾不放
        if (typeof record.pointsAwarded === 'number' ? record.pointsAwarded > 0 : true) {
          import('canvas-confetti').then(({ default: confetti }) => {
            const duration = 2500;
            confettiEndTimeRef.current = Date.now() + duration;
            let lastFrame = 0;
            const throttleMs = 80;
            const frame = (timestamp: number) => {
              if (timestamp - lastFrame >= throttleMs) {
                lastFrame = timestamp;
                confetti({
                  particleCount: 6,
                  angle: 60,
                  spread: 55,
                  origin: { x: 0 },
                  shapes: ['circle'],
                  colors: ['#fbbf24', '#f97316', '#ec4899', '#a78bfa', '#34d399', '#60a5fa'],
                  disableForReducedMotion: true,
                  drift: 0,
                  ticks: 150,
                });
                confetti({
                  particleCount: 6,
                  angle: 120,
                  spread: 55,
                  origin: { x: 1 },
                  shapes: ['circle'],
                  colors: ['#fbbf24', '#f97316', '#ec4899', '#a78bfa', '#34d399', '#60a5fa'],
                  disableForReducedMotion: true,
                  drift: 0,
                  ticks: 150,
                });
              }
              if (Date.now() < confettiEndTimeRef.current) {
                confettiFrameRef.current = requestAnimationFrame(frame);
              }
            };
            confettiFrameRef.current = requestAnimationFrame(frame);
          });
        }
      }, SPIN_DECELERATION_MS);
    } catch (err) {
      console.error(err);
      setError('抽奖请求失败，请稍后重试');
      setSpinning(false);
    }
  }, [canSpin, spinning, fetchData, extraSpins, user?.isAdmin, dailySpinRemaining]);

  // ---------- 复制 ----------
  const handleCopy = () => {
    if (result?.code) {
      navigator.clipboard.writeText(result.code);
      setCopied(true);
      if (modalCopyTimeoutRef.current) clearTimeout(modalCopyTimeoutRef.current);
      modalCopyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  const spinDisabled = loading || !user || !canSpin || spinning;
  const spinHintText = loading
    ? '正在同步今日抽奖资格'
    : error && !user
      ? '网络异常，请稍后刷新重试'
      : canSpin
        ? '点击按钮开始抽奖'
        : dailySpinRemaining <= 0
          ? `今日已达 ${dailySpinLimit} 次上限`
        : '今日机会已耗尽 · 请签到获取更多次数';

  // ---------- 派生 ----------
  const conicGradient = useMemo(() => {
    const stops = PRIZES_WITH_ANGLES.map((prize) => {
      const color = PRIZE_STYLES[prize.id]?.color ?? '#94a3b8';
      return `${color} ${prize.startAngle}deg ${prize.endAngle}deg`;
    }).join(', ');
    return `conic-gradient(${stops})`;
  }, []);

  // 转盘上每个奖品的"中心角度"（用于放置 emoji + 金额标签）
  const labelPositions = useMemo(
    () =>
      PRIZES_WITH_ANGLES.map((prize) => ({
        ...prize,
        centerAngle: prize.startAngle + (prize.endAngle - prize.startAngle) / 2,
      })),
    [],
  );

  // 用户胶囊文案（自定义昵称/头像优先，与个人主页保持一致）
  const username = myProfile?.displayName || user?.displayName || user?.username || '游客';
  const userAvatarUrl = myProfile?.avatarUrl ?? null;
  const userInitial = (username[0] ?? '?').toUpperCase();
  const navAchievement = myProfile?.equippedAchievement ?? null;
  const navRoleLabel = user?.isAdmin ? '管理员' : '用户';

  // 16 颗装饰小灯泡
  const lightDots = useMemo(() => {
    return Array.from({ length: 16 }, (_, i) => {
      const angle = (360 / 16) * i;
      return { angle, delay: `${i * 0.1}s` };
    });
  }, []);

  return (
    <div className="lucky-lottery">
      <div className="mesh-bg" />

      {/* 顶部导航 */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            <Sparkles strokeWidth={2.4} />
          </div>
          幸运抽奖
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className="btn-icon rules-trigger"
            onClick={() => setShowRulesModal(true)}
            aria-label="查看抽奖规则"
            title="抽奖规则"
          >
            <BookOpen />
          </button>
          <Link href="/" className="btn-icon" aria-label="返回首页" title="返回首页">
            <Home />
          </Link>
          <Link href="/profile" className="user-profile" title="个人主页">
            <div className="avatar">
              {userAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={userAvatarUrl} alt={username} className="avatar-img" />
              ) : (
                userInitial
              )}
            </div>
            <div className="user-info">
              <h4>{loading ? '正在加载...' : username}</h4>
              <p className="nav-achievement-line" title={navAchievement?.desc ?? navRoleLabel}>
                {navAchievement ? (
                  <span className="nav-achievement">
                    <span className="nav-achievement-emoji" aria-hidden>{navAchievement.emoji}</span>
                    <span className="nav-achievement-name">{navAchievement.name}</span>
                  </span>
                ) : (
                  <span className="nav-achievement empty">{navRoleLabel}</span>
                )}
              </p>
            </div>
          </Link>
        </div>
      </header>

      <main className="container">
        {/* Hero */}
        <section className="lottery-hero">
          <div className="hero-icon">
            <Sparkles strokeWidth={2.2} />
          </div>
          <h1 className="hero-title">
            每日<span className="glow">幸运抽奖</span>
          </h1>
          <p className="hero-sub">
            转盘最高一次赢取 <span className="accent">200 积分</span>，
            <span className="highlight">100% 中奖概率</span>，好运即刻降临！
          </p>
        </section>

        {/* 抽奖与数字炸弹 */}
        <section className="lottery-grid">
          {/* 中央：转盘 */}
          <div className="panel wheel-panel">
            <div className="wheel-wrap">
              {/* 指针（水滴 + 宝石） */}
              <div className="wheel-pointer" aria-hidden>
                <svg viewBox="0 0 64 86" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="ptrBody" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#fb7185" />
                      <stop offset="45%" stopColor="#e11d48" />
                      <stop offset="100%" stopColor="#9f1239" />
                    </linearGradient>
                    <linearGradient id="ptrHL" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="rgba(255,255,255,0.7)" />
                      <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                    </linearGradient>
                    <radialGradient id="ptrGem" cx="38%" cy="35%" r="65%">
                      <stop offset="0%" stopColor="#fffbeb" />
                      <stop offset="40%" stopColor="#fde047" />
                      <stop offset="100%" stopColor="#f59e0b" />
                    </radialGradient>
                    <radialGradient id="ptrGemShine" cx="30%" cy="25%" r="40%">
                      <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
                      <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                    </radialGradient>
                  </defs>
                  <path
                    d="M 32 4 C 14 4 4 16 4 30 C 4 38 8 44 13 48 L 32 80 L 51 48 C 56 44 60 38 60 30 C 60 16 50 4 32 4 Z"
                    fill="url(#ptrBody)"
                    stroke="#ffffff"
                    strokeWidth="3"
                    strokeLinejoin="round"
                  />
                  <ellipse cx="32" cy="22" rx="18" ry="12" fill="url(#ptrHL)" opacity="0.7" />
                  <circle cx="32" cy="30" r="11" fill="url(#ptrGem)" stroke="#ffffff" strokeWidth="2" />
                  <ellipse cx="29" cy="26" rx="4" ry="3" fill="url(#ptrGemShine)" />
                  <circle cx="22" cy="48" r="1.6" fill="#ffffff" opacity="0.65" />
                  <circle cx="42" cy="50" r="1.2" fill="#ffffff" opacity="0.55" />
                  <circle cx="36" cy="58" r="1" fill="#ffffff" opacity="0.45" />
                </svg>
              </div>

              {/* 装饰光环 */}
              <div className="wheel-ring" aria-hidden />

              {/* 16 颗装饰灯泡 */}
              <div className="wheel-lights" aria-hidden>
                {lightDots.map((dot, i) => (
                  <span
                    key={i}
                    className="light-dot"
                    style={{
                      transform: `rotate(${dot.angle}deg) translateX(190px)`,
                      animationDelay: dot.delay,
                    }}
                  />
                ))}
              </div>

              {/* 转盘主体 */}
              <div
                className="wheel"
                style={{
                  background: conicGradient,
                  transform: `rotate(${rotation}deg) translateZ(0)`,
                  transition: spinTransition,
                }}
              >
                {/* 扇形分隔线 */}
                {PRIZES_WITH_ANGLES.map((prize, idx) => (
                  <div
                    key={`divider-${idx}`}
                    className="wheel-divider"
                    style={{ transform: `rotate(${prize.startAngle}deg)` }}
                  />
                ))}

                {/* 扇形标签：anchor 是个 0×0 锚点，按扇区中心方向定位到颜色块几何中心；
                    inner 在 anchor 上做 translate(-50%, -50%) + 反向旋转，让图标和数字
                    永远水平居中在锚点位置上，转盘旋转过程中和停下后位置完全不变 */}
                {labelPositions.map((prize) => {
                  const style = PRIZE_STYLES[prize.id];
                  return (
                    <div
                      key={`label-${prize.id}`}
                      className="pie-label"
                      style={{
                        transform: `rotate(${prize.centerAngle}deg) translateY(calc(-1 * var(--label-radius)))`,
                      }}
                    >
                      <div
                        className="pie-label-inner"
                        style={{
                          transform: `translate(-50%, -50%) rotate(${-prize.centerAngle - rotation}deg)`,
                          transition: spinTransition,
                        }}
                      >
                        <span className="ico" aria-hidden>{style.icon}</span>
                        <span className="price">{prize.value}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 中央装饰 */}
              <div className="lucky-btn" aria-hidden>
                XiaoC
              </div>
            </div>

            {/* 抽奖次数 */}
            <div className="chance-row">
              <div className={`chance-pill daily ${hasSpunToday ? 'is-empty' : ''}`}>
                <span className="ico">
                  <Check />
                </span>
                <span className="label">每日:</span>
                <span className="num">{loading ? '—' : hasSpunToday ? '0' : '1'}</span>
              </div>
              <div className={`chance-pill extra ${extraSpins > 0 ? '' : 'is-empty'}`}>
                <span className="ico">
                  <Gift />
                </span>
                <span className="label">额外:</span>
                <span className="num">{loading ? '—' : extraSpins}</span>
              </div>
              <div className={`chance-pill quota ${dailySpinRemaining > 0 ? '' : 'is-empty'}`}>
                <span className="ico">
                  <Ticket />
                </span>
                <span className="label">今日剩余:</span>
                <span className="num">{loading ? '—' : `${dailySpinRemaining}/${dailySpinLimit}`}</span>
              </div>
            </div>

            {error && (
              <div className="lottery-error">
                <AlertCircle />
                <span>{error}</span>
              </div>
            )}

            {/* GO LUCKY 按钮 */}
            <button
              type="button"
              className={`go-btn ${spinDisabled ? 'is-disabled' : ''}`}
              onClick={handleSpin}
              disabled={spinDisabled}
            >
              {spinning ? (
                <>
                  <Loader2 className="go-spin" />
                  <span>WISHING...</span>
                </>
              ) : loading ? (
                <>
                  <Loader2 className="go-spin" />
                  <span>正在准备</span>
                </>
              ) : canSpin ? (
                <>
                  <Sparkles strokeWidth={2.4} />
                  <span>GO LUCKY</span>
                  <ChevronRight className="arrow" strokeWidth={2.6} />
                </>
              ) : (
                <span>{error && !user ? '稍后重试' : '明日再来'}</span>
              )}
            </button>

            <div className="go-tip">{spinHintText}</div>
          </div>

          {/* 数字炸弹 */}
          <div id="lottery-number-bomb" className="panel bomb-panel">
            {/* 头部 */}
            <div className="bomb-head">
              <div className="bomb-title-wrap">
                <div className="bomb-icon-box">
                  <Bomb strokeWidth={2.4} />
                </div>
                <div className="bomb-title-block">
                  <h3 className="bomb-title">数字炸弹</h3>
                  <p className="bomb-subtitle">每日 0~9 对赌，避开系统数字赢翻倍</p>
                </div>
              </div>
              <div className="bomb-meta-card">
                <span className="bomb-meta-label">本次门票</span>
                <span className="bomb-meta-value">
                  <strong>{(bombState?.baseTicketCost ?? 10) * selectedMultiplier}</strong>
                  <span className="bomb-meta-unit">积分</span>
                </span>
              </div>
            </div>

            {/* 玩法说明带 */}
            <div className="bomb-rule-bar">
              <span className="bomb-rule-chip">
                <Ticket />
                门票 10 × 倍率
              </span>
              <span className="bomb-rule-chip">
                <Sparkles />
                未命中赢门票 ×2
              </span>
              <span className="bomb-rule-chip">
                <Flame />
                每日 00:00 开奖
              </span>
            </div>

            {/* 数字盘：扑克牌式 */}
            <div className="bomb-section">
              <div className="bomb-section-head">
                <span className="bomb-section-label">第一步 · 选一个数字</span>
                {selectedNumber !== null ? (
                  <span className="bomb-pick-tag">已选 <strong>{selectedNumber}</strong></span>
                ) : (
                  <span className="bomb-pick-tag empty">未选</span>
                )}
              </div>
              <div className="bomb-cards" role="radiogroup" aria-label="选择数字">
                {Array.from({ length: 10 }).map((_, n) => {
                  const isActive = selectedNumber === n;
                  const lockedNumber = bombState?.todayBet?.selectedNumber === n;
                  const isLockedPending =
                    bombState?.todayBet?.status === 'pending' && lockedNumber;
                  const isLockedSettled =
                    bombState?.todayBet?.status === 'won' ||
                    bombState?.todayBet?.status === 'lost' ||
                    bombState?.todayBet?.status === 'cancelled';
                  const disabled = bombLoading || bombSubmitting || isLockedSettled;
                  return (
                    <button
                      type="button"
                      key={n}
                      role="radio"
                      aria-checked={isActive}
                      className={`bomb-card ${isActive ? 'is-active' : ''} ${isLockedPending ? 'is-locked' : ''}`}
                      onClick={() => setSelectedNumber(n)}
                      disabled={disabled}
                    >
                      <span className="bomb-card-corner top">{n}</span>
                      <span className="bomb-card-number">{n}</span>
                      <span className="bomb-card-corner bottom">{n}</span>
                      <span className="bomb-card-suit" aria-hidden>♠</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 倍率：渐变赔率卡 */}
            <div className="bomb-section">
              <div className="bomb-section-head">
                <span className="bomb-section-label">第二步 · 选倍率</span>
                <span className="bomb-pick-tag">
                  当前 <strong>{NUMBER_BOMB_MULTIPLIER_LABELS[selectedMultiplier]}</strong>
                </span>
              </div>
              <div className="bomb-mul-grid" role="radiogroup" aria-label="选择倍率">
                {([1, 2, 5, 10] as NumberBombMultiplier[]).map((m) => {
                  const isActive = selectedMultiplier === m;
                  const ticketCost = (bombState?.baseTicketCost ?? 10) * m;
                  const winReward = ticketCost * 2;
                  const disabled =
                    bombLoading ||
                    bombSubmitting ||
                    bombState?.todayBet?.status === 'won' ||
                    bombState?.todayBet?.status === 'lost' ||
                    bombState?.todayBet?.status === 'cancelled';
                  return (
                    <button
                      type="button"
                      key={m}
                      role="radio"
                      aria-checked={isActive}
                      className={`bomb-mul-card mul-${m} ${isActive ? 'is-active' : ''}`}
                      onClick={() => setSelectedMultiplier(m)}
                      disabled={disabled}
                    >
                      <span className="bomb-mul-tag">{NUMBER_BOMB_MULTIPLIER_LABELS[m]}</span>
                      <span className="bomb-mul-cost">
                        门票 <strong>{ticketCost}</strong>
                      </span>
                      <span className="bomb-mul-prize">
                        赢 <strong>{winReward}</strong> 积分
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 状态卡 */}
            <div className="bomb-status-grid">
              <div className="bomb-status-card today">
                <span className="status-label">今日状态</span>
                {bombLoading ? (
                  <div className="status-body loading">
                    <Loader2 className="bomb-spin" />
                    <span>正在加载</span>
                  </div>
                ) : bombState?.todayBet?.status === 'pending' ? (
                  <div className="status-body pending">
                    <Ticket />
                    <div>
                      <div className="status-title">已下注 {bombState.todayBet.selectedNumber}</div>
                      <div className="status-meta">
                        {NUMBER_BOMB_MULTIPLIER_LABELS[bombState.todayBet.multiplier]} · 门票{' '}
                        <strong>{bombState.todayBet.ticketCost}</strong> 积分
                      </div>
                    </div>
                  </div>
                ) : bombState?.todayBet?.status === 'cancelled' ? (
                  <div className="status-body cancelled">
                    <RotateCcw />
                    <div>
                      <div className="status-title">今日已取消</div>
                      <div className="status-meta">门票已退还，明日再来</div>
                    </div>
                  </div>
                ) : bombState?.todayBet ? (
                  <div className="status-body settled">
                    <Flame />
                    <div>
                      <div className="status-title">今日投注已结算</div>
                      <div className="status-meta">查看个人主页积分流水</div>
                    </div>
                  </div>
                ) : (
                  <div className="status-body idle">
                    <Sparkles />
                    <div>
                      <div className="status-title">未下注</div>
                      <div className="status-meta">选数字 + 倍率即可参与</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="bomb-status-card yesterday">
                <span className="status-label">昨日开奖</span>
                {bombState?.yesterdayBet ? (
                  <div className={`status-body ${bombState.yesterdayBet.status === 'won' ? 'won' : 'lost'}`}>
                    <div className="bomb-system-bubble">
                      {bombState.yesterdayBet.systemNumber ?? bombState.yesterdaySystemNumber ?? '?'}
                    </div>
                    <div>
                      <div className="status-title">
                        {bombState.yesterdayBet.status === 'won'
                          ? `赢得 ${bombState.yesterdayBet.rewardPoints ?? 0} 积分`
                          : bombState.yesterdayBet.status === 'lost'
                            ? '未命中安全数字'
                            : bombState.yesterdayBet.status === 'cancelled'
                              ? '已取消'
                              : '待结算'}
                      </div>
                      <div className="status-meta">
                        你选 {bombState.yesterdayBet.selectedNumber} · 系统{' '}
                        {bombState.yesterdayBet.systemNumber ?? bombState.yesterdaySystemNumber ?? '-'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="status-body idle">
                    <div className="bomb-system-bubble idle">
                      {bombState?.yesterdaySystemNumber ?? '?'}
                    </div>
                    <div>
                      <div className="status-title">昨日未参与</div>
                      <div className="status-meta">
                        {bombState?.yesterdaySystemNumber !== null && bombState?.yesterdaySystemNumber !== undefined
                          ? `系统数字 ${bombState.yesterdaySystemNumber}`
                          : '等待开奖数字公布'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 提示 */}
            {bombMessage ? (
              <div className={`bomb-message ${bombMessage.type}`}>
                {bombMessage.type === 'success' ? <Check /> : <AlertCircle />}
                <span>{bombMessage.text}</span>
              </div>
            ) : null}

            {/* 操作按钮 */}
            <div className="bomb-actions">
              <button
                type="button"
                className="bomb-btn primary"
                onClick={handleNumberBombBet}
                disabled={
                  bombLoading ||
                  bombSubmitting ||
                  selectedNumber === null ||
                  bombState?.todayBet?.status === 'won' ||
                  bombState?.todayBet?.status === 'lost' ||
                  bombState?.todayBet?.status === 'cancelled'
                }
              >
                {bombSubmitting ? <Loader2 className="bomb-spin" /> : <Bomb />}
                <span>
                  {bombState?.todayBet?.status === 'pending' ? '修改投注' : '点燃炸弹'}
                </span>
                <ChevronRight className="arrow" strokeWidth={2.6} />
              </button>
              {bombState?.todayBet?.status === 'pending' ? (
                <button
                  type="button"
                  className="bomb-btn ghost"
                  onClick={handleNumberBombCancel}
                  disabled={bombSubmitting}
                >
                  <RotateCcw />
                  <span>取消并退款</span>
                </button>
              ) : null}
            </div>
          </div>
        </section>
      </main>

      {/* 中奖弹窗 */}
      {showResultModal && result && (
        <div className="modal-mask show" role="dialog" aria-modal="true" aria-label="中奖结果">
          <div className="modal-backdrop" onClick={() => setShowResultModal(false)} />
          <div className="modal-card">
            <button
              type="button"
              className="modal-close"
              onClick={() => setShowResultModal(false)}
              aria-label="关闭"
            >
              <X />
            </button>

            {(() => {
              const isPointsResult = typeof result.pointsAwarded === 'number';
              const isLuckyMiss = isPointsResult && result.pointsAwarded === 0;

              if (isPointsResult) {
                if (isLuckyMiss) {
                  return (
                    <>
                      <div className="modal-emoji" aria-hidden>❤️</div>
                      <div className="modal-title">谢谢惠顾</div>
                      <div className="modal-prize miss">差一点点</div>
                      <div className="modal-desc">运气差一点就到您身上了，再来一次试试？</div>
                      <div className="modal-credit modal-credit-miss">
                        <span className="money-bag" aria-hidden>🌹</span>
                        <div>
                          <div className="modal-credit-label">本次结果</div>
                          <div className="modal-credit-value miss">未中奖</div>
                        </div>
                      </div>
                    </>
                  );
                }
                return (
                  <>
                    <div className="modal-emoji" aria-hidden>🎉</div>
                    <div className="modal-title">恭喜中奖！</div>
                    <div className="modal-prize">{result.name}</div>
                    <div className="modal-desc">幸运降临，积分已直接发放到您的账户</div>
                    <div className="modal-credit">
                      <span className="money-bag" aria-hidden>✨</span>
                      <div>
                        <div className="modal-credit-label">到账积分</div>
                        <div className="modal-credit-value">+{result.pointsAwarded}</div>
                      </div>
                    </div>
                  </>
                );
              }

              // 旧记录兼容（兑换码 / 直充模式）
              return (
                <>
                  <div className="modal-emoji" aria-hidden>🎉</div>
                  <div className="modal-title">恭喜中奖！</div>
                  <div className="modal-prize">{result.name}</div>
                  <div className="modal-desc">
                    {result.directCredit
                      ? '幸运降临，奖励已直接充值到您的账户'
                      : '幸运降临，请保存好您的专属兑换码'}
                  </div>
                  {result.directCredit ? (
                    <div className="modal-credit">
                      <span className="money-bag" aria-hidden>💰</span>
                      <div>
                        <div className="modal-credit-label">充值金额</div>
                        <div className="modal-credit-value">${result.value}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="modal-code-row">
                      <code className="modal-code">{result.code}</code>
                      <button
                        type="button"
                        className={`modal-copy ${copied ? 'copied' : ''}`}
                        onClick={handleCopy}
                        aria-label="复制"
                      >
                        {copied ? <Check /> : <Copy />}
                      </button>
                    </div>
                  )}
                </>
              );
            })()}

            <button type="button" className="modal-btn" onClick={() => setShowResultModal(false)}>
              <Check />
              {result.pointsAwarded === 0 ? '我知道了' : '收入囊中'}
            </button>
          </div>
        </div>
      )}

      {/* 规则弹窗 */}
      {showRulesModal && (
        <div className="modal-mask show" role="dialog" aria-modal="true" aria-labelledby="lottery-rules-title">
          <div className="modal-backdrop" onClick={() => setShowRulesModal(false)} />
          <div className="modal-card modal-card-rules">
            <button
              type="button"
              className="modal-close"
              onClick={() => setShowRulesModal(false)}
              aria-label="关闭抽奖规则"
            >
              <X />
            </button>

            <div className="modal-rules-header">
              <div className="modal-rules-icon">
                <BookOpen />
              </div>
              <div>
                <p className="modal-rules-kicker">LUCKY RULE BOOK</p>
                <h2 id="lottery-rules-title" className="modal-rules-title">幸运抽奖规则</h2>
              </div>
            </div>

            <div className="modal-rules-summary" aria-label="规则摘要">
              <span>每日免费</span>
              <span>积分直达</span>
              <span>数字对赌</span>
              <span>次日结算</span>
            </div>

            <div className="modal-rules-body">
              <section className="modal-rule-section">
                <div className="modal-rule-section-head">
                  <span className="modal-rule-section-icon">
                    <Sparkles />
                  </span>
                  <div>
                    <h3>幸运转盘</h3>
                    <p>每日抽奖、额外次数与中奖发放说明</p>
                  </div>
                </div>
                <ul className="modal-rules-list">
                  <li>
                    <span className="rule-num">01</span>
                    <div>
                      <h4>抽奖次数</h4>
                      <p>每位用户每天可获得 <strong>1 次免费抽奖</strong>；签到、福利或活动赠送的额外次数会优先显示在次数区。</p>
                    </div>
                  </li>
                  <li>
                    <span className="rule-num">02</span>
                    <div>
                      <h4>奖品构成</h4>
                      <p>转盘包含 200、150、100、50、30、10 积分与谢谢惠顾等奖项；实际中奖由服务端抽取，页面转盘负责展示结果。</p>
                    </div>
                  </li>
                  <li>
                    <span className="rule-num">03</span>
                    <div>
                      <h4>到账方式</h4>
                      <p>中奖积分会自动发放到账户余额；谢谢惠顾不增加积分，也不会消耗额外补偿次数。</p>
                    </div>
                  </li>
                  <li>
                    <span className="rule-num">04</span>
                    <div>
                      <h4>排行榜口径</h4>
                      <p>抽奖榜按抽奖获得的积分统计，周期榜单可能存在短时间缓存，最终以服务端记录为准。</p>
                    </div>
                  </li>
                </ul>
              </section>

              <section className="modal-rule-section bomb">
                <div className="modal-rule-section-head">
                  <span className="modal-rule-section-icon">
                    <Bomb />
                  </span>
                  <div>
                    <h3>数字炸弹</h3>
                    <p>选择数字和倍率，避开系统炸弹数字</p>
                  </div>
                </div>
                <ul className="modal-rules-list">
                  <li>
                    <span className="rule-num">01</span>
                    <div>
                      <h4>参与方式</h4>
                      <p>每天可在 <strong>0-9</strong> 中选择一个数字，并选择 1、2、5、10 倍倍率；门票消耗为基础门票乘以倍率。</p>
                    </div>
                  </li>
                  <li>
                    <span className="rule-num">02</span>
                    <div>
                      <h4>胜负判定</h4>
                      <p>系统每天生成一个炸弹数字；今天下注对应的数字会在明日 <strong>00:00</strong> 公布。你选择的数字 <strong>不等于</strong> 系统数字即获胜，等于系统数字则本次未中奖。</p>
                    </div>
                  </li>
                  <li>
                    <span className="rule-num">03</span>
                    <div>
                      <h4>奖励计算</h4>
                      <p>获胜奖励为本次门票的 <strong>2 倍</strong>；例如 10 倍投注消耗 100 积分，命中安全数字可获得 200 积分。</p>
                    </div>
                  </li>
                  <li>
                    <span className="rule-num">04</span>
                    <div>
                      <h4>修改与取消</h4>
                      <p>当日结果结算前可以修改投注；取消后会退还门票。已结算、已中奖或已失败的投注不可再修改。</p>
                    </div>
                  </li>
                </ul>
              </section>
            </div>

            <button type="button" className="modal-btn" onClick={() => setShowRulesModal(false)}>
              <Check />
              我知道了
            </button>
          </div>
        </div>
      )}

      <style jsx global>{`
        .lucky-lottery {
          --text-main: #0f172a;
          --text-light: #64748b;
          --card-bg: rgba(255, 255, 255, 0.7);
          --card-border: rgba(255, 255, 255, 1);
          --card-shadow: 0 24px 48px rgba(15, 23, 42, 0.06);

          --c-green: #10b981;
          --c-purple: #8b5cf6;
          --c-orange: #e11d48;
          --c-red: #f43f5e;
          --c-blue: #3b82f6;
          --c-pink: #ec4899;
          --c-amber: #fbbf24;
          --c-yellow: #facc15;

          --grad-primary: linear-gradient(135deg, #fb7185, #e11d48);
          --grad-gold: linear-gradient(135deg, #fde047, #f59e0b 50%, #ea580c);
          --grad-orange: linear-gradient(135deg, #fda4af, #fb7185);
          --grad-pink: linear-gradient(135deg, #fb7185, #ec4899);
          --grad-amber: linear-gradient(135deg, #fde047, #fbbf24);
          --grad-green: linear-gradient(135deg, #34d399, #10b981);

          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
          background-color: #f8fafc;
          color: var(--text-main);
          min-height: 100vh;
          position: relative;
          isolation: isolate;
          -webkit-font-smoothing: antialiased;
          -webkit-tap-highlight-color: transparent;
        }
        .lucky-lottery * { box-sizing: border-box; }
        .lucky-lottery a { color: inherit; text-decoration: none; }
        .lucky-lottery button { font-family: inherit; }

        .lucky-lottery .mesh-bg {
          position: fixed;
          inset: 0;
          z-index: -2;
          background-image:
            radial-gradient(circle at 15% 50%, rgba(255, 228, 230, 0.85) 0%, transparent 50%),
            radial-gradient(circle at 85% 30%, rgba(254, 226, 226, 0.85) 0%, transparent 50%),
            radial-gradient(circle at 50% 90%, rgba(252, 231, 243, 0.85) 0%, transparent 50%),
            radial-gradient(circle at 50% 10%, rgba(254, 205, 211, 0.85) 0%, transparent 50%);
          filter: blur(60px);
          animation: lkFluid 15s infinite alternate ease-in-out;
        }
        @keyframes lkFluid {
          0% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.05) rotate(2deg); }
          100% { transform: scale(1.1) rotate(-2deg); }
        }

        /* topbar */
        .lucky-lottery .topbar {
          position: sticky;
          top: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
          padding: 16px 48px;
          background: rgba(248, 250, 252, 0.65);
          backdrop-filter: blur(24px) saturate(1.6);
          -webkit-backdrop-filter: blur(24px) saturate(1.6);
          border-bottom: 1px solid rgba(255, 255, 255, 0.8);
          padding-top: max(16px, env(safe-area-inset-top));
        }
        .lucky-lottery .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: var(--text-main);
          flex-shrink: 0;
        }
        .lucky-lottery .brand-icon {
          width: 36px;
          height: 36px;
          background: var(--grad-primary);
          border-radius: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          box-shadow: 0 8px 16px rgba(225, 29, 72, 0.3);
          position: relative;
        }
        .lucky-lottery .brand-icon svg { width: 22px; height: 22px; }
        .lucky-lottery .brand-icon::after {
          content: '';
          position: absolute;
          inset: -3px;
          border-radius: 15px;
          background: var(--grad-primary);
          opacity: 0.3;
          filter: blur(8px);
          z-index: -1;
        }

        .lucky-lottery .topbar-right {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
          justify-content: flex-end;
        }

        .lucky-lottery .btn-icon {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.9);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--text-light);
          backdrop-filter: blur(10px);
          transition: all 0.2s;
          flex-shrink: 0;
        }
        .lucky-lottery .btn-icon svg { width: 16px; height: 16px; }
        .lucky-lottery .btn-icon:hover {
          background: #fff;
          color: var(--c-orange);
          transform: translateY(-2px);
          box-shadow: 0 8px 16px rgba(0, 0, 0, 0.05);
        }

        .lucky-lottery .rules-trigger {
          color: #be123c;
          background:
            linear-gradient(#fff, #fff) padding-box,
            linear-gradient(135deg, rgba(251, 113, 133, 0.45), rgba(251, 191, 36, 0.5)) border-box;
          border: 1px solid transparent;
        }
        .lucky-lottery .rules-trigger:hover {
          color: #9f1239;
          box-shadow: 0 14px 26px rgba(225, 29, 72, 0.14);
        }

        .lucky-lottery .user-profile {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          padding: 5px 16px 5px 5px;
          background: #fff;
          border-radius: 999px;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.04);
          cursor: pointer;
          transition: transform 0.2s;
        }
        .lucky-lottery .user-profile:hover { transform: scale(1.02); }
        .lucky-lottery .user-profile .avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #475569;
          font-weight: 800;
          font-size: 14px;
          flex-shrink: 0;
          overflow: hidden;
          text-transform: uppercase;
        }
        .lucky-lottery .user-profile .avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: inherit;
          display: block;
        }
        .lucky-lottery .user-info h4 {
          font-size: 13px;
          font-weight: 700;
          line-height: 1.2;
          margin: 0;
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .lucky-lottery .user-info p {
          font-size: 11px;
          color: var(--text-light);
          margin: 1px 0 0;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          max-width: 150px;
        }
        .lucky-lottery .user-info .nav-achievement-line {
          width: 100%;
          min-width: 0;
        }
        .lucky-lottery .nav-achievement {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
          color: #9f1239;
          font-weight: 800;
        }
        .lucky-lottery .nav-achievement.empty {
          color: var(--text-light);
          font-weight: 700;
        }
        .lucky-lottery .nav-achievement-emoji {
          flex: 0 0 auto;
          font-size: 11px;
          line-height: 1;
        }
        .lucky-lottery .nav-achievement-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* container */
        .lucky-lottery .container {
          max-width: 1500px;
          margin: 0 auto;
          padding: 28px 48px 96px;
          display: flex;
          flex-direction: column;
          gap: 26px;
        }

        /* Hero */
        .lucky-lottery .lottery-hero {
          text-align: center;
          position: relative;
          padding: 16px 0 0;
        }
        .lucky-lottery .hero-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 76px;
          height: 76px;
          border-radius: 24px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(254, 226, 226, 0.7));
          border: 1px solid rgba(255, 255, 255, 1);
          color: var(--c-orange);
          box-shadow: 0 16px 32px rgba(225, 29, 72, 0.2), inset 0 1px 0 rgba(255, 255, 255, 1);
          margin-bottom: 18px;
          position: relative;
          animation: lkFloat 4s ease-in-out infinite;
        }
        .lucky-lottery .hero-icon svg { width: 36px; height: 36px; }
        .lucky-lottery .hero-icon::before {
          content: '';
          position: absolute;
          inset: -8px;
          border-radius: 30px;
          background: var(--grad-orange);
          opacity: 0.18;
          filter: blur(20px);
          z-index: -1;
          animation: lkGlowPulse 3s ease-in-out infinite;
        }
        @keyframes lkFloat {
          0%, 100% { transform: translateY(0) rotate(-3deg); }
          50% { transform: translateY(-6px) rotate(3deg); }
        }
        @keyframes lkGlowPulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.15); opacity: 1; }
        }
        .lucky-lottery .hero-title {
          font-size: 56px;
          font-weight: 900;
          letter-spacing: -2px;
          line-height: 1;
          color: var(--text-main);
          margin: 0 0 18px;
        }
        .lucky-lottery .hero-title .glow {
          background: linear-gradient(135deg, #fb7185, #e11d48 50%, #be123c);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          text-shadow: 0 0 60px rgba(225, 29, 72, 0.3);
        }
        .lucky-lottery .hero-sub {
          font-size: 16px;
          color: var(--text-light);
          font-weight: 500;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: center;
          margin: 0;
        }
        .lucky-lottery .hero-sub .accent {
          color: var(--c-red);
          font-weight: 800;
          font-size: 18px;
        }
        .lucky-lottery .hero-sub .highlight {
          color: var(--c-orange);
          font-weight: 800;
        }

        /* 主内容区：转盘 + 数字炸弹 上下流式单列 */
        .lucky-lottery .lottery-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 28px;
          align-items: stretch;
          max-width: 920px;
          margin: 0 auto;
          width: 100%;
        }

        /* 通用面板 */
        .lucky-lottery .panel {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.55));
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 28px;
          padding: 24px;
          box-shadow: var(--card-shadow), inset 0 1px 0 rgba(255, 255, 255, 1);
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .lucky-lottery .panel-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 18px;
          position: relative;
          z-index: 1;
          gap: 12px;
        }
        .lucky-lottery .panel-title {
          font-size: 18px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 10px;
          letter-spacing: -0.3px;
          margin: 0;
        }
        .lucky-lottery .panel-title .icon-box {
          width: 36px;
          height: 36px;
          border-radius: 11px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          position: relative;
        }
        .lucky-lottery .panel-title .icon-box svg { width: 18px; height: 18px; }
        .lucky-lottery .panel-title .icon-box::after {
          content: '';
          position: absolute;
          inset: -3px;
          border-radius: 14px;
          opacity: 0.3;
          filter: blur(8px);
          z-index: -1;
        }
        .lucky-lottery .panel-title.t-amber .icon-box {
          background: var(--grad-amber);
          color: #92400e;
          box-shadow: 0 8px 16px rgba(251, 191, 36, 0.35);
        }
        .lucky-lottery .panel-title.t-amber .icon-box::after { background: var(--c-amber); }
        .lucky-lottery .panel-title.t-orange .icon-box {
          background: var(--grad-orange);
          box-shadow: 0 8px 16px rgba(225, 29, 72, 0.3);
        }
        .lucky-lottery .panel-title.t-orange .icon-box::after { background: var(--c-orange); }

        .lucky-lottery .live-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 11px;
          background: rgba(16, 185, 129, 0.12);
          color: var(--c-green);
          border: 1px solid rgba(16, 185, 129, 0.25);
          border-radius: 999px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.5px;
        }
        .lucky-lottery .live-badge .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--c-green);
          position: relative;
        }
        .lucky-lottery .live-badge .dot::after {
          content: '';
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          background: var(--c-green);
          opacity: 0.5;
          animation: lkPulseDot 1.5s ease-in-out infinite;
        }
        @keyframes lkPulseDot {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.8); opacity: 0; }
        }

        /* 排行 */
        .lucky-lottery .ranking-panel { min-height: 460px; }
        .lucky-lottery .ranking-panel::before {
          content: '';
          position: absolute;
          top: -30%;
          right: -30%;
          width: 280px;
          height: 280px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(251, 191, 36, 0.25), transparent 60%);
          filter: blur(40px);
          pointer-events: none;
        }
        .lucky-lottery .ranking-empty {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 14px;
          padding: 30px 20px;
          background: linear-gradient(180deg, rgba(248, 250, 252, 0.6), rgba(254, 226, 226, 0.3));
          border: 1.5px dashed rgba(15, 23, 42, 0.12);
          border-radius: 22px;
          position: relative;
          z-index: 1;
        }
        .lucky-lottery .ranking-loading {
          width: 32px;
          height: 32px;
          color: var(--c-orange);
          animation: lkSpin 1s linear infinite;
        }
        @keyframes lkSpin {
          from { transform: rotate(0); }
          to { transform: rotate(360deg); }
        }
        .lucky-lottery .empty-trophy {
          width: 80px;
          height: 80px;
          border-radius: 24px;
          background: rgba(15, 23, 42, 0.05);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: rgba(15, 23, 42, 0.3);
          position: relative;
        }
        .lucky-lottery .empty-trophy svg { width: 44px; height: 44px; }
        .lucky-lottery .empty-trophy::after {
          content: '✨';
          position: absolute;
          top: -6px;
          right: -2px;
          font-size: 18px;
          opacity: 0.5;
        }
        .lucky-lottery .empty-text {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-light);
          letter-spacing: 0.3px;
        }
        .lucky-lottery .empty-sub {
          font-size: 12px;
          color: var(--text-light);
          opacity: 0.65;
          text-align: center;
          line-height: 1.6;
        }

        .lucky-lottery .rank-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          position: relative;
          z-index: 1;
        }
        .lucky-lottery .rank-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.65);
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 16px;
          transition: all 0.2s;
        }
        .lucky-lottery .rank-row:hover {
          background: #fff;
          transform: translateX(3px);
          box-shadow: 0 8px 16px rgba(15, 23, 42, 0.04);
        }
        .lucky-lottery .rank-row.r1 {
          background: linear-gradient(90deg, rgba(251, 191, 36, 0.14), rgba(255, 255, 255, 0.65));
          border-color: rgba(251, 191, 36, 0.3);
        }
        .lucky-lottery .rank-row.r2 {
          background: linear-gradient(90deg, rgba(148, 163, 184, 0.14), rgba(255, 255, 255, 0.65));
          border-color: rgba(148, 163, 184, 0.3);
        }
        .lucky-lottery .rank-row.r3 {
          background: linear-gradient(90deg, rgba(251, 146, 60, 0.14), rgba(255, 255, 255, 0.65));
          border-color: rgba(251, 146, 60, 0.3);
        }
        .lucky-lottery .rank-num {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          font-size: 13px;
          background: rgba(15, 23, 42, 0.05);
          color: var(--text-light);
          flex-shrink: 0;
          border: 2px solid #fff;
        }
        .lucky-lottery .rank-row.r1 .rank-num { background: var(--grad-gold); color: #fff; }
        .lucky-lottery .rank-row.r2 .rank-num {
          background: linear-gradient(135deg, #f1f5f9, #cbd5e1);
          color: #1e293b;
        }
        .lucky-lottery .rank-row.r3 .rank-num {
          background: linear-gradient(135deg, #fed7aa, #fb923c);
          color: #fff;
        }
        .lucky-lottery .rank-info { flex: 1; min-width: 0; }
        .lucky-lottery .rank-name {
          font-size: 13.5px;
          font-weight: 800;
          color: var(--text-main);
          display: inline-flex;
          align-items: center;
          gap: 5px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          letter-spacing: -0.2px;
        }
        .lucky-lottery .rank-star {
          width: 13px;
          height: 13px;
          color: var(--c-amber);
          fill: var(--c-amber);
        }
        .lucky-lottery .rank-meta {
          font-size: 11.5px;
          color: var(--text-light);
          margin-top: 2px;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .lucky-lottery .rank-meta svg { width: 11px; height: 11px; }
        .lucky-lottery .rank-value {
          font-size: 14px;
          font-weight: 900;
          color: var(--c-orange);
          letter-spacing: -0.3px;
          flex-shrink: 0;
        }
        .lucky-lottery .rank-row.r1 .rank-value { color: #b45309; }
        .lucky-lottery .rank-row.r2 .rank-value { color: #475569; }
        .lucky-lottery .rank-row.r3 .rank-value { color: #c2410c; }

        /* 转盘 */
        .lucky-lottery .wheel-panel {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(255, 241, 242, 0.65));
          padding: 32px 30px 36px;
          align-items: center;
          justify-content: flex-start;
        }
        .lucky-lottery .wheel-panel::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            radial-gradient(circle at 50% 30%, rgba(251, 191, 36, 0.12), transparent 60%),
            radial-gradient(circle at 50% 90%, rgba(225, 29, 72, 0.1), transparent 60%);
          pointer-events: none;
        }
        .lucky-lottery .wheel-panel::after {
          content: '';
          position: absolute;
          top: 18%;
          left: 50%;
          transform: translateX(-50%);
          width: 480px;
          height: 480px;
          background: radial-gradient(circle, rgba(251, 191, 36, 0.15), transparent 60%);
          filter: blur(40px);
          pointer-events: none;
          animation: lkWheelGlow 4s ease-in-out infinite;
        }
        @keyframes lkWheelGlow {
          0%, 100% { opacity: 0.5; transform: translateX(-50%) scale(1); }
          50% { opacity: 1; transform: translateX(-50%) scale(1.1); }
        }

        .lucky-lottery .wheel-wrap {
          position: relative;
          width: 380px;
          max-width: 100%;
          aspect-ratio: 1;
          margin: 8px 0 28px;
          z-index: 1;
        }

        .lucky-lottery .wheel-pointer {
          position: absolute;
          top: -28px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 5;
          width: 64px;
          height: 86px;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          filter: drop-shadow(0 8px 16px rgba(244, 63, 94, 0.45)) drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15));
          animation: lkPointerBob 3s ease-in-out infinite;
        }
        @keyframes lkPointerBob {
          0%, 100% { transform: translateX(-50%) translateY(0); }
          50% { transform: translateX(-50%) translateY(-3px); }
        }
        .lucky-lottery .wheel-pointer svg { width: 100%; height: 100%; }

        .lucky-lottery .wheel-ring {
          position: absolute;
          inset: -14px;
          border-radius: 50%;
          background: conic-gradient(from 0deg, #fb7185, #e11d48, #f43f5e, #ec4899, #fda4af, #fb7185);
          padding: 6px;
          z-index: 0;
          animation: lkRingRotate 12s linear infinite;
        }
        .lucky-lottery .wheel-ring::before {
          content: '';
          position: absolute;
          inset: 6px;
          border-radius: 50%;
          background: #fff;
        }
        @keyframes lkRingRotate {
          to { transform: rotate(360deg); }
        }

        .lucky-lottery .wheel-lights {
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          z-index: 1;
          pointer-events: none;
        }
        .lucky-lottery .light-dot {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 10px;
          height: 10px;
          background: var(--grad-amber);
          border-radius: 50%;
          box-shadow: 0 0 8px #fbbf24;
          transform-origin: 0 0;
          animation: lkBlink 1.5s ease-in-out infinite;
        }
        @keyframes lkBlink {
          0%, 100% { opacity: 0.3; box-shadow: 0 0 4px #fbbf24; }
          50% { opacity: 1; box-shadow: 0 0 12px #fbbf24, 0 0 18px #fbbf24; }
        }

        .lucky-lottery .wheel {
          position: relative;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          box-shadow:
            0 24px 48px rgba(15, 23, 42, 0.18),
            inset 0 0 0 6px rgba(255, 255, 255, 0.8),
            inset 0 0 0 8px rgba(15, 23, 42, 0.04);
          z-index: 2;
          will-change: transform;
        }

        .lucky-lottery .wheel-divider {
          position: absolute;
          top: 0;
          left: 50%;
          width: 2px;
          height: 50%;
          margin-left: -1px;
          background: rgba(255, 255, 255, 0.85);
          transform-origin: 50% 100%;
          z-index: 3;
          box-shadow: 0 0 4px rgba(0, 0, 0, 0.08);
          pointer-events: none;
        }

        .lucky-lottery .pie-label {
          /* anchor 是 0×0 锚点，自身只承担"从圆心沿 centerAngle 平移 label-radius 的距离"
             这一定位职责；inner 通过 translate(-50%, -50%) 真正居中到这个锚点上 */
          position: absolute;
          top: 50%;
          left: 50%;
          width: 0;
          height: 0;
          transform-origin: center center;
          z-index: 3;
          pointer-events: none;
          /* 半径默认值，响应式断点会覆盖此值 */
          --label-radius: 130px;
        }
        /* 内层 inner 自旋抵消转盘整体旋转 + 扇形 centerAngle，
           让图标和数字始终正向朝上；transition 与 wheel 同步 */
        .lucky-lottery .pie-label-inner {
          position: absolute;
          top: 0;
          left: 0;
          font-weight: 900;
          color: #fff;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
          transform-origin: center center;
        }
        .lucky-lottery .pie-label .price {
          font-size: 22px;
          letter-spacing: -0.5px;
        }
        .lucky-lottery .pie-label .ico { font-size: 22px; }

        .lucky-lottery .lucky-btn {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 88px;
          height: 88px;
          border-radius: 50%;
          background: var(--grad-primary);
          border: 6px solid #fff;
          color: #fff;
          font-weight: 900;
          font-size: 17px;
          letter-spacing: 0.3px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow:
            0 12px 24px rgba(225, 29, 72, 0.45),
            inset 0 -4px 8px rgba(0, 0, 0, 0.2),
            inset 0 4px 8px rgba(255, 255, 255, 0.3);
          z-index: 5;
          pointer-events: none;
          user-select: none;
        }
        .lucky-lottery .lucky-btn::before {
          content: '';
          position: absolute;
          inset: -10px;
          border-radius: 50%;
          background: var(--grad-primary);
          opacity: 0.4;
          filter: blur(12px);
          z-index: -1;
          animation: lkLuckyPulse 2s ease-in-out infinite;
        }
        @keyframes lkLuckyPulse {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(1.2); opacity: 0.7; }
        }

        .lucky-lottery .chance-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 14px;
          margin-bottom: 18px;
          flex-wrap: wrap;
          position: relative;
          z-index: 1;
        }
        .lucky-lottery .chance-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 9px 18px;
          background: rgba(255, 255, 255, 0.85);
          border: 1px solid rgba(255, 255, 255, 1);
          border-radius: 999px;
          font-size: 13px;
          font-weight: 700;
          color: var(--text-main);
          backdrop-filter: blur(10px);
          transition: all 0.2s;
        }
        .lucky-lottery .chance-pill .label {
          color: var(--text-light);
          font-weight: 700;
        }
        .lucky-lottery .chance-pill .num {
          font-weight: 900;
          font-size: 16px;
        }
        .lucky-lottery .chance-pill.daily .num { color: var(--c-green); }
        .lucky-lottery .chance-pill.daily.is-empty .num { color: var(--text-light); }
        .lucky-lottery .chance-pill.extra .num { color: var(--c-orange); }
        .lucky-lottery .chance-pill.extra.is-empty .num { color: var(--text-light); }
        .lucky-lottery .chance-pill .ico {
          width: 22px;
          height: 22px;
          border-radius: 7px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #fff;
        }
        .lucky-lottery .chance-pill .ico svg { width: 12px; height: 12px; }
        .lucky-lottery .chance-pill.daily .ico { background: var(--grad-green); }
        .lucky-lottery .chance-pill.extra .ico { background: var(--grad-orange); }
        .lucky-lottery .chance-pill.daily.is-empty .ico,
        .lucky-lottery .chance-pill.extra.is-empty .ico {
          background: rgba(15, 23, 42, 0.1);
          color: rgba(15, 23, 42, 0.4);
        }

        .lucky-lottery .lottery-error {
          width: 100%;
          max-width: 380px;
          margin: 0 auto 14px;
          padding: 10px 14px;
          background: rgba(244, 63, 94, 0.08);
          border: 1px solid rgba(244, 63, 94, 0.25);
          border-radius: 14px;
          color: var(--c-red);
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 600;
          position: relative;
          z-index: 1;
        }
        .lucky-lottery .lottery-error svg { width: 16px; height: 16px; flex-shrink: 0; }

        .lucky-lottery .go-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          width: 100%;
          max-width: 380px;
          padding: 18px 32px;
          background: var(--grad-primary);
          color: #fff;
          border: none;
          border-radius: 22px;
          font-family: inherit;
          font-size: 22px;
          font-weight: 900;
          letter-spacing: 1.5px;
          cursor: pointer;
          position: relative;
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          box-shadow: 0 16px 32px rgba(225, 29, 72, 0.4),
            inset 0 -4px 12px rgba(0, 0, 0, 0.15),
            inset 0 2px 4px rgba(255, 255, 255, 0.3);
          z-index: 1;
        }
        .lucky-lottery .go-btn svg { width: 22px; height: 22px; }
        .lucky-lottery .go-btn .arrow { transition: transform 0.25s; }
        .lucky-lottery .go-btn:hover:not(:disabled) {
          transform: translateY(-3px) scale(1.02);
          box-shadow: 0 20px 40px rgba(225, 29, 72, 0.5),
            inset 0 -4px 12px rgba(0, 0, 0, 0.15),
            inset 0 2px 4px rgba(255, 255, 255, 0.3);
        }
        .lucky-lottery .go-btn:hover:not(:disabled) .arrow { transform: translateX(4px); }
        .lucky-lottery .go-btn:active:not(:disabled) { transform: translateY(0) scale(0.99); }
        .lucky-lottery .go-btn::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
          transform: translateX(-100%);
          animation: lkGoShine 3s linear infinite;
        }
        @keyframes lkGoShine {
          0% { transform: translateX(-100%); }
          60%, 100% { transform: translateX(100%); }
        }
        .lucky-lottery .go-btn.is-disabled,
        .lucky-lottery .go-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
          background: linear-gradient(135deg, #cbd5e1, #94a3b8);
        }
        .lucky-lottery .go-btn.is-disabled::before { display: none; }
        .lucky-lottery .go-spin { animation: lkSpin 1s linear infinite; }

        .lucky-lottery .go-tip {
          font-size: 13px;
          color: var(--text-light);
          font-weight: 600;
          margin-top: 12px;
          letter-spacing: 0.3px;
          position: relative;
          z-index: 1;
          text-align: center;
        }

        /* === 数字炸弹（重新设计） === */
        .lucky-lottery .bomb-panel {
          padding: 28px;
          gap: 22px;
          background:
            radial-gradient(circle at 88% 0%, rgba(251, 113, 133, 0.18), transparent 55%),
            radial-gradient(circle at 0% 100%, rgba(244, 114, 182, 0.15), transparent 50%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.85), rgba(255, 245, 247, 0.65));
          border: 1px solid rgba(255, 255, 255, 1);
          box-shadow:
            0 30px 60px rgba(225, 29, 72, 0.1),
            0 12px 28px rgba(15, 23, 42, 0.06);
          overflow: hidden;
        }
        .lucky-lottery .bomb-panel::before {
          content: '';
          position: absolute;
          inset: -2px;
          border-radius: inherit;
          background: linear-gradient(135deg, rgba(251, 113, 133, 0.28), rgba(168, 85, 247, 0.18) 50%, transparent 80%);
          z-index: -1;
          filter: blur(16px);
          pointer-events: none;
        }

        /* 头部 */
        .lucky-lottery .bomb-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .lucky-lottery .bomb-title-wrap {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .lucky-lottery .bomb-icon-box {
          width: 52px;
          height: 52px;
          border-radius: 16px;
          background: linear-gradient(135deg, #fb7185, #e11d48);
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 16px 28px rgba(225, 29, 72, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.4);
        }
        .lucky-lottery .bomb-icon-box :global(svg) { width: 26px; height: 26px; }
        .lucky-lottery .bomb-title-block { display: flex; flex-direction: column; }
        .lucky-lottery .bomb-title {
          font-size: 22px;
          font-weight: 900;
          color: var(--text-main);
          margin: 0;
          letter-spacing: -0.5px;
          background: linear-gradient(135deg, #e11d48, #be123c);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .lucky-lottery .bomb-subtitle {
          font-size: 12.5px;
          color: var(--text-light);
          margin: 4px 0 0;
          font-weight: 600;
        }
        .lucky-lottery .bomb-meta-card {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          padding: 10px 18px;
          border-radius: 16px;
          background: linear-gradient(135deg, rgba(225, 29, 72, 0.95), rgba(190, 18, 60, 0.95));
          color: #fff;
          box-shadow: 0 14px 28px rgba(225, 29, 72, 0.32);
          min-width: 130px;
        }
        .lucky-lottery .bomb-meta-label {
          font-size: 11px;
          letter-spacing: 1px;
          opacity: 0.85;
          font-weight: 700;
        }
        .lucky-lottery .bomb-meta-value {
          display: flex;
          align-items: baseline;
          gap: 4px;
          margin-top: 2px;
        }
        .lucky-lottery .bomb-meta-value strong {
          font-size: 26px;
          font-weight: 900;
          line-height: 1;
        }
        .lucky-lottery .bomb-meta-unit {
          font-size: 11px;
          font-weight: 700;
          opacity: 0.85;
        }

        /* 规则提示带 */
        .lucky-lottery .bomb-rule-bar {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .lucky-lottery .bomb-rule-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.85);
          border: 1px solid rgba(225, 29, 72, 0.16);
          font-size: 12px;
          font-weight: 700;
          color: #be123c;
          box-shadow: 0 6px 14px rgba(225, 29, 72, 0.06);
        }
        .lucky-lottery .bomb-rule-chip :global(svg) { width: 14px; height: 14px; }

        /* 区块通用 */
        .lucky-lottery .bomb-section { display: flex; flex-direction: column; gap: 14px; }
        .lucky-lottery .bomb-section-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .lucky-lottery .bomb-section-label {
          font-size: 13px;
          font-weight: 800;
          color: var(--text-main);
          letter-spacing: 0.3px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .lucky-lottery .bomb-section-label::before {
          content: '';
          display: inline-block;
          width: 4px;
          height: 16px;
          border-radius: 4px;
          background: linear-gradient(180deg, #fb7185, #e11d48);
        }
        .lucky-lottery .bomb-pick-tag {
          font-size: 12px;
          font-weight: 700;
          color: #be123c;
          background: rgba(225, 29, 72, 0.08);
          border-radius: 999px;
          padding: 4px 12px;
        }
        .lucky-lottery .bomb-pick-tag.empty {
          color: var(--text-light);
          background: rgba(15, 23, 42, 0.05);
        }
        .lucky-lottery .bomb-pick-tag strong {
          color: #e11d48;
          font-weight: 900;
          margin: 0 2px;
        }

        /* 扑克牌式数字盘 */
        .lucky-lottery .bomb-cards {
          display: grid;
          grid-template-columns: repeat(10, minmax(0, 1fr));
          gap: 10px;
        }
        .lucky-lottery .bomb-card {
          position: relative;
          aspect-ratio: 5 / 7;
          border-radius: 16px;
          border: 2px solid rgba(15, 23, 42, 0.08);
          background:
            radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.7)),
            #ffffff;
          color: #0f172a;
          cursor: pointer;
          overflow: hidden;
          transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease, border-color 0.2s ease, background 0.2s ease;
          padding: 6px 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .lucky-lottery .bomb-card::before {
          content: '';
          position: absolute;
          inset: 4px;
          border-radius: 12px;
          border: 1px solid rgba(15, 23, 42, 0.04);
          pointer-events: none;
        }
        .lucky-lottery .bomb-card-corner {
          position: absolute;
          font-size: 12px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.55);
          letter-spacing: -0.3px;
          line-height: 1;
        }
        .lucky-lottery .bomb-card-corner.top { top: 6px; left: 8px; }
        .lucky-lottery .bomb-card-corner.bottom { bottom: 6px; right: 8px; transform: rotate(180deg); }
        .lucky-lottery .bomb-card-number {
          font-size: 28px;
          font-weight: 900;
          line-height: 1;
          letter-spacing: -1.5px;
        }
        .lucky-lottery .bomb-card-suit {
          position: absolute;
          font-size: 10px;
          opacity: 0.18;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          color: #e11d48;
        }
        .lucky-lottery .bomb-card:hover:not(:disabled) {
          transform: translateY(-4px) rotate(-1deg);
          box-shadow: 0 18px 32px rgba(15, 23, 42, 0.1);
          border-color: rgba(225, 29, 72, 0.35);
        }
        .lucky-lottery .bomb-card.is-active {
          transform: translateY(-6px) rotate(-2deg);
          background: linear-gradient(160deg, #fff5f7, #ffe4e6);
          border-color: #e11d48;
          box-shadow:
            0 22px 40px rgba(225, 29, 72, 0.32),
            inset 0 0 0 2px rgba(225, 29, 72, 0.18);
        }
        .lucky-lottery .bomb-card.is-active .bomb-card-number {
          background: linear-gradient(135deg, #e11d48, #9f1239);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .lucky-lottery .bomb-card.is-active .bomb-card-corner {
          color: #e11d48;
        }
        .lucky-lottery .bomb-card.is-active .bomb-card-suit {
          opacity: 0.45;
        }
        .lucky-lottery .bomb-card.is-locked::after {
          content: '今日';
          position: absolute;
          top: 4px;
          right: 4px;
          font-size: 9px;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 999px;
          background: linear-gradient(135deg, #fbbf24, #f97316);
          color: #fff;
          box-shadow: 0 4px 8px rgba(249, 115, 22, 0.3);
        }
        .lucky-lottery .bomb-card:disabled {
          cursor: not-allowed;
          opacity: 0.55;
          transform: none;
        }

        /* 渐变赔率卡（倍率） */
        .lucky-lottery .bomb-mul-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
        }
        .lucky-lottery .bomb-mul-card {
          position: relative;
          padding: 16px 12px 14px;
          border-radius: 18px;
          border: 2px solid rgba(15, 23, 42, 0.08);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(255, 245, 247, 0.7));
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
          overflow: hidden;
        }
        .lucky-lottery .bomb-mul-card::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: var(--mul-grad, linear-gradient(135deg, #fbbf24, #f97316));
          opacity: 0;
          transition: opacity 0.25s ease;
          z-index: 0;
        }
        .lucky-lottery .bomb-mul-card.mul-1 { --mul-grad: linear-gradient(135deg, #94a3b8, #475569); }
        .lucky-lottery .bomb-mul-card.mul-2 { --mul-grad: linear-gradient(135deg, #60a5fa, #3b82f6); }
        .lucky-lottery .bomb-mul-card.mul-5 { --mul-grad: linear-gradient(135deg, #fb7185, #e11d48); }
        .lucky-lottery .bomb-mul-card.mul-10 { --mul-grad: linear-gradient(135deg, #fbbf24, #f97316); }
        .lucky-lottery .bomb-mul-tag,
        .lucky-lottery .bomb-mul-cost,
        .lucky-lottery .bomb-mul-prize {
          position: relative;
          z-index: 1;
        }
        .lucky-lottery .bomb-mul-tag {
          display: inline-block;
          font-size: 18px;
          font-weight: 900;
          letter-spacing: 0.5px;
          color: var(--text-main);
        }
        .lucky-lottery .bomb-mul-cost {
          font-size: 11.5px;
          color: var(--text-light);
          font-weight: 700;
        }
        .lucky-lottery .bomb-mul-cost strong {
          color: var(--text-main);
          font-weight: 900;
          margin: 0 2px;
        }
        .lucky-lottery .bomb-mul-prize {
          font-size: 11.5px;
          color: #047857;
          font-weight: 800;
          background: rgba(16, 185, 129, 0.1);
          border-radius: 999px;
          padding: 3px 10px;
          margin-top: 2px;
        }
        .lucky-lottery .bomb-mul-prize strong {
          color: #065f46;
          font-weight: 900;
          margin: 0 2px;
        }
        .lucky-lottery .bomb-mul-card:hover:not(:disabled) {
          transform: translateY(-3px);
          box-shadow: 0 14px 28px rgba(15, 23, 42, 0.08);
        }
        .lucky-lottery .bomb-mul-card.is-active {
          border-color: transparent;
          transform: translateY(-4px);
          box-shadow: 0 22px 40px rgba(15, 23, 42, 0.18);
        }
        .lucky-lottery .bomb-mul-card.is-active::before { opacity: 1; }
        .lucky-lottery .bomb-mul-card.is-active .bomb-mul-tag,
        .lucky-lottery .bomb-mul-card.is-active .bomb-mul-cost,
        .lucky-lottery .bomb-mul-card.is-active .bomb-mul-cost strong { color: #fff; }
        .lucky-lottery .bomb-mul-card.is-active .bomb-mul-prize {
          background: rgba(255, 255, 255, 0.22);
          color: #fff;
          backdrop-filter: blur(4px);
        }
        .lucky-lottery .bomb-mul-card.is-active .bomb-mul-prize strong { color: #fff; }
        .lucky-lottery .bomb-mul-card:disabled { cursor: not-allowed; opacity: 0.55; }

        /* 状态卡片：今日 / 昨日 */
        .lucky-lottery .bomb-status-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .lucky-lottery .bomb-status-card {
          padding: 14px 16px;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.78);
          border: 1px solid rgba(255, 255, 255, 0.95);
          box-shadow: 0 12px 24px rgba(15, 23, 42, 0.04);
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-height: 96px;
        }
        .lucky-lottery .bomb-status-card .status-label {
          font-size: 11px;
          font-weight: 800;
          color: var(--text-light);
          letter-spacing: 1.5px;
          text-transform: uppercase;
        }
        .lucky-lottery .bomb-status-card .status-body {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .lucky-lottery .bomb-status-card .status-body :global(svg) {
          width: 22px;
          height: 22px;
          flex: 0 0 auto;
          color: #e11d48;
        }
        .lucky-lottery .bomb-status-card .status-title {
          font-size: 14px;
          font-weight: 800;
          color: var(--text-main);
        }
        .lucky-lottery .bomb-status-card .status-meta {
          font-size: 12px;
          color: var(--text-light);
          margin-top: 2px;
          font-weight: 600;
        }
        .lucky-lottery .bomb-status-card .status-meta strong { color: var(--text-main); font-weight: 900; }
        .lucky-lottery .bomb-status-card .status-body.pending :global(svg) { color: #2563eb; }
        .lucky-lottery .bomb-status-card .status-body.cancelled :global(svg) { color: #64748b; }
        .lucky-lottery .bomb-status-card .status-body.settled :global(svg) { color: #ea580c; }
        .lucky-lottery .bomb-status-card .status-body.idle :global(svg) { color: var(--text-light); }
        .lucky-lottery .bomb-status-card .status-body.loading :global(svg) {
          color: var(--text-light);
          animation: lk-bomb-spin 1s linear infinite;
        }
        .lucky-lottery .bomb-status-card .status-body.won .status-title { color: #047857; }
        .lucky-lottery .bomb-status-card .status-body.lost .status-title { color: #b91c1c; }
        .lucky-lottery .bomb-system-bubble {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          font-weight: 900;
          color: #fff;
          background: linear-gradient(135deg, #fb7185, #e11d48);
          box-shadow: 0 10px 18px rgba(225, 29, 72, 0.35);
        }
        .lucky-lottery .bomb-system-bubble.idle {
          background: rgba(15, 23, 42, 0.08);
          color: var(--text-light);
          box-shadow: none;
        }

        /* 提示横条 */
        .lucky-lottery .bomb-message {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 11px 14px;
          border-radius: 14px;
          font-size: 13px;
          font-weight: 700;
        }
        .lucky-lottery .bomb-message :global(svg) { width: 16px; height: 16px; flex: 0 0 auto; }
        .lucky-lottery .bomb-message.success {
          color: #047857;
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.25);
        }
        .lucky-lottery .bomb-message.error {
          color: #b91c1c;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.25);
        }

        /* 操作按钮 */
        .lucky-lottery .bomb-actions {
          display: flex;
          gap: 12px;
          margin-top: 4px;
        }
        .lucky-lottery .bomb-btn {
          flex: 1;
          height: 56px;
          border-radius: 18px;
          border: none;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          font-size: 15px;
          font-weight: 900;
          letter-spacing: 0.5px;
          transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
          position: relative;
          overflow: hidden;
        }
        .lucky-lottery .bomb-btn :global(svg) { width: 18px; height: 18px; }
        .lucky-lottery .bomb-btn .arrow { width: 18px; height: 18px; }
        .lucky-lottery .bomb-btn.primary {
          background: linear-gradient(135deg, #fb7185, #e11d48);
          color: #fff;
          box-shadow:
            0 18px 36px rgba(225, 29, 72, 0.35),
            inset 0 1px 0 rgba(255, 255, 255, 0.3);
        }
        .lucky-lottery .bomb-btn.primary::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(120deg, transparent 30%, rgba(255, 255, 255, 0.35) 50%, transparent 70%);
          transform: translateX(-120%);
          transition: transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .lucky-lottery .bomb-btn.primary:hover:not(:disabled) {
          transform: translateY(-3px);
          box-shadow: 0 22px 44px rgba(225, 29, 72, 0.42);
        }
        .lucky-lottery .bomb-btn.primary:hover:not(:disabled)::before {
          transform: translateX(120%);
        }
        .lucky-lottery .bomb-btn.ghost {
          flex: 0 0 160px;
          background: rgba(255, 255, 255, 0.7);
          color: var(--text-main);
          border: 1.5px solid rgba(15, 23, 42, 0.08);
        }
        .lucky-lottery .bomb-btn.ghost:hover:not(:disabled) {
          background: #fff;
          border-color: rgba(225, 29, 72, 0.3);
          color: #e11d48;
        }
        .lucky-lottery .bomb-btn:disabled {
          cursor: not-allowed;
          opacity: 0.55;
          transform: none;
        }
        .lucky-lottery .bomb-spin {
          animation: lk-bomb-spin 1s linear infinite;
        }
        @keyframes lk-bomb-spin {
          to { transform: rotate(360deg); }
        }

        /* 数字炸弹响应式 */
        @media (max-width: 1024px) {
          .lucky-lottery .bomb-cards { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
          .lucky-lottery .bomb-status-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 640px) {
          .lucky-lottery .bomb-panel { padding: 22px 18px; gap: 18px; }
          .lucky-lottery .bomb-meta-card { width: 100%; align-items: flex-start; }
          .lucky-lottery .bomb-cards { grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
          .lucky-lottery .bomb-card-number { font-size: 24px; }
          .lucky-lottery .bomb-mul-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
          .lucky-lottery .bomb-actions { flex-direction: column; }
          .lucky-lottery .bomb-btn.ghost { flex: 1; width: 100%; }
        }

        /* 我的宝藏（已下线，保留旧样式以兼容历史 ID） */
        .lucky-lottery .treasure-panel { min-height: 460px; }
        .lucky-lottery .treasure-panel::before {
          content: '';
          position: absolute;
          top: -30%;
          left: -30%;
          width: 280px;
          height: 280px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(225, 29, 72, 0.2), transparent 60%);
          filter: blur(40px);
          pointer-events: none;
        }
        .lucky-lottery .treasure-count {
          font-size: 11px;
          font-weight: 800;
          background: rgba(15, 23, 42, 0.05);
          color: var(--text-light);
          padding: 3px 10px;
          border-radius: 999px;
        }
        .lucky-lottery .treasure-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          position: relative;
          z-index: 1;
          overflow-y: auto;
          max-height: 540px;
          padding-right: 2px;
        }
        .lucky-lottery .treasure-list::-webkit-scrollbar { width: 4px; }
        .lucky-lottery .treasure-list::-webkit-scrollbar-thumb {
          background: rgba(15, 23, 42, 0.1);
          border-radius: 4px;
        }
        .lucky-lottery .treasure-item {
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.95);
          border-radius: 18px;
          padding: 14px 16px;
          transition: all 0.25s ease;
        }
        .lucky-lottery .treasure-item:hover {
          background: #fff;
          transform: translateX(-3px);
          box-shadow: 0 12px 24px rgba(15, 23, 42, 0.06);
        }
        .lucky-lottery .treasure-item.is-skeleton {
          padding: 16px;
          background: rgba(255, 255, 255, 0.4);
          animation: lkPulse 1.5s ease-in-out infinite;
        }
        .lucky-lottery .ti-skeleton-line {
          height: 12px;
          background: rgba(15, 23, 42, 0.08);
          border-radius: 6px;
          margin-bottom: 8px;
        }
        .lucky-lottery .ti-skeleton-line.short { width: 60%; }
        @keyframes lkPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }

        .lucky-lottery .ti-head {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
          flex-wrap: wrap;
        }
        .lucky-lottery .ti-amount-icon {
          width: 28px;
          height: 28px;
          border-radius: 9px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: 14px;
          flex-shrink: 0;
        }
        .lucky-lottery .ti-amount-icon.flame {
          background: var(--grad-primary);
          box-shadow: 0 4px 8px rgba(225, 29, 72, 0.3);
        }
        .lucky-lottery .ti-amount-icon.sprout {
          background: var(--grad-green);
          box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3);
        }
        .lucky-lottery .ti-amount-text {
          font-size: 14px;
          font-weight: 800;
          color: var(--text-main);
          flex: 1;
          min-width: 0;
          letter-spacing: -0.2px;
        }
        .lucky-lottery .ti-status {
          display: inline-flex;
          align-items: center;
          padding: 3px 8px;
          background: rgba(16, 185, 129, 0.1);
          color: var(--c-green);
          border-radius: 6px;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.3px;
        }
        .lucky-lottery .ti-status.code {
          background: rgba(59, 130, 246, 0.1);
          color: var(--c-blue);
        }
        .lucky-lottery .ti-date {
          font-size: 11px;
          color: var(--text-light);
          font-weight: 700;
          letter-spacing: 0.3px;
        }

        .lucky-lottery .ti-detail {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 9px 12px;
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(52, 211, 153, 0.04));
          border: 1px solid rgba(16, 185, 129, 0.18);
          border-radius: 11px;
          font-size: 12.5px;
          font-weight: 700;
          color: #047857;
        }
        .lucky-lottery .ti-detail .money-bag {
          color: #d97706;
          font-size: 14px;
        }
        .lucky-lottery .ti-detail-code {
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.06), rgba(96, 165, 250, 0.04));
          border-color: rgba(59, 130, 246, 0.18);
          color: #1d4ed8;
          justify-content: space-between;
          gap: 8px;
        }
        .lucky-lottery .ti-code {
          font-family: 'Outfit', monospace;
          font-size: 12px;
          font-weight: 700;
          color: #1e293b;
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          user-select: all;
        }
        .lucky-lottery .ti-copy-btn {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          border: none;
          background: rgba(59, 130, 246, 0.1);
          color: var(--c-blue);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: all 0.2s;
        }
        .lucky-lottery .ti-copy-btn svg { width: 13px; height: 13px; }
        .lucky-lottery .ti-copy-btn:hover { background: var(--c-blue); color: #fff; }
        .lucky-lottery .ti-copy-btn.copied { background: var(--c-green); color: #fff; }

        /* === modal === */
        .lucky-lottery .modal-mask {
          position: fixed;
          inset: 0;
          z-index: 200;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }
        .lucky-lottery .modal-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(15, 23, 42, 0.5);
          backdrop-filter: blur(8px);
        }
        .lucky-lottery .modal-card {
          position: relative;
          background: linear-gradient(180deg, #fff, #fff1f2);
          border-radius: 32px;
          padding: 40px 36px;
          text-align: center;
          max-width: 420px;
          width: 100%;
          box-shadow: 0 32px 64px rgba(0, 0, 0, 0.25);
          animation: lkModalIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
          overflow: hidden;
        }
        @keyframes lkModalIn {
          0% { transform: scale(0.85); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .lucky-lottery .modal-card::before {
          content: '';
          position: absolute;
          top: -30%;
          left: 50%;
          transform: translateX(-50%);
          width: 400px;
          height: 400px;
          background: radial-gradient(circle, rgba(251, 191, 36, 0.3), transparent 60%);
          filter: blur(40px);
          pointer-events: none;
        }
        .lucky-lottery .modal-close {
          position: absolute;
          top: 16px;
          right: 16px;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: rgba(15, 23, 42, 0.05);
          border: none;
          color: var(--text-light);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          z-index: 2;
        }
        .lucky-lottery .modal-close:hover {
          background: rgba(244, 63, 94, 0.12);
          color: var(--c-red);
        }
        .lucky-lottery .modal-close svg { width: 16px; height: 16px; }
        .lucky-lottery .modal-emoji {
          font-size: 72px;
          margin-bottom: 16px;
          display: inline-block;
          animation: lkBounce 0.6s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
        }
        @keyframes lkBounce {
          0% { transform: scale(0); opacity: 0; }
          70% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
        .lucky-lottery .modal-title {
          font-size: 26px;
          font-weight: 900;
          color: var(--text-main);
          margin-bottom: 6px;
          letter-spacing: -0.5px;
          position: relative;
        }
        .lucky-lottery .modal-prize {
          font-size: 40px;
          font-weight: 900;
          background: var(--grad-primary);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin: 4px 0 8px;
          letter-spacing: -1px;
          position: relative;
        }
        .lucky-lottery .modal-desc {
          font-size: 14px;
          color: var(--text-light);
          margin-bottom: 22px;
          position: relative;
        }
        .lucky-lottery .modal-credit {
          background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(52, 211, 153, 0.04));
          border: 2px solid rgba(16, 185, 129, 0.25);
          border-radius: 22px;
          padding: 20px 24px;
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 22px;
          position: relative;
          text-align: left;
        }
        .lucky-lottery .modal-credit .money-bag {
          font-size: 36px;
        }
        .lucky-lottery .modal-credit-label {
          font-size: 12px;
          color: #047857;
          font-weight: 700;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        .lucky-lottery .modal-credit-value {
          font-size: 28px;
          font-weight: 900;
          color: #065f46;
          letter-spacing: -0.5px;
        }

        .lucky-lottery .modal-code-row {
          display: flex;
          align-items: stretch;
          gap: 8px;
          margin-bottom: 22px;
          position: relative;
        }
        .lucky-lottery .modal-code {
          flex: 1;
          background: #f8fafc;
          border: 2px dashed rgba(225, 29, 72, 0.3);
          border-radius: 14px;
          padding: 14px 16px;
          font-family: 'Outfit', monospace;
          font-size: 16px;
          font-weight: 800;
          color: var(--text-main);
          letter-spacing: 0.5px;
          word-break: break-all;
          text-align: center;
        }
        .lucky-lottery .modal-copy {
          width: 48px;
          border: none;
          border-radius: 14px;
          background: var(--grad-primary);
          color: #fff;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: all 0.2s;
          box-shadow: 0 8px 16px rgba(225, 29, 72, 0.3);
        }
        .lucky-lottery .modal-copy svg { width: 16px; height: 16px; }
        .lucky-lottery .modal-copy:hover { transform: translateY(-2px); }
        .lucky-lottery .modal-copy.copied { background: var(--grad-green); box-shadow: 0 8px 16px rgba(16, 185, 129, 0.35); }

        .lucky-lottery .modal-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 14px 36px;
          background: var(--grad-primary);
          color: #fff;
          border: none;
          border-radius: 999px;
          font-family: inherit;
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 12px 24px rgba(225, 29, 72, 0.3);
          position: relative;
        }
        .lucky-lottery .modal-btn svg { width: 14px; height: 14px; }
        .lucky-lottery .modal-btn:hover { transform: translateY(-2px); }

        /* 规则弹窗 */
        .lucky-lottery .modal-card-rules {
          max-width: min(920px, calc(100vw - 32px));
          max-height: min(88vh, 820px);
          background:
            radial-gradient(circle at 12% 0%, rgba(251, 191, 36, 0.16), transparent 38%),
            radial-gradient(circle at 100% 15%, rgba(251, 113, 133, 0.18), transparent 42%),
            linear-gradient(180deg, #fff, #fff7f7);
          padding: 34px;
          text-align: left;
          overflow-y: auto;
        }
        .lucky-lottery .modal-card-rules::before { display: none; }
        .lucky-lottery .modal-rules-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }
        .lucky-lottery .modal-rules-icon {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: var(--grad-primary);
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 16px rgba(225, 29, 72, 0.3);
        }
        .lucky-lottery .modal-rules-icon svg { width: 20px; height: 20px; }
        .lucky-lottery .modal-rules-kicker {
          margin: 0 0 3px;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 1.4px;
          color: #be123c;
        }
        .lucky-lottery .modal-rules-title {
          font-size: 22px;
          font-weight: 900;
          letter-spacing: -0.5px;
          margin: 0;
          color: var(--text-main);
        }
        .lucky-lottery .modal-rules-summary {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 18px;
        }
        .lucky-lottery .modal-rules-summary span {
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          padding: 6px 11px;
          border-radius: 999px;
          background: rgba(225, 29, 72, 0.08);
          border: 1px solid rgba(225, 29, 72, 0.14);
          color: #be123c;
          font-size: 11.5px;
          font-weight: 900;
        }
        .lucky-lottery .modal-rules-body {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 22px;
        }
        .lucky-lottery .modal-rule-section {
          border-radius: 22px;
          padding: 16px;
          background: rgba(255, 255, 255, 0.78);
          border: 1px solid rgba(255, 255, 255, 0.95);
          box-shadow: 0 18px 34px rgba(15, 23, 42, 0.06);
        }
        .lucky-lottery .modal-rule-section.bomb {
          background: linear-gradient(180deg, rgba(255, 247, 237, 0.88), rgba(255, 255, 255, 0.78));
        }
        .lucky-lottery .modal-rule-section-head {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 14px;
        }
        .lucky-lottery .modal-rule-section-icon {
          width: 40px;
          height: 40px;
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--grad-primary);
          color: #fff;
          box-shadow: 0 10px 18px rgba(225, 29, 72, 0.24);
          flex: 0 0 auto;
        }
        .lucky-lottery .modal-rule-section.bomb .modal-rule-section-icon {
          background: linear-gradient(135deg, #fbbf24, #f97316);
          box-shadow: 0 10px 18px rgba(249, 115, 22, 0.24);
        }
        .lucky-lottery .modal-rule-section-icon svg { width: 20px; height: 20px; }
        .lucky-lottery .modal-rule-section h3 {
          margin: 0;
          color: var(--text-main);
          font-size: 16px;
          font-weight: 900;
        }
        .lucky-lottery .modal-rule-section-head p {
          margin: 2px 0 0;
          color: var(--text-light);
          font-size: 12px;
          font-weight: 700;
          line-height: 1.45;
        }
        .lucky-lottery .modal-rules-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .lucky-lottery .modal-rules-list li {
          display: flex;
          gap: 14px;
          padding: 14px;
          background: #fff;
          border: 1px solid rgba(15, 23, 42, 0.06);
          border-radius: 14px;
        }
        .lucky-lottery .modal-rules-list h4 {
          font-size: 14px;
          font-weight: 800;
          color: var(--text-main);
          margin: 0 0 4px;
        }
        .lucky-lottery .modal-rules-list p {
          font-size: 12.5px;
          color: var(--text-light);
          line-height: 1.55;
          margin: 0;
        }
        .lucky-lottery .modal-rules-list strong {
          color: var(--c-orange);
          font-weight: 800;
        }
        .lucky-lottery .rule-num {
          flex-shrink: 0;
          width: 30px;
          height: 30px;
          border-radius: 10px;
          background: var(--grad-primary);
          color: #fff;
          font-weight: 900;
          font-size: 11.5px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          letter-spacing: 0.5px;
          box-shadow: 0 6px 12px rgba(225, 29, 72, 0.25);
        }

        /* 积分模式专用样式（谢谢惠顾 / 单位等） */
        .lucky-lottery .rank-value-unit {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-light);
          margin-left: 2px;
        }
        .lucky-lottery .ti-status.miss {
          background: rgba(15, 23, 42, 0.06);
          color: var(--text-light);
        }
        .lucky-lottery .ti-detail-miss {
          background: linear-gradient(135deg, rgba(236, 72, 153, 0.08), rgba(244, 63, 94, 0.05));
          border-color: rgba(236, 72, 153, 0.2);
          color: #be185d;
        }
        .lucky-lottery .modal-prize.miss {
          background: linear-gradient(135deg, #94a3b8, #64748b);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .lucky-lottery .modal-credit.modal-credit-miss {
          background: linear-gradient(135deg, rgba(236, 72, 153, 0.08), rgba(244, 63, 94, 0.05));
          border-color: rgba(236, 72, 153, 0.25);
        }
        .lucky-lottery .modal-credit-value.miss {
          color: #be185d;
        }
        .lucky-lottery .modal-card-rules .modal-btn { width: 100%; }

        /* 响应式 */
        @media (max-width: 1280px) {
          .lucky-lottery .topbar { padding: 14px 32px; }
          .lucky-lottery .container { padding: 24px 32px 80px; }
          .lucky-lottery .lottery-grid { gap: 22px; }
          .lucky-lottery .hero-title { font-size: 44px; }
          .lucky-lottery .wheel-wrap { width: 320px; }
          .lucky-lottery .pie-label { --label-radius: 110px; }
          .lucky-lottery .pie-label .price { font-size: 19px; }
          .lucky-lottery .pie-label .ico { font-size: 19px; }
        }
        @media (max-width: 1024px) {
          .lucky-lottery .lottery-grid { gap: 20px; }
          .lucky-lottery .bomb-panel { min-height: auto; }
          .lucky-lottery .wheel-wrap { width: 360px; }
          .lucky-lottery .pie-label { --label-radius: 122px; }
        }
        @media (max-width: 768px) {
          .lucky-lottery .topbar { padding: 12px 20px; gap: 12px; }
          .lucky-lottery .container { padding: 18px 20px 80px; gap: 22px; }
          .lucky-lottery .hero-icon { width: 60px; height: 60px; border-radius: 18px; margin-bottom: 14px; }
          .lucky-lottery .hero-icon svg { width: 28px; height: 28px; }
          .lucky-lottery .hero-title { font-size: 32px; letter-spacing: -1px; margin-bottom: 12px; }
          .lucky-lottery .hero-sub { font-size: 13px; }
          .lucky-lottery .hero-sub .accent { font-size: 15px; }
          .lucky-lottery .panel { padding: 20px; border-radius: 24px; }
          .lucky-lottery .panel-title { font-size: 16px; }
          .lucky-lottery .wheel-wrap { width: 280px; }
          .lucky-lottery .pie-label { --label-radius: 95px; }
          .lucky-lottery .lucky-btn { width: 70px; height: 70px; font-size: 13px; border-width: 4px; }
          .lucky-lottery .pie-label .price { font-size: 16px; }
          .lucky-lottery .pie-label .ico { font-size: 16px; }
          .lucky-lottery .go-btn { font-size: 18px; padding: 16px 24px; border-radius: 18px; }
          .lucky-lottery .user-info { display: none; }
          .lucky-lottery .modal-rules-body { grid-template-columns: 1fr; }
          .lucky-lottery .modal-card-rules { padding: 28px 22px; }
        }
        @media (max-width: 480px) {
          .lucky-lottery .topbar { padding: 10px 14px; gap: 6px; }
          .lucky-lottery .brand { font-size: 16px; gap: 8px; }
          .lucky-lottery .brand-icon { width: 32px; height: 32px; border-radius: 10px; }
          .lucky-lottery .brand-icon svg { width: 18px; height: 18px; }
          .lucky-lottery .hero-title { font-size: 26px; }
          .lucky-lottery .wheel-wrap { width: 240px; }
          .lucky-lottery .pie-label { --label-radius: 80px; }
          .lucky-lottery .lucky-btn { width: 60px; height: 60px; font-size: 11px; border-width: 4px; }
          .lucky-lottery .pie-label .price { font-size: 14px; }
          .lucky-lottery .pie-label .ico { font-size: 14px; }
          .lucky-lottery .chance-pill { padding: 7px 14px; font-size: 12px; }
          .lucky-lottery .chance-pill .num { font-size: 14px; }
          .lucky-lottery .modal-card { padding: 32px 24px; }
          .lucky-lottery .modal-emoji { font-size: 56px; }
          .lucky-lottery .modal-prize { font-size: 32px; }
        }

        /* === 手机端重排 v2：参考排行榜/游戏中心 === */
        @media (max-width: 640px) {
          .lucky-lottery .mesh-bg {
            opacity: 0.72;
            filter: blur(42px);
          }

          /* 顶栏：fixed 全宽磨砂，不随页面滚动 */
          .lucky-lottery .topbar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 100;
            width: 100%;
            margin: 0;
            padding: 10px 14px;
            padding-top: max(10px, env(safe-area-inset-top));
            gap: 8px;
            border: 0;
            border-radius: 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.8);
            background: rgba(255, 250, 252, 0.82);
            backdrop-filter: blur(24px) saturate(1.6);
            -webkit-backdrop-filter: blur(24px) saturate(1.6);
            box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
          }
          .lucky-lottery .brand {
            min-width: 0;
            gap: 8px;
            font-size: 16px;
            letter-spacing: 0;
          }
          .lucky-lottery .brand-icon {
            width: 34px;
            height: 34px;
            border-radius: 13px;
            flex: 0 0 auto;
          }
          .lucky-lottery .topbar-right {
            min-width: 0;
            gap: 6px;
          }
          .lucky-lottery .topbar .btn-icon {
            width: 36px;
            height: 36px;
            border-radius: 14px;
            flex: 0 0 auto;
            background: rgba(255, 255, 255, 0.92);
          }
          .lucky-lottery .topbar .btn-icon svg { width: 16px; height: 16px; }
          .lucky-lottery .user-profile {
            width: 36px;
            height: 36px;
            justify-content: center;
            padding: 0;
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.92);
          }
          .lucky-lottery .user-profile .avatar {
            width: 32px;
            height: 32px;
            border-radius: 12px;
          }

          /* 容器 & Hero：给 fixed topbar 让出空间 */
          .lucky-lottery .container {
            padding: max(76px, calc(64px + env(safe-area-inset-top))) 12px max(80px, calc(28px + env(safe-area-inset-bottom)));
            gap: 16px;
          }
          .lucky-lottery .lottery-hero {
            padding: 22px 16px;
            border-radius: 22px;
          }
          .lucky-lottery .hero-icon {
            width: 52px;
            height: 52px;
            border-radius: 15px;
            margin-bottom: 10px;
          }
          .lucky-lottery .hero-icon svg { width: 24px; height: 24px; }
          .lucky-lottery .hero-title {
            font-size: 24px;
            letter-spacing: -0.5px;
            margin-bottom: 10px;
          }
          .lucky-lottery .hero-sub { font-size: 12.5px; line-height: 1.6; }
          .lucky-lottery .hero-sub .accent { font-size: 13.5px; }

          /* 单列网格 */
          .lucky-lottery .lottery-grid {
            grid-template-columns: 1fr;
            gap: 16px;
          }
          .lucky-lottery .panel {
            padding: 16px 14px;
            border-radius: 22px;
          }
          .lucky-lottery .panel-title { font-size: 15px; }

          /* 抽奖转盘 */
          .lucky-lottery .wheel-panel { padding: 18px 14px 16px; }
          .lucky-lottery .wheel-wrap {
            width: 240px;
            margin: 0 auto;
          }
          .lucky-lottery .pie-label { --label-radius: 80px; }
          .lucky-lottery .lucky-btn {
            width: 60px;
            height: 60px;
            font-size: 11px;
            border-width: 4px;
          }
          .lucky-lottery .pie-label .price { font-size: 14px; }
          .lucky-lottery .pie-label .ico { font-size: 14px; }
          .lucky-lottery .wheel-pointer { width: 36px; }
          .lucky-lottery .wheel-lights { display: none; }

          .lucky-lottery .chance-row { gap: 8px; margin-top: 10px; flex-wrap: wrap; justify-content: center; }
          .lucky-lottery .chance-pill { padding: 6px 12px; font-size: 11.5px; gap: 5px; }
          .lucky-lottery .chance-pill .ico { width: 22px; height: 22px; border-radius: 7px; }
          .lucky-lottery .chance-pill .num { font-size: 13px; }

          .lucky-lottery .go-btn {
            width: 100%;
            margin-top: 12px;
            padding: 14px 18px;
            font-size: 16px;
            letter-spacing: 1px;
            border-radius: 16px;
            gap: 8px;
          }
          .lucky-lottery .go-btn svg { width: 18px; height: 18px; }
          .lucky-lottery .go-tip { font-size: 11.5px; margin-top: 8px; }

          /* 数字炸弹 */
          .lucky-lottery .bomb-panel { padding: 16px 14px; gap: 14px; }
          .lucky-lottery .bomb-head {
            flex-direction: column;
            align-items: stretch;
            gap: 12px;
          }
          .lucky-lottery .bomb-title-wrap { gap: 10px; }
          .lucky-lottery .bomb-icon-box { width: 38px; height: 38px; border-radius: 12px; }
          .lucky-lottery .bomb-icon-box svg { width: 18px; height: 18px; }
          .lucky-lottery .bomb-title { font-size: 16px; }
          .lucky-lottery .bomb-subtitle { font-size: 11.5px; line-height: 1.5; }
          .lucky-lottery .bomb-meta-card {
            width: 100%;
            padding: 10px 12px;
            border-radius: 14px;
            align-items: flex-start;
          }
          .lucky-lottery .bomb-meta-label { font-size: 10.5px; }
          .lucky-lottery .bomb-meta-value strong { font-size: 22px; }
          .lucky-lottery .bomb-meta-unit { font-size: 11px; }

          .lucky-lottery .bomb-rule-bar { gap: 6px; flex-wrap: wrap; }
          .lucky-lottery .bomb-rule-chip { padding: 5px 9px; font-size: 10.5px; gap: 4px; }
          .lucky-lottery .bomb-rule-chip svg { width: 11px; height: 11px; }

          .lucky-lottery .bomb-section { gap: 10px; }
          .lucky-lottery .bomb-section-head { gap: 8px; }
          .lucky-lottery .bomb-section-label { font-size: 12px; }
          .lucky-lottery .bomb-pick-tag { font-size: 10.5px; padding: 3px 8px; }
          .lucky-lottery .bomb-pick-tag strong { font-size: 12px; }

          .lucky-lottery .bomb-cards {
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 6px;
          }
          .lucky-lottery .bomb-card-number { font-size: 22px; }
          .lucky-lottery .bomb-mul-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
          }
          .lucky-lottery .bomb-actions {
            flex-direction: column;
            gap: 8px;
          }
          .lucky-lottery .bomb-btn,
          .lucky-lottery .bomb-btn.ghost {
            width: 100%;
            padding: 12px 14px;
            font-size: 13px;
            border-radius: 14px;
          }
        }

        @media (max-width: 480px) {
          .lucky-lottery .topbar {
            padding: 9px 12px;
            padding-top: max(9px, env(safe-area-inset-top));
            gap: 6px;
          }
          .lucky-lottery .brand { font-size: 15px; gap: 7px; }
          .lucky-lottery .brand-icon { width: 32px; height: 32px; border-radius: 12px; }
          .lucky-lottery .brand-icon svg { width: 16px; height: 16px; }
          .lucky-lottery .topbar .btn-icon { width: 34px; height: 34px; border-radius: 13px; }
          .lucky-lottery .topbar .btn-icon svg { width: 15px; height: 15px; }
          .lucky-lottery .user-profile { width: 34px; height: 34px; border-radius: 13px; }
          .lucky-lottery .user-profile .avatar { width: 30px; height: 30px; border-radius: 11px; font-size: 11px; }

          .lucky-lottery .container { padding: max(72px, calc(60px + env(safe-area-inset-top))) 10px max(72px, calc(24px + env(safe-area-inset-bottom))); gap: 14px; }

          .lucky-lottery .lottery-hero { padding: 20px 14px; border-radius: 20px; }
          .lucky-lottery .hero-title { font-size: 22px; }
          .lucky-lottery .hero-sub { font-size: 12px; }

          .lucky-lottery .wheel-wrap { width: 220px; }
          .lucky-lottery .pie-label { --label-radius: 72px; }
          .lucky-lottery .lucky-btn { width: 54px; height: 54px; font-size: 10.5px; }
          .lucky-lottery .pie-label .price { font-size: 13px; }
          .lucky-lottery .pie-label .ico { font-size: 13px; }

          .lucky-lottery .bomb-cards { gap: 5px; }
          .lucky-lottery .bomb-card-number { font-size: 20px; }
          .lucky-lottery .bomb-meta-value strong { font-size: 20px; }
        }
      `}</style>
    </div>
  );
}
