'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  SLOT_SPIN_COOLDOWN_MS,
  SLOT_SYMBOLS,
  SLOT_TWO_OF_KIND_PAYOUT,
  type SlotSymbolId,
} from '@/lib/slot-constants';

interface SlotSpinRecord {
  id: string;
  reels: SlotSymbolId[];
  payout: number;
  pointsEarned: number;
  createdAt: number;
}

interface SlotStatus {
  balance: number;
  dailyStats: { gamesPlayed: number; pointsEarned: number } | null;
  inCooldown: boolean;
  cooldownRemaining: number; // ms
  dailyLimit: number;
  pointsLimitReached: boolean;
  records: SlotSpinRecord[];
}

const INITIAL_REELS: [SlotSymbolId, SlotSymbolId, SlotSymbolId] = [
  SLOT_SYMBOLS[0]!.id,
  SLOT_SYMBOLS[1]!.id,
  SLOT_SYMBOLS[2]!.id,
];

const REEL_TRACK_LENGTHS: [number, number, number] = [18, 22, 26];
const REEL_DURATIONS_MS: [number, number, number] = [900, 1100, 1300];
const REEL_EASING = 'cubic-bezier(0.12, 0.82, 0.18, 1)';
const REEL_INDEXES = [0, 1, 2] as const;

