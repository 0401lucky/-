'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  SLOT_BET_OPTIONS,
  SLOT_EARN_BASE,
  SLOT_PAIR_BONUS_WITH_DIAMOND,
  SLOT_PAIR_BONUS_WITH_SEVEN,
  SLOT_PAIR_MULTIPLIERS,
  SLOT_SPIN_COOLDOWN_MS,
  SLOT_SPECIAL_MIX_DIAMOND_DIAMOND_SEVEN_MULTIPLIER,
  SLOT_SYMBOLS,
  SLOT_TRIPLE_MULTIPLIERS,
  type SlotSymbolId,
} from '@/lib/slot-constants';

type SlotPlayMode = 'earn' | 'bet';
type SlotWinType = 'none' | 'pair' | 'pair_with_diamond' | 'pair_with_seven' | 'special_mix' | 'triple';

interface SlotSpinRecord {
  id: string;
  reels: SlotSymbolId[];
  mode?: SlotPlayMode;
  betCost?: number;
  payout: number;
  winType?: SlotWinType;
  multiplier?: number;
  matchedSymbolId?: SlotSymbolId;
  pointsEarned: number;
  pointsDelta?: number;
  createdAt: number;
}

interface SlotStatus {
  balance: number;
  dailyStats: { gamesPlayed: number; pointsEarned: number } | null;
  inCooldown: boolean;
  cooldownRemaining: number; // ms
  dailyLimit: number;
  pointsLimitReached: boolean;
  config: {
    betModeEnabled: boolean;
    betCost: number;
  };
  records: SlotSpinRecord[];
}

interface SlotRankingEntry {
  userId: number;
  username: string;
  score: number;
}

const INITIAL_REELS: [SlotSymbolId, SlotSymbolId, SlotSymbolId] = [
  SLOT_SYMBOLS[0]!.id,
  SLOT_SYMBOLS[1]!.id,
  SLOT_SYMBOLS[2]!.id,
];

const REEL_TRACK_LENGTHS: [number, number, number] = [30, 35, 40]; // Increased for smoother spin
const REEL_DURATIONS_MS: [number, number, number] = [2000, 2400, 2800]; // Slower for dramatic effect
const REEL_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'; // Smooth easing

  // Enhanced CSS Animation Keyframes
  const ANIMATION_STYLES = `
    :root {
      --cartoon-bg: #f0f9ff;
      --cartoon-panel: #ffffff;
      --cartoon-border: #e0f2fe;
      --cartoon-shadow: rgba(14, 165, 233, 0.15);
      --cartoon-text-main: #0f172a;
      --cartoon-text-sub: #475569;
    }

    @keyframes bounce-land {
      0% { transform: translateY(0); }
      30% { transform: translateY(8%); }
      60% { transform: translateY(-4%); }
      80% { transform: translateY(2%); }
      100% { transform: translateY(0); }
    }
    @keyframes win-pulse {
      0% { transform: scale(1); filter: brightness(100%); }
      50% { transform: scale(1.1); filter: brightness(110%) drop-shadow(0 0 15px rgba(250, 204, 21, 0.6)); }
      100% { transform: scale(1); filter: brightness(100%); }
    }
    @keyframes shine {
      from { mask-position: 150%; }
      to { mask-position: -50%; }
    }
    @keyframes confetti-fall {
      0% { transform: translateY(-20vh) rotate(0deg) scale(0.5); opacity: 1; }
      100% { transform: translateY(120vh) rotate(720deg) scale(0.8); opacity: 0; }
    }
    @keyframes spin-blur {
      0% { filter: blur(0); }
      10% { filter: blur(2px); }
      90% { filter: blur(2px); }
      100% { filter: blur(0); }
    }
    @keyframes pop-in {
      0% { transform: scale(0.9); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }

    /* Accessibility: Reduced Motion */
    @media (prefers-reduced-motion: reduce) {
      *, ::before, ::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
      .reel-bounce, .symbol-win, .spinning-blur, .btn-shine, .animate-bounce, .animate-spin, .animate-pulse, .pop-in {
        animation: none !important;
        transform: none !important;
      }
    }

    .reel-bounce {
      animation: bounce-land 0.5s cubic-bezier(0.36, 0, 0.66, -0.56) forwards;
    }
    .symbol-win {
      animation: win-pulse 1.2s ease-in-out infinite;
      z-index: 20;
    }
    .spinning-blur {
      animation: spin-blur 0.1s linear infinite;
    }
    .btn-shine {
      mask-image: linear-gradient(-75deg, rgba(0,0,0,.6) 30%, #000 50%, rgba(0,0,0,.6) 70%);
      mask-size: 200%;
      animation: shine 3s infinite;
    }
    
    /* Cartoon / Game Theme Classes */
    .cartoon-panel {
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(12px);
      border: 2px solid #e2e8f0;
      border-radius: 1.5rem;
      box-shadow: 0 8px 0 #cbd5e1, 0 8px 16px rgba(0,0,0,0.05);
      transition: transform 0.2s;
    }
    
    .cartoon-panel:hover {
      transform: translateY(-2px);
    }

    .game-btn {
      position: relative;
      border: none;
      transition: all 0.1s;
    }
    .game-btn:active {
      transform: translateY(4px);
      box-shadow: none !important;
    }
    
    .pop-in {
      animation: pop-in 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
    }
  `;

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