function getWinMask(
  reels: [SlotSymbolId, SlotSymbolId, SlotSymbolId],
  payout: number
): [boolean, boolean, boolean] {
  if (payout <= 0) return [false, false, false];

  const [a, b, c] = reels;

  if (a === b && b === c) return [true, true, true];
  if (a === b) return [true, true, false];
  if (a === c) return [true, false, true];
  if (b === c) return [false, true, true];

  return [false, false, false];
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

  const [reels, setReels] = useState<[SlotSymbolId, SlotSymbolId, SlotSymbolId]>(INITIAL_REELS);
  const [reelTracks, setReelTracks] = useState<[SlotSymbolId[], SlotSymbolId[], SlotSymbolId[]]>(() => [
    [INITIAL_REELS[0]],
    [INITIAL_REELS[1]],
    [INITIAL_REELS[2]],
  ]);
  const [reelOffsets, setReelOffsets] = useState<[number, number, number]>([0, 0, 0]);
  const [itemHeightPx, setItemHeightPx] = useState(96);
  const [spinId, setSpinId] = useState(0);
  const [winMask, setWinMask] = useState<[boolean, boolean, boolean]>([false, false, false]);
  const [spinning, setSpinning] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  const [lastResult, setLastResult] = useState<SlotSpinRecord | null>(null);
  const [showLimitWarning, setShowLimitWarning] = useState(false);
  const [limitWarningAck, setLimitWarningAck] = useState(false);

  const timeoutsRef = useRef<NodeJS.Timeout[]>([]);
  const spinRafRef = useRef<number | null>(null);
  const reelMeasureRef = useRef<HTMLDivElement | null>(null);

  const cooldownRemainingMs = Math.max(0, cooldownUntil - now);

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

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // 计算滚轴单格高度（用于 translate 像素值，避免 CSS calc 乘法兼容问题）
  useEffect(() => {
    const measure = () => {
      const el = reelMeasureRef.current;
      if (!el) return;
      const h = el.getBoundingClientRect().height;
      if (Number.isFinite(h) && h > 0) {
        setItemHeightPx(h);
      }
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
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
          const done = setTimeout(resolve, Math.max(...REEL_DURATIONS_MS) + 80);
          timeoutsRef.current.push(done);
        });
      });
    },
    [buildTrack, clearPendingAnimations]
  );

  const handleSpin = useCallback(async (options?: { ignoreLimit?: boolean }) => {
    if (spinning) return;
    if (cooldownRemainingMs > 0) return;

    if (status?.pointsLimitReached && !limitWarningAck && !options?.ignoreLimit) {
      setShowLimitWarning(true);
      return;
    }

    setSpinning(true);
    setError(null);
    setLastResult(null);
    setWinMask([false, false, false]);
    setCooldownUntil(Date.now() + SLOT_SPIN_COOLDOWN_MS);

    try {
      const res = await fetch('/api/games/slot/spin', { method: 'POST' });
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
      setWinMask(getWinMask(finalReels, record.payout));

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
    runReelAnimation,
    clearPendingAnimations,
  ]);

  const payoutText = useMemo(() => {
    if (!lastResult) return null;
    if (lastResult.payout <= 0) return '未中奖';
    if (lastResult.pointsEarned <= 0) return `中奖 +${lastResult.payout}，但今日已达积分上限（本次未发放）`;
    return `中奖 +${lastResult.pointsEarned} 积分`;
  }, [lastResult]);

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4 sm:py-10">
      <div className="max-w-6xl mx-auto">
        {/* 顶部导航 */}
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <button
            onClick={() => router.push('/games')}
            className="group flex items-center text-slate-500 hover:text-slate-800 transition-colors font-medium"
          >
            <span className="mr-2 group-hover:-translate-x-1 transition-transform">←</span>
            游戏中心
          </button>

          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2">
            <span className="text-3xl">🎰</span> 老虎机
          </h1>

          <Link
            href="/store"
            className="flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm border border-slate-200 text-slate-700 hover:border-yellow-400 hover:text-yellow-600 transition-all group"
          >
            <span className="text-yellow-500">⭐</span>
            <span className="font-bold">{loading ? '...' : status?.balance ?? 0}</span>
            <span className="text-slate-300 group-hover:text-yellow-400 transition-colors">→</span>
          </Link>
        </div>

        {/* 今日统计 */}
        {status?.dailyStats && (
          <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-slate-100 mb-6">
            <div className="flex items-center justify-center gap-8">
              <div className="text-center">
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">今日游戏</div>
                <div className="text-xl font-bold text-slate-900">
                  {status.dailyStats.gamesPlayed} <span className="text-sm font-normal text-slate-500">局</span>
                </div>
              </div>
              <div className="w-px h-10 bg-slate-200" />
              <div className="text-center">
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">今日积分</div>
                <div className={`text-xl font-bold ${status.pointsLimitReached ? 'text-orange-500' : 'text-green-600'}`}>
                  {status.dailyStats.pointsEarned} <span className="text-slate-300">/</span>{' '}
                  <span className="text-sm font-normal text-slate-500">{status.dailyLimit ?? 2000}</span>
                  {status.pointsLimitReached && (
                    <span className="block text-xs text-orange-500 font-medium mt-1">已达上限</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-center">
            {error}{' '}
            {error.includes('登录') && (
              <button
                onClick={() => router.push('/login?redirect=/games/slot')}
                className="ml-2 font-bold underline hover:no-underline"
              >
                去登录
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          {/* 左侧：老虎机主体 */}
          <div className="bg-white rounded-3xl p-5 sm:p-7 shadow-xl border border-slate-100 relative overflow-hidden">
            <div className="absolute -top-24 -right-24 w-64 h-64 bg-gradient-to-br from-yellow-50 to-orange-50 rounded-full blur-2xl opacity-70" />
            <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-gradient-to-br from-slate-50 to-slate-100 rounded-full blur-2xl opacity-70" />

            <div className="relative">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Lucky Spin</div>
                  <div className="text-xl font-extrabold text-slate-900">转动幸运符号</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Cooldown</div>
                  <div className={`text-sm font-bold ${cooldownRemainingMs > 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                    {cooldownRemainingMs > 0 ? `${(cooldownRemainingMs / 1000).toFixed(1)}s` : 'Ready'}
                  </div>
                </div>
              </div>

              {/* 转轴显示 */}
              <div className="bg-slate-900 rounded-3xl p-4 sm:p-6 shadow-2xl shadow-slate-200 ring-4 ring-slate-100">
                <div className="grid grid-cols-3 gap-3 sm:gap-4">
                  {REEL_INDEXES.map((idx) => {
                    const highlight = !spinning && winMask[idx];
                    const track = reelTracks[idx] ?? [reels[idx]];
                    const offset = reelOffsets[idx] ?? 0;

                    return (
                      <div
                        key={`reel-${idx}`}
                        className={`relative bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden ${
                          highlight ? 'ring-2 ring-green-300 shadow-[0_0_0_4px_rgba(34,197,94,0.15)]' : ''
                        }`}
                      >
                        <div className="relative">
                          <div
                            ref={idx === 0 ? reelMeasureRef : undefined}
                            className="relative h-24 sm:h-28 overflow-hidden"
                          >
                            <div
                              key={`track-${spinId}-${idx}`}
                              className={`transform-gpu will-change-transform transition-transform ${
                                spinning ? 'blur-[1px]' : 'blur-0'
                              } transition-[filter]`}
                              style={{
                                transform: `translate3d(0, ${-offset * itemHeightPx}px, 0)`,
                                transitionDuration: `${REEL_DURATIONS_MS[idx]}ms`,
                                transitionTimingFunction: REEL_EASING,
                              }}
                            >
                              {track.map((symbolId, i) => (
                                <div
                                  key={`${spinId}-${idx}-${i}-${symbolId}`}
                                  className="h-24 sm:h-28 flex items-center justify-center text-5xl sm:text-6xl select-none"
                                >
                                  {symbolById[symbolId].emoji}
                                </div>
                              ))}
                            </div>

                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/70 via-transparent to-white/70" />
                            <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-white/80 to-transparent" />
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-white/80 to-transparent" />
                          </div>

                          <div className="px-3 pb-3 -mt-2 text-center">
                            <div className={`text-[11px] font-bold ${spinning ? 'text-slate-300' : 'text-slate-500'}`}>
                              {spinning ? 'Rolling' : symbolById[reels[idx]].name}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 结果提示 */}
              <div className="mt-5">
                <div
                  className={`rounded-2xl border px-4 py-3 text-sm font-medium ${
                    lastResult
                      ? lastResult.payout > 0
                        ? 'bg-green-50 border-green-200 text-green-700'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                      : 'bg-slate-50 border-slate-200 text-slate-500'
                  }`}
                >
                  {payoutText ?? '点击下方按钮开始旋转。三连更高奖励，二连也有保底！'}
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="mt-5 flex flex-col gap-3">
                <button
                  onClick={() => handleSpin()}
                  disabled={loading || spinning || cooldownRemainingMs > 0}
                  className="w-full py-4 rounded-2xl font-extrabold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center gap-2"
                >
                  {spinning ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      旋转中...
                    </>
                  ) : (
                    'SPIN'
                  )}
                </button>
                <div className="text-center text-xs text-slate-400">
                  {cooldownRemainingMs > 0 ? '冷却中，稍后再试' : '每次旋转将产生随机结果（服务端判定）'}
                </div>
              </div>

              {/* 赔率说明 */}
              <div className="mt-6 border-t border-slate-100 pt-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400">赔率说明</div>
                  <div className="text-xs text-slate-400">二连保底：+{SLOT_TWO_OF_KIND_PAYOUT}</div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {SLOT_SYMBOLS.map((s) => (
                    <div
                      key={s.id}
                      className="bg-slate-50 rounded-2xl border border-slate-100 px-3 py-2 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <div className="text-xl">{s.emoji}</div>
                        <div>
                          <div className="text-xs font-bold text-slate-700">{s.name}</div>
                          <div className="text-[11px] text-slate-400">三连</div>
                        </div>
                      </div>
                      <div className="text-sm font-extrabold text-slate-900">+{s.triplePayout}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 右侧：历史记录 */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 shadow-xl border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Recent Spins</div>
                <div className="text-lg font-extrabold text-slate-900">最近记录</div>
              </div>
              <button
                onClick={fetchStatus}
                disabled={loading}
                className="text-sm font-bold text-slate-500 hover:text-slate-900 transition-colors"
              >
                刷新
              </button>
            </div>

            {(status?.records?.length ?? 0) === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-slate-400">
                暂无记录
              </div>
            ) : (
              <div className="space-y-3">
                {status?.records?.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-2xl border border-slate-100 bg-white hover:bg-slate-50 transition-colors px-4 py-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-2xl">
                        {r.reels.map((id, i) => (
                          <span key={`${r.id}-${id}-${i}`}>{symbolById[id].emoji}</span>
                        ))}
                      </div>
                      <div className={`text-sm font-extrabold ${r.payout > 0 ? 'text-green-600' : 'text-slate-400'}`}>
                        {r.payout > 0 ? `+${r.pointsEarned}` : '0'}
                      </div>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                      <span>{new Date(r.createdAt).toLocaleTimeString()}</span>
                      <span>{r.payout > 0 ? `中奖 ${r.payout}` : '未中奖'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 border-t border-slate-100 pt-5 text-xs text-slate-500 leading-relaxed">
              <div className="font-bold text-slate-700 mb-2">提示</div>
              <div>达到每日积分上限后仍可继续旋转，但不会再发放积分。</div>
              <div>如果你更想“赌积分”模式，可以在计划里作为扩展功能再做。</div>
            </div>
          </div>
        </div>
      </div>

      {/* 积分上限提示 */}
      {showLimitWarning && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 p-6">
            <div className="text-lg font-extrabold text-slate-900 mb-2">今日积分已达上限</div>
            <div className="text-sm text-slate-600 leading-relaxed">
              你仍然可以继续旋转，但本次不会再发放积分。是否继续？
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowLimitWarning(false)}
                className="py-3 rounded-2xl border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 transition-colors"
              >
                先不玩了
              </button>
              <button
                onClick={() => {
                  setLimitWarningAck(true);
                  setShowLimitWarning(false);
                  handleSpin({ ignoreLimit: true });
                }}
                className="py-3 rounded-2xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-colors"
              >
                继续旋转
              </button>
            </div>

            <div className="mt-4 text-[11px] text-slate-400">
              提示：明天 0 点（北京时间）会刷新上限。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