const Confetti = memo(function Confetti({ active }: { active: boolean }) {
  const [isReduced, setIsReduced] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setIsReduced(e.matches);
    q.addEventListener('change', handler);
    return () => q.removeEventListener('change', handler);
  }, []);

  const particles = useMemo(() => {
    const colors = ['#FCD34D', '#F87171', '#60A5FA', '#34D399', '#A78BFA', '#F472B6', '#FFFFFF'];
    return Array.from({ length: 80 }).map((_, i) => {
      const left = pseudoRandom((i + 1) * 12.9898) * 100;
      const delay = pseudoRandom((i + 1) * 78.233) * 1.5;
      const duration = 2.5 + pseudoRandom((i + 1) * 37.719) * 2;
      const bg = colors[Math.floor(pseudoRandom((i + 1) * 45.164) * colors.length)];
      const size = 6 + pseudoRandom((i + 1) * 93.989) * 8;
      const heightScale = pseudoRandom((i + 1) * 15.111) > 0.5 ? 1 : 0.4;
      
      return (
        <div
          key={i}
          className="fixed top-0 rounded-sm pointer-events-none z-[100] confetti-piece"
          style={{
            left: `${left}%`,
            width: `${size}px`,
            height: `${size * heightScale}px`,
            backgroundColor: bg,
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            animation: `confetti-fall ${duration}s ease-in ${delay}s both`,
          }}
        />
      );
    });
  }, []);

  if (!active || isReduced) return null;
  
  return <>{particles}</>;
});

const REEL_INDEXES = [0, 1, 2] as const;

function getWinMask(
  reels: [SlotSymbolId, SlotSymbolId, SlotSymbolId],
  payout: number,
  winType?: SlotWinType
): [boolean, boolean, boolean] {
  if (payout <= 0) return [false, false, false];

  const [a, b, c] = reels;

  if (
    winType === 'triple' ||
    winType === 'special_mix' ||
    winType === 'pair_with_diamond' ||
    winType === 'pair_with_seven'
  ) {
    return [true, true, true];
  }

  // 兼容旧记录（无 winType）：💎💎+7️⃣（任意顺序）
  const isSpecialMix =
    (a === 'diamond' && b === 'diamond' && c === 'seven') ||
    (a === 'diamond' && b === 'seven' && c === 'diamond') ||
    (a === 'seven' && b === 'diamond' && c === 'diamond');
  if (isSpecialMix) return [true, true, true];

  if (a === b && b === c) return [true, true, true];
  if (a === b) return [true, true, false];
  if (a === c) return [true, false, true];
  if (b === c) return [false, true, true];

  return [false, false, false];
}

function getRecordMode(record: SlotSpinRecord): SlotPlayMode {
  return record.mode ?? 'earn';
}

function getRecordDelta(record: SlotSpinRecord, fallbackBetCost: number): number {
  if (typeof record.pointsDelta === 'number') return record.pointsDelta;
  const mode = getRecordMode(record);
  if (mode === 'bet') return record.pointsEarned - (record.betCost ?? fallbackBetCost);
  return record.pointsEarned;
}

export default function SlotPage() {
  const router = useRouter();

  const symbolById = useMemo(() => {
    return SLOT_SYMBOLS.reduce((acc, s) => {
      acc[s.id] = s;
      return acc;
    }, {} as Record<SlotSymbolId, (typeof SLOT_SYMBOLS)[number]>);
  }, []);

  const randomSymbolId = useCallback((): SlotSymbolId => {
    const idx = Math.floor(Math.random() * SLOT_SYMBOLS.length);
    return SLOT_SYMBOLS[idx]!.id;
  }, []);

  const [status, setStatus] = useState<SlotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playMode, setPlayMode] = useState<SlotPlayMode>('earn');
  const [selectedBetCost, setSelectedBetCost] = useState<number>(SLOT_BET_OPTIONS[0]);
  const [ranking, setRanking] = useState<SlotRankingEntry[]>([]);
  const [rankingError, setRankingError] = useState(false);

  const [reels, setReels] = useState<[SlotSymbolId, SlotSymbolId, SlotSymbolId]>(INITIAL_REELS);
  const [reelTracks, setReelTracks] = useState<[SlotSymbolId[], SlotSymbolId[], SlotSymbolId[]]>(() => [
    [INITIAL_REELS[0]],
    [INITIAL_REELS[1]],
    [INITIAL_REELS[2]],
  ]);
  const [reelOffsets, setReelOffsets] = useState<[number, number, number]>([0, 0, 0]);
  const [itemHeightPx, setItemHeightPx] = useState(112);
  const [spinId, setSpinId] = useState(0);
  const [winMask, setWinMask] = useState<[boolean, boolean, boolean]>([false, false, false]);
  const [spinning, setSpinning] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  const [lastResult, setLastResult] = useState<SlotSpinRecord | null>(null);
  const [showLimitWarning, setShowLimitWarning] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [limitWarningAck, setLimitWarningAck] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (lastResult && lastResult.payout > 0) {
      setShowConfetti(true);
      const t = setTimeout(() => setShowConfetti(false), 5000);
      return () => clearTimeout(t);
    }
  }, [lastResult]);

  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);
  const spinRafRef = useRef<number | null>(null);
  const reelMeasureRef = useRef<HTMLDivElement | null>(null);
  const didInitBetCostRef = useRef(false);

  const cooldownRemainingMs = Math.max(0, cooldownUntil - now);
  const betModeEnabled = status?.config?.betModeEnabled ?? false;
  const fallbackBetCost = status?.config?.betCost ?? SLOT_BET_OPTIONS[0];

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/games/slot/status', { cache: 'no-store' });
      if (res.status === 401) {
        setStatus(null);
        setError('请先登录后再游玩');
        return;
      }

      const data = await res.json();
      if (data.success) {
        setStatus(data.data);
        if (typeof data.data?.cooldownRemaining === 'number' && data.data.cooldownRemaining > 0) {
          setCooldownUntil(Date.now() + data.data.cooldownRemaining);
        }
      } else {
        setError(data.message || '加载失败');
      }
    } catch (err) {
      console.error('Fetch slot status error:', err);
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRanking = useCallback(async () => {
    try {
      const res = await fetch('/api/games/slot/ranking?limit=10', { cache: 'no-store' });
      const data = await res.json();
      if (data.success) {
        setRanking(Array.isArray(data.data?.leaderboard) ? data.data.leaderboard : []);
        setRankingError(false);
      } else {
        setRankingError(true);
      }
    } catch {
      setRankingError(true);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (didInitBetCostRef.current) return;
    if (!status?.config) return;

    const configBetCost = status.config.betCost;
    if (
      typeof configBetCost === 'number' &&
      SLOT_BET_OPTIONS.includes(configBetCost as (typeof SLOT_BET_OPTIONS)[number])
    ) {
      setSelectedBetCost(configBetCost);
    }

    didInitBetCostRef.current = true;
  }, [status?.config]);

  useEffect(() => {
    fetchRanking();
    const t = setInterval(fetchRanking, 15000);
    return () => clearInterval(t);
  }, [fetchRanking]);

  useEffect(() => {
    if (playMode === 'bet' && status?.config && !status.config.betModeEnabled) {
      setPlayMode('earn');
    }
  }, [playMode, status?.config]);

  // 计算滚轴单格高度（用于 translate 像素值，避免 CSS calc 乘法兼容问题）
  useEffect(() => {
    const el = reelMeasureRef.current;
    if (!el) return;

    const measure = () => {
      const next = el.offsetHeight;
      if (Number.isFinite(next) && next > 0) {
        setItemHeightPx(next);
      }
    };

    // 首次渲染 / 字体加载后可能发生高度变化
    measure();
    const raf = requestAnimationFrame(measure);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      ro.observe(el);
    } else {
      window.addEventListener('resize', measure);
    }

    return () => {
      cancelAnimationFrame(raf);
      if (ro) {
        ro.disconnect();
      } else {
        window.removeEventListener('resize', measure);
      }
    };
  }, []);

  // 用于刷新倒计时（冷却/动画）
  useEffect(() => {
    if (spinning || cooldownRemainingMs > 0) {
      const t = setInterval(() => setNow(Date.now()), 100);
      return () => clearInterval(t);
    }
  }, [spinning, cooldownRemainingMs]);

  // 卸载清理
  useEffect(() => {
    return () => {
      if (spinRafRef.current !== null) {
        cancelAnimationFrame(spinRafRef.current);
        spinRafRef.current = null;
      }
      for (const t of timeoutsRef.current) clearTimeout(t);
      timeoutsRef.current = [];
    };
  }, []);

  const clearPendingAnimations = useCallback(() => {
    if (spinRafRef.current !== null) {
      cancelAnimationFrame(spinRafRef.current);
      spinRafRef.current = null;
    }
    for (const t of timeoutsRef.current) clearTimeout(t);
    timeoutsRef.current = [];
  }, []);

  const buildTrack = useCallback(
    (finalSymbolId: SlotSymbolId, length: number): SlotSymbolId[] => {
      const safeLength = Math.max(2, Math.floor(length));
      const track: SlotSymbolId[] = [];
      for (let i = 0; i < safeLength - 1; i++) {
        track.push(randomSymbolId());
      }
      track.push(finalSymbolId);
      return track;
    },
    [randomSymbolId]
  );

  const runReelAnimation = useCallback(
    async (finalReels: [SlotSymbolId, SlotSymbolId, SlotSymbolId]) => {
      clearPendingAnimations();
      setSpinId((v) => v + 1);

      // 兜底：开转前再测一次高度，避免移动端偶发测量不准导致图标被裁切/错位
      const el = reelMeasureRef.current;
      if (el) {
        const next = el.offsetHeight;
        if (Number.isFinite(next) && next > 0) {
          setItemHeightPx(next);
        }
      }

      const tracks: [SlotSymbolId[], SlotSymbolId[], SlotSymbolId[]] = [
        buildTrack(finalReels[0], REEL_TRACK_LENGTHS[0]),
        buildTrack(finalReels[1], REEL_TRACK_LENGTHS[1]),
        buildTrack(finalReels[2], REEL_TRACK_LENGTHS[2]),
      ];

      const endOffsets: [number, number, number] = [
        tracks[0].length - 1,
        tracks[1].length - 1,
        tracks[2].length - 1,
      ];

      setReelTracks(tracks);
      setReelOffsets([0, 0, 0]);

      await new Promise<void>((resolve) => {
        spinRafRef.current = requestAnimationFrame(() => {
          setReelOffsets(endOffsets);
          const done = setTimeout(resolve, Math.max(...REEL_DURATIONS_MS) + 150);
          timeoutsRef.current.push(done);
        });
      });
    },
    [buildTrack, clearPendingAnimations]
  );

  const handleSpin = useCallback(async (options?: { ignoreLimit?: boolean }) => {
    if (spinning) return;
    if (cooldownRemainingMs > 0) return;

    if (playMode === 'earn' && status?.pointsLimitReached && !limitWarningAck && !options?.ignoreLimit) {
      setShowLimitWarning(true);
      return;
    }

    setSpinning(true);
    setError(null);
    setLastResult(null);
    setWinMask([false, false, false]);
    setCooldownUntil(Date.now() + SLOT_SPIN_COOLDOWN_MS);

    try {
      const res = await fetch('/api/games/slot/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(playMode === 'bet' ? { mode: playMode, betCost: selectedBetCost } : { mode: playMode }),
      });
      const data = await res.json();

      if (res.status === 401) {
        setError('请先登录后再游玩');
        return;
      }

      if (!res.ok || !data.success) {
        const cooldown = typeof data.cooldownRemaining === 'number' ? data.cooldownRemaining : 0;
        if (cooldown > 0) setCooldownUntil(Date.now() + cooldown);
        setError(data.message || '旋转失败');
        return;
      }

      const record: SlotSpinRecord | undefined = data?.data?.record;
      if (!record || !Array.isArray(record.reels) || record.reels.length !== 3) {
        setError('系统错误：结果异常');
        return;
      }

      const finalReels = record.reels as [SlotSymbolId, SlotSymbolId, SlotSymbolId];

      // 等待滚动动画完成后再揭晓结果
      await runReelAnimation(finalReels);
      setReels(finalReels);
      setLastResult(record);
      setWinMask(getWinMask(finalReels, record.payout, record.winType));

      // 同步状态（余额/今日统计）
      setStatus((prev) => {
        const next = prev ? { ...prev } : null;
        if (!next) return prev;
        next.balance = data.data.newBalance;
        next.dailyStats = data.data.dailyStats;
        next.dailyLimit = data.data.dailyLimit;
        next.pointsLimitReached = data.data.pointsLimitReached;
        if (record) {
          next.records = [record, ...(next.records || [])].slice(0, 10);
        }
        return next;
      });
    } catch (err) {
      console.error('Spin error:', err);
      setError('网络错误');
    } finally {
      clearPendingAnimations();
      setSpinning(false);
      setNow(Date.now());
    }
  }, [
    spinning,
    cooldownRemainingMs,
    status?.pointsLimitReached,
    limitWarningAck,
    playMode,
    selectedBetCost,
    runReelAnimation,
    clearPendingAnimations,
  ]);

  const payoutText = useMemo(() => {
    if (!lastResult) return null;
    const mode = lastResult.mode ?? 'earn';

    if (mode === 'bet') {
      const betCost = lastResult.betCost ?? fallbackBetCost;
      const delta =
        typeof lastResult.pointsDelta === 'number' ? lastResult.pointsDelta : lastResult.pointsEarned - betCost;
      if (lastResult.payout <= 0) return `下注 ${betCost}，未中奖，净 -${betCost}`;
      const multText = typeof lastResult.multiplier === 'number' ? `（x${lastResult.multiplier}）` : '';
      return `下注 ${betCost}，中奖 +${lastResult.payout}${multText}，净 ${delta >= 0 ? `+${delta}` : String(delta)}`;
    }

    if (lastResult.payout <= 0) return '未中奖';
    if (lastResult.pointsEarned <= 0) return `中奖 +${lastResult.payout}，但今日已达积分上限`;
    return `中奖 +${lastResult.pointsEarned} 积分`;
  }, [lastResult, fallbackBetCost]);

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4 sm:py-10 selection:bg-yellow-300 selection:text-yellow-900 font-sans text-slate-800 overflow-x-hidden">
      <style>{ANIMATION_STYLES}</style>
      <Confetti active={showConfetti} />
      
      {/* Cartoon Background Pattern */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-sky-100 via-indigo-50 to-purple-100" />
        <div className="absolute inset-0 bg-[url('/noise.svg')] opacity-[0.03] mix-blend-multiply" />
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] bg-yellow-200/60 blur-[80px] rounded-full mix-blend-multiply animate-pulse" style={{ animationDuration: '4s' }} />
        <div className="absolute top-40 right-0 w-[500px] h-[500px] bg-pink-200/60 blur-[80px] rounded-full mix-blend-multiply" />
        <div className="absolute bottom-0 left-1/3 w-[800px] h-[600px] bg-blue-200/50 blur-[100px] rounded-full mix-blend-multiply" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto">
        {/* 顶部导航 */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => router.push('/games')}
            className="group flex items-center text-slate-600 hover:text-slate-900 transition-colors font-bold bg-white/70 px-5 py-2.5 rounded-2xl backdrop-blur-md border border-white/60 shadow-sm hover:shadow-md ring-1 ring-black/5 focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none"
          >
            <span className="mr-2 group-hover:-translate-x-1 transition-transform">←</span>
            游戏中心
          </button>

          <Link
            href="/store"
            className="flex items-center gap-2 bg-white/80 backdrop-blur-md px-6 py-2.5 rounded-2xl shadow-sm border border-white/60 ring-1 ring-black/5 hover:ring-yellow-400 hover:bg-white hover:scale-105 transition-all group focus-visible:ring-2 focus-visible:ring-yellow-500 outline-none"
          >
            <span className="text-yellow-500 text-lg filter drop-shadow-sm">⭐</span>
            <span className="font-extrabold text-slate-800 text-lg tabular-nums tracking-tight">{loading ? '...' : status?.balance ?? 0}</span>
            <div className="w-px h-4 bg-slate-300 mx-2" />
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide group-hover:text-yellow-600 transition-colors">商店</span>
          </Link>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-8 p-4 bg-rose-50 backdrop-blur border border-rose-200 rounded-2xl text-rose-600 text-center shadow-md animate-pop-in">
            <span className="font-bold">错误:</span> {error}{' '}
            {error.includes('登录') && (
              <button
                onClick={() => router.push('/login?redirect=/games/slot')}
                className="ml-2 font-bold underline hover:no-underline hover:text-rose-800 focus-visible:ring-2 focus-visible:ring-rose-500 rounded outline-none"
              >
                去登录
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] xl:grid-cols-[360px_1fr_360px] gap-6 lg:gap-8 items-start">
          
          {/* Left Column (Desktop): History */}
          {/* Mobile: Order 3 (Bottom) */}
          <div className="order-3 lg:order-1 space-y-6">
            <div className="cartoon-panel p-6 relative overflow-hidden">
              <div className="flex items-center justify-between mb-4 relative z-10">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400 ring-2 ring-blue-100"></span>
                  历史记录
                </h3>
                <button
                  onClick={fetchStatus}
                  className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none"
                  aria-label="刷新记录"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
                </button>
              </div>

              <div className="space-y-2 max-h-[500px] lg:max-h-[600px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-indigo-100 scrollbar-track-transparent relative z-10">
                {(status?.records?.length ?? 0) === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-xs italic font-medium">
                    暂无游戏记录
                  </div>
                ) : (
                  status?.records?.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between p-2.5 rounded-2xl border-2 border-transparent hover:border-indigo-100 hover:bg-white/60 transition-all group"
                    >
                      <div className="flex items-center gap-1.5 text-lg group-hover:scale-105 transition-transform origin-left">
                        {r.reels.map((id, i) => (
                          <span key={`${r.id}-${id}-${i}`} className="filter drop-shadow-sm">{symbolById[id].emoji}</span>
                        ))}
                      </div>
                      <div className="text-right">
                        <div
                          className={`text-sm font-black ${
                            getRecordDelta(r, fallbackBetCost) > 0
                              ? 'text-emerald-500'
                              : getRecordDelta(r, fallbackBetCost) < 0
                                ? 'text-rose-500'
                                : 'text-slate-400'
                          }`}
                        >
                          {getRecordDelta(r, fallbackBetCost) > 0
                            ? `+${getRecordDelta(r, fallbackBetCost)}`
                            : `${getRecordDelta(r, fallbackBetCost)}`}
                        </div>
                        <div className="text-[10px] text-slate-400 font-bold flex items-center justify-end gap-2 mt-0.5">
                          <span
                            className={`px-1.5 py-0.5 rounded-md border ${
                              getRecordMode(r) === 'bet'
                                ? 'bg-rose-50 text-rose-500 border-rose-100'
                                : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                            }`}
                          >
                            {getRecordMode(r) === 'bet' ? '挑战' : '赚'}
                          </span>
                          <span>
                            {new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Center Column (Desktop): Slot Machine */}
          {/* Mobile: Order 1 (Top) */}
          <div className="order-1 lg:order-2 bg-indigo-500 rounded-[3rem] p-6 sm:p-8 shadow-2xl border-b-[12px] border-r-[8px] border-indigo-700 relative overflow-hidden isolate">
            {/* Glossy Overlay */}
            <div className="absolute inset-0 z-0 bg-gradient-to-br from-indigo-400 to-indigo-600" />
            <div className="absolute top-2 left-4 right-4 h-4 bg-white/20 rounded-full blur-[2px]" />
            
            <div className="relative z-10 flex flex-col h-full">
              {/* Header */}
              <div className="flex items-center justify-between gap-4 mb-8 px-2">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-200 mb-1 drop-shadow-sm">Classic Slot</div>
                  <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-2 drop-shadow-md" style={{ textShadow: '0 2px 0 rgba(0,0,0,0.2)' }}>
                    幸运转盘
                  </h1>
                </div>
                <div className="text-right bg-indigo-800/50 rounded-xl px-4 py-2 border border-indigo-400/30 shadow-inner">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-200 mb-0.5">Status</div>
                  <div className={`text-sm font-mono font-bold ${cooldownRemainingMs > 0 ? 'text-yellow-300 animate-pulse' : 'text-emerald-300 drop-shadow-sm'}`}>
                    {cooldownRemainingMs > 0 ? `${(cooldownRemainingMs / 1000).toFixed(1)}s` : 'READY'}
                  </div>
                </div>
              </div>

              {/* 转轴显示区 - Machine Display */}
              <div className="bg-sky-200 rounded-3xl p-4 sm:p-5 shadow-[inset_0_4px_8px_rgba(0,0,0,0.15)] ring-4 ring-indigo-300 relative overflow-hidden group mb-8 border-b-8 border-sky-300">
                {/* Pattern Background */}
                <div className="absolute inset-0 opacity-30 bg-[radial-gradient(#38bdf8_3px,transparent_3px)] [background-size:20px_20px]" />
                
                <div className="grid grid-cols-3 gap-3 sm:gap-4 relative z-10">
                  {REEL_INDEXES.map((idx) => {
                    const highlight = !spinning && winMask[idx];
                    const track = reelTracks[idx] ?? [reels[idx]];
                    const offset = reelOffsets[idx] ?? 0;
                    
                    return (
                      <div
                        key={`reel-${idx}`}
                        className={`relative rounded-xl overflow-hidden transform transition-all duration-500 bg-white border-2 ${
                          highlight 
                            ? 'z-10 scale-[1.02] border-yellow-400 shadow-[0_0_0_4px_rgba(250,204,21,0.5)]' 
                            : 'border-sky-100 shadow-sm'
                        }`}
                      >
                        {/* Reel Background */}
                        <div className="absolute inset-0 bg-white z-0" />
                        
                        {/* Reel Content */}
                        <div className="relative bg-transparent z-10">
                          <div
                            ref={idx === 0 ? reelMeasureRef : undefined}
                            className="relative h-28 sm:h-36 overflow-hidden"
                          >
                            <div
                              key={`track-${spinId}-${idx}`}
                              className={`transform-gpu will-change-transform flex flex-col items-center w-full ${
                                spinning ? 'blur-[1px]' : !spinning && offset === 0 ? 'reel-bounce' : ''
                              }`}
                              style={{
                                transform: `translate3d(0, ${-offset * itemHeightPx}px, 0)`,
                                transitionDuration: `${REEL_DURATIONS_MS[idx]}ms`,
                                transitionTimingFunction: REEL_EASING,
                              }}
                            >
                              {track.map((symbolId, i) => (
                                <div
                                  key={`${spinId}-${idx}-${i}-${symbolId}`}
                                  className={`h-28 sm:h-36 w-full flex items-center justify-center select-none transition-all duration-300 ${
                                    highlight && i === track.length - 1 ? 'symbol-win scale-110' : 'opacity-100'
                                  }`}
                                >
                                  <span className="text-6xl sm:text-7xl filter drop-shadow-sm transform transition-transform cursor-default">
                                    {symbolById[symbolId].emoji}
                                  </span>
                                </div>
                              ))}
                            </div>

                            {/* Inner Shadows for Depth */}
                            <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-black/10 to-transparent z-20" />
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/10 to-transparent z-20" />
                          </div>

                          {/* Reel Label */}
                          <div className={`text-center py-1.5 border-t-2 border-slate-100 transition-colors duration-300 ${
                              highlight ? 'bg-yellow-50 text-yellow-700' : 'bg-slate-50 text-slate-400'
                          }`}>
                            <div className="text-[10px] font-black uppercase tracking-wider">
                              {spinning ? '•••' : symbolById[reels[idx]].name}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Payline Indicators - Cute Triangles */}
                <div className="absolute top-1/2 left-0 w-0 h-0 border-t-[8px] border-t-transparent border-l-[12px] border-l-yellow-400 border-b-[8px] border-b-transparent -translate-y-1/2 drop-shadow-md z-20" />
                <div className="absolute top-1/2 right-0 w-0 h-0 border-t-[8px] border-t-transparent border-r-[12px] border-r-yellow-400 border-b-[8px] border-b-transparent -translate-y-1/2 drop-shadow-md z-20" />
              </div>

              {/* Status & Win Message */}
              <div className="relative mb-8 px-2">
                 <div
                  className={`relative overflow-hidden rounded-2xl border-2 px-6 py-5 text-center transition-all duration-500 shadow-sm ${
                    lastResult
                      ? lastResult.payout > 0
                        ? 'bg-yellow-50 border-yellow-300'
                        : 'bg-indigo-800/30 border-indigo-400/30'
                      : 'bg-indigo-800/20 border-indigo-400/20'
                  }`}
                >
                  <div className={`text-lg font-bold flex items-center justify-center gap-3 ${
                     lastResult && lastResult.payout > 0 ? 'text-yellow-600' : 'text-indigo-100'
                  }`}>
                    {lastResult && lastResult.payout > 0 && <span className="animate-bounce">🎉</span>}
                    <span className="tracking-wide drop-shadow-sm">{payoutText ?? '准备就绪，祝君好运'}</span>
                    {lastResult && lastResult.payout > 0 && <span className="animate-bounce">🎉</span>}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-auto px-2">
                <div className="mb-6 flex items-center justify-center">
                  <div className="inline-flex rounded-2xl bg-indigo-800/40 p-1.5 ring-1 ring-white/10 shadow-inner">
                    <button
                      type="button"
                      onClick={() => setPlayMode('earn')}
                      className={`px-5 py-2.5 rounded-xl text-xs font-black tracking-wider transition-all focus-visible:ring-2 focus-visible:ring-white outline-none ${
                        playMode === 'earn'
                          ? 'bg-white text-indigo-600 shadow-md transform scale-105'
                          : 'text-indigo-200 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      赚积分
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlayMode('bet')}
                      disabled={!betModeEnabled}
                      className={`px-5 py-2.5 rounded-xl text-xs font-black tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-rose-300 outline-none ${
                        playMode === 'bet'
                          ? 'bg-rose-500 text-white shadow-md transform scale-105'
                          : 'text-indigo-200 hover:text-white hover:bg-white/10'
                      }`}
                      title={betModeEnabled ? '' : '管理员未开启挑战模式'}
                    >
                      挑战模式
                    </button>
                  </div>
                </div>

                {playMode === 'bet' && (
                  <div className="mb-6 space-y-3">
                    <div className="flex items-center justify-center">
                      <div className="inline-flex flex-wrap justify-center gap-2 rounded-2xl bg-indigo-800/40 p-2 ring-1 ring-white/10">
                        {SLOT_BET_OPTIONS.map((opt) => {
                          const active = selectedBetCost === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setSelectedBetCost(opt)}
                              disabled={spinning || cooldownRemainingMs > 0}
                              className={`w-12 h-10 rounded-xl text-xs font-black tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-rose-300 outline-none ${
                                active 
                                  ? 'bg-rose-500 text-white shadow-md transform scale-110' 
                                  : 'text-indigo-200 hover:text-white hover:bg-white/10'
                              }`}
                              aria-label={`Bet ${opt}`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => handleSpin()}
                  disabled={loading || spinning || cooldownRemainingMs > 0 || (playMode === 'bet' && !betModeEnabled)}
                  className="game-btn group relative w-full h-24 rounded-3xl font-black text-2xl tracking-[0.1em] text-white overflow-hidden
                  disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none focus-visible:ring-4 focus-visible:ring-yellow-300 outline-none"
                >
                  <div className="absolute inset-0 bg-gradient-to-b from-yellow-400 to-orange-500 shadow-[inset_0_4px_4px_rgba(255,255,255,0.4),0_8px_0_#c2410c] group-active:shadow-[inset_0_4px_8px_rgba(0,0,0,0.2)] group-active:translate-y-[8px] transition-all rounded-3xl"></div>
                  
                  {/* Stripes Pattern on Button */}
                  <div className="absolute inset-0 opacity-10 bg-[linear-gradient(45deg,transparent_25%,#000_25%,#000_50%,transparent_50%,transparent_75%,#000_75%,#000_100%)] [background-size:20px_20px] rounded-3xl pointer-events-none" />

                  <div className="absolute inset-0 btn-shine opacity-0 group-hover:opacity-100 transition-opacity rounded-3xl"></div>
                  
                  <div className="relative flex flex-col items-center justify-center h-full pb-2 group-active:translate-y-[8px] transition-all">
                    {spinning ? (
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 border-[4px] border-white/40 border-t-white rounded-full animate-spin" />
                        <span className="text-xl drop-shadow-md">转动中...</span>
                      </div>
                    ) : (
                      <>
                        <span className="drop-shadow-md text-3xl">SPIN!</span>
                        <span className="text-[10px] opacity-80 font-bold uppercase tracking-widest">Start Game</span>
                      </>
                    )}
                  </div>
                </button>
                <div className="text-center mt-4 text-[10px] uppercase tracking-wider text-indigo-200 font-bold opacity-60">
                  {cooldownRemainingMs > 0 ? 'COOLDOWN ACTIVE' : 'PROVABLY FAIR • RANDOM GENERATED'}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column (Desktop): Status & Payouts */}
          {/* Mobile: Order 2 (Middle) */}
          <div className="order-2 lg:order-3 space-y-6">
             {/* 今日统计 - Card Style */}
              {status?.dailyStats && (
                <div className="cartoon-panel p-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-100 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-2 relative z-10">
                    <span className="w-2 h-2 rounded-full bg-indigo-400 ring-2 ring-indigo-100"></span>
                    今日统计
                  </h3>
                  
                  <div className="grid grid-cols-2 gap-4 relative z-10">
                    <div className="bg-white/60 rounded-2xl p-4 border border-indigo-50 shadow-sm">
                      <div className="text-xs text-slate-500 font-bold mb-1">已玩</div>
                      <div className="text-2xl font-black text-slate-800">
                        {status.dailyStats.gamesPlayed}
                        <span className="text-sm font-bold text-slate-400 ml-1">局</span>
                      </div>
                    </div>
                    
                    <div className={`rounded-2xl p-4 border shadow-sm ${status.pointsLimitReached ? 'bg-orange-50 border-orange-100' : 'bg-emerald-50 border-emerald-100'}`}>
                      <div className={`text-xs font-bold mb-1 ${status.pointsLimitReached ? 'text-orange-500' : 'text-emerald-500'}`}>积分</div>
                      <div className={`text-2xl font-black ${status.pointsLimitReached ? 'text-orange-600' : 'text-emerald-600'}`}>
                        {status.dailyStats.pointsEarned}
                      <span className="text-xs font-bold opacity-60 ml-1 text-slate-500">/ {status.dailyLimit ?? 2000}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 今日排行榜 */}
            <div className="cartoon-panel p-6 relative overflow-hidden">
              <div className="flex items-center justify-between mb-4 relative z-10">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-emerald-100"></span>
                  今日排行榜
                </h3>
                <button
                  onClick={fetchRanking}
                  className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500 outline-none"
                  aria-label="刷新排行榜"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
                </button>
              </div>

              <div className="text-[11px] text-slate-400 font-medium mb-3 relative z-10">
                统计口径：净赢分（仅累计正净赢分）
              </div>

              {ranking.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs bg-slate-50 rounded-2xl border border-slate-100 relative z-10 font-medium">
                  暂无上榜记录
                </div>
              ) : (
                <div className="space-y-2 relative z-10">
                  {ranking.map((entry, idx) => {
                    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '•';
                    return (
                      <div
                        key={`${entry.userId}-${idx}`}
                        className="flex items-center justify-between gap-3 p-2.5 rounded-2xl bg-white/40 border border-transparent hover:border-emerald-100 hover:bg-white/80 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-sm font-black text-slate-500 shrink-0 shadow-sm">
                            {medal}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-slate-700 truncate">
                              {entry.username}
                            </div>
                            <div className="text-[10px] text-slate-400 font-medium">#{idx + 1}</div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-black text-emerald-500 tabular-nums">+{entry.score}</div>
                          <div className="text-[10px] text-slate-400 font-medium">分</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {rankingError && (
                <div className="mt-3 text-xs text-rose-500 relative z-10 font-medium">排行榜加载失败</div>
              )}
            </div>

            {/* 规则与倍率 */}
            <div className="cartoon-panel p-6 relative overflow-hidden">
              <div className="absolute top-10 right-0 w-40 h-40 bg-pink-100 rounded-full blur-3xl translate-x-1/2" />
              <div className="flex items-center justify-between mb-4 relative z-10">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-pink-400 ring-2 ring-pink-100"></span>
                  规则与倍率
                </h3>
                <button
                  type="button"
                  onClick={() => setShowRules(true)}
                  className="text-[10px] font-black bg-white border border-slate-200 text-slate-500 px-3 py-1.5 rounded-full hover:bg-pink-50 hover:text-pink-600 hover:border-pink-200 transition-colors focus-visible:ring-2 focus-visible:ring-pink-500 outline-none"
                >
                  规则
                </button>
              </div>

              <div className="text-[11px] text-slate-400 font-medium mb-3 relative z-10">
                赚积分：{SLOT_EARN_BASE}×倍率；挑战模式：返奖=下注×倍率
              </div>

              <div className="space-y-2 relative z-10">
                {SLOT_SYMBOLS.map((s) => (
                  <div
                    key={s.id}
                    className="group flex items-center justify-between gap-3 p-2 hover:bg-white/60 rounded-2xl transition-colors cursor-default border border-transparent hover:border-pink-100"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 flex items-center justify-center bg-white rounded-xl text-2xl group-hover:scale-110 transition-transform shadow-sm border border-slate-100 shrink-0">
                        {s.emoji}
                      </div>
                      <span className="text-xs font-bold text-slate-500 truncate group-hover:text-slate-800 transition-colors">{s.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="text-[10px] font-black text-slate-400 bg-slate-50 border border-slate-100 px-2 py-1 rounded-lg tabular-nums group-hover:text-slate-600 group-hover:border-slate-200">
                        二连 x{SLOT_PAIR_MULTIPLIERS[s.id].toFixed(1)}
                      </div>
                      <div className="text-[10px] font-black text-slate-400 bg-slate-50 border border-slate-100 px-2 py-1 rounded-lg tabular-nums group-hover:text-slate-600 group-hover:border-slate-200">
                        三连 x{SLOT_TRIPLE_MULTIPLIERS[s.id]}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 space-y-1 text-xs text-slate-400 font-medium relative z-10">
                <div>二连 +💎 加成：+{SLOT_PAIR_BONUS_WITH_DIAMOND.toFixed(1)}</div>
                <div>二连 +7️⃣ 加成：+{SLOT_PAIR_BONUS_WITH_SEVEN.toFixed(1)}</div>
                <div>特殊爆：💎💎+7️⃣ x{SLOT_SPECIAL_MIX_DIAMOND_DIAMOND_SEVEN_MULTIPLIER}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 积分上限提示 - Styled Modal */}
      {showLimitWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-indigo-900/20 backdrop-blur-sm" onClick={() => setShowLimitWarning(false)} />
          <div 
            className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden ring-1 ring-black/5 animate-[bounce-land_0.5s_ease-out] outline-none"
            role="dialog"
            aria-modal="true"
            aria-labelledby="limit-modal-title"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowLimitWarning(false);
            }}
          >
            <div className="bg-orange-50 p-6 border-b border-orange-100 text-center">
              <div className="text-4xl mb-3">⚠️</div>
              <h3 id="limit-modal-title" className="text-xl font-black text-slate-800">今日积分已达上限</h3>
              <p className="text-sm text-slate-500 mt-2 font-medium">
                您已达到今日积分上限，继续游戏将不再获得积分，直到明天重置。
              </p>
            </div>
            
            <div className="p-6 grid grid-cols-2 gap-3 bg-white">
              <button
                onClick={() => setShowLimitWarning(false)}
                className="py-3 px-4 rounded-xl font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors focus-visible:ring-2 focus-visible:ring-slate-400 outline-none"
              >
                取消
              </button>
              <button
                onClick={() => {
                  setLimitWarningAck(true);
                  setShowLimitWarning(false);
                  handleSpin({ ignoreLimit: true });
                }}
                className="py-3 px-4 rounded-xl bg-indigo-500 text-white font-bold hover:bg-indigo-600 shadow-md shadow-indigo-200 transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-indigo-500 outline-none"
                autoFocus
              >
                继续娱乐
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 规则说明 - Modal */}
      {showRules && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-indigo-900/20 backdrop-blur-sm" onClick={() => setShowRules(false)} />
          <div 
            className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden ring-1 ring-black/5 outline-none"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rules-modal-title"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowRules(false);
            }}
          >
            <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4 bg-slate-50/50">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Rules</div>
                <h3 id="rules-modal-title" className="text-xl font-black text-slate-800">老虎机规则说明</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowRules(false)}
                className="w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors font-black flex items-center justify-center focus-visible:ring-2 focus-visible:ring-slate-400 outline-none shadow-sm"
                aria-label="Close rules"
                autoFocus
              >
                ✕
              </button>
            </div>

            <div className="p-6 max-h-[70vh] overflow-y-auto space-y-6 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
              <div className="space-y-2">
                <div className="text-xs font-black uppercase tracking-wider text-indigo-500">玩法模式</div>
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 space-y-2">
                  <div className="text-sm text-slate-600 leading-relaxed">
                    <span className="font-bold text-slate-800">赚积分：</span>
                    免费旋转，中奖获得 <span className="font-bold tabular-nums text-emerald-500">{SLOT_EARN_BASE}</span> × 倍率 积分（受每日积分上限限制）。
                  </div>
                  <div className="text-sm text-slate-600 leading-relaxed border-t border-slate-200 pt-2">
                    <span className="font-bold text-slate-800">挑战模式：</span>
                    选择下注档位 <span className="font-bold tabular-nums text-rose-500">{SLOT_BET_OPTIONS.join(' / ')}</span>。
                    返奖=下注×倍率，净赢分=返奖-下注。
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-black uppercase tracking-wider text-indigo-500">判定顺序（不叠加）</div>
                <ul className="text-sm text-slate-600 space-y-2 list-disc pl-4 marker:text-indigo-400">
                  <li>三连（AAA）</li>
                  <li>
                    特殊爆：<span className="font-bold text-slate-800">💎💎+7️⃣</span>（任意顺序）倍率 x{SLOT_SPECIAL_MIX_DIAMOND_DIAMOND_SEVEN_MULTIPLIER}
                  </li>
                  <li>二连 + 7️⃣：在二连倍率基础上 +{SLOT_PAIR_BONUS_WITH_SEVEN.toFixed(1)}</li>
                  <li>二连 + 💎：在二连倍率基础上 +{SLOT_PAIR_BONUS_WITH_DIAMOND.toFixed(1)}</li>
                  <li>普通二连（任意两格相同）</li>
                </ul>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-black uppercase tracking-wider text-indigo-500">倍率表</div>
                <div className="grid grid-cols-1 gap-2">
                  {SLOT_SYMBOLS.map((s) => (
                    <div
                      key={`rule-${s.id}`}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-xl shrink-0 shadow-sm">
                          {s.emoji}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-slate-700">{s.name}</div>
                          <div className="text-[10px] text-slate-400">权重 {s.weight}%</div>
                        </div>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <div className="text-[10px] font-bold text-slate-400 tabular-nums">
                          二连 x<span className="text-slate-600">{SLOT_PAIR_MULTIPLIERS[s.id].toFixed(1)}</span>
                        </div>
                        <div className="text-[10px] font-bold text-slate-400 tabular-nums">
                          三连 x<span className="text-yellow-600">{SLOT_TRIPLE_MULTIPLIERS[s.id]}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-black uppercase tracking-wider text-slate-400">公平性</div>
                <div className="text-xs text-slate-500 leading-relaxed">
                  每次旋转由服务端按权重随机生成结果，客户端动画仅用于展示；最终积分结算以服务端为准。
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowRules(false)}
                className="px-6 py-2.5 rounded-2xl font-black bg-gradient-to-b from-sky-400 to-sky-600 text-white shadow-[0_4px_0_#0ea5e9] active:shadow-none active:translate-y-[4px] hover:brightness-110 transition-all focus-visible:ring-4 focus-visible:ring-sky-300 outline-none border-2 border-white"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
