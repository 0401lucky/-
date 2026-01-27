// src/app/games/match3/page.tsx

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronLeft, RotateCcw, Sparkles, Star, Timer, Trophy, X, Zap } from 'lucide-react';
import { Board } from './components/Board';
import { useGameSession } from './hooks/useGameSession';
import { createInitialBoard, simulateMatch3Game } from '@/lib/match3-engine';
import type { Match3Move } from '@/lib/match3-engine';
import confetti from 'canvas-confetti';
import { cn } from '@/lib/utils';

type Phase = 'loading' | 'ready' | 'playing' | 'result';

function movesStorageKey(sessionId: string) {
  return `match3:moves:${sessionId}`;
}

function areAdjacent(a: number, b: number, cols: number): boolean {
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(cols) || cols < 1) return false;
  const ar = Math.floor(a / cols);
  const br = Math.floor(b / cols);
  const diff = Math.abs(a - b);
  if (diff === 1) return ar === br;
  return diff === cols;
}

function loadMoves(sessionId: string): Match3Move[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(movesStorageKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m) =>
        m &&
        typeof m === 'object' &&
        Number.isInteger(m.from) &&
        Number.isInteger(m.to)
    );
  } catch {
    return [];
  }
}

function saveMoves(sessionId: string, moves: Match3Move[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(movesStorageKey(sessionId), JSON.stringify(moves));
  } catch {
    // ignore quota errors
  }
}

function clearMoves(sessionId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(movesStorageKey(sessionId));
  } catch {
    // ignore
  }
}

// Score counting hook
function useAnimatedNumber(value: number, duration: number = 500) {
  const [displayValue, setDisplayValue] = useState(value);
  const displayValueRef = useRef(displayValue);
  
  useEffect(() => {
    displayValueRef.current = displayValue;
  }, [displayValue]);

  useEffect(() => {
    let startTimestamp: number | null = null;
    const startValue = displayValueRef.current;
    const endValue = value;
    
    if (startValue === endValue) return;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      
      const current = Math.floor(startValue + (endValue - startValue) * ease);
      displayValueRef.current = current;
      setDisplayValue(current);

      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };

    window.requestAnimationFrame(step);
  }, [value, duration]);

  return displayValue;
}

export default function Match3Page() {
  const router = useRouter();
  const {
    session,
    status,
    loading,
    error,
    isRestored,
    fetchStatus,
    startGame,
    cancelGame,
    submitResult,
    resetSubmitFlag,
    setError,
  } = useGameSession();

  const [phase, setPhase] = useState<Phase>('loading');
  const [board, setBoard] = useState<number[]>([]);
  const [moves, setMoves] = useState<Match3Move[]>([]);
  const [score, setScore] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [timeLeftMs, setTimeLeftMs] = useState<number>(0);
  const [result, setResult] = useState<{
    score: number;
    pointsEarned: number;
    moves: number;
    cascades: number;
    tilesCleared: number;
  } | null>(null);
  const [showLimitWarning, setShowLimitWarning] = useState(false);

  // Animation states
  const displayScore = useAnimatedNumber(score);
  const [lastScoreIncrease, setLastScoreIncrease] = useState<{ val: number, id: number } | null>(null);
  const prevScoreRef = useRef(0);

  const movesRef = useRef<Match3Move[]>([]);
  const finishedRef = useRef(false);

  useEffect(() => {
    movesRef.current = moves;
  }, [moves]);

  useEffect(() => {
    fetchStatus().finally(() => setPhase('ready'));
  }, [fetchStatus]);

  // Score feedback effect
  useEffect(() => {
    if (score > prevScoreRef.current) {
      const diff = score - prevScoreRef.current;
      setLastScoreIncrease({ val: diff, id: Date.now() });
    }
    prevScoreRef.current = score;
  }, [score]);

  // Result confetti
  useEffect(() => {
    if (phase === 'result' && result) {
      const duration = 3000;
      const end = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 2,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ['#ef4444', '#3b82f6', '#10b981', '#f59e0b']
        });
        confetti({
          particleCount: 2,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ['#ef4444', '#3b82f6', '#10b981', '#f59e0b']
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };
      frame();
    }
  }, [phase, result]);

  const computeStateFromMoves = useCallback(
    (nextMoves: Match3Move[]) => {
      if (!session) return { ok: false as const, message: '缺少会话' };
      const sim = simulateMatch3Game(session.seed, session.config, nextMoves, { maxMoves: 250 });
      if (!sim.ok) return sim;
      return {
        ok: true as const,
        score: sim.score,
        board: sim.finalBoard,
      };
    },
    [session]
  );

  // 初始化/恢复局面
  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    Promise.resolve().then(() => {
      if (cancelled) return;

      finishedRef.current = false;
      setSelectedIndex(null);

      const restoredMoves = loadMoves(session.sessionId);
      movesRef.current = restoredMoves;
      const sim = simulateMatch3Game(session.seed, session.config, restoredMoves, { maxMoves: 250 });
      if (sim.ok) {
        setMoves(restoredMoves);
        setBoard(sim.finalBoard);
        setScore(sim.score);
        prevScoreRef.current = sim.score; // Init prevScore
      } else {
        clearMoves(session.sessionId);
        const init = createInitialBoard(session.seed, session.config);
        if (init.ok) {
          movesRef.current = [];
          setMoves([]);
          setBoard(init.finalBoard);
          setScore(0);
          prevScoreRef.current = 0;
        }
        setError('本地进度异常，已重置该局');
      }

      setPhase('playing');
    });

    return () => {
      cancelled = true;
    };
  }, [session, setError]);

  // 计时器
  useEffect(() => {
    if (phase !== 'playing' || !session) return;

    const tick = () => {
      const left = Math.max(0, session.timeLimitMs - (Date.now() - session.startedAt));
      setTimeLeftMs(left);
      if (left <= 0 && !finishedRef.current) {
        finishedRef.current = true;
        const sessionId = session.sessionId;
        submitResult(movesRef.current).then((res) => {
          if (res) {
            clearMoves(sessionId);
            setResult({
              score: res.record.score,
              pointsEarned: res.pointsEarned,
              moves: res.record.moves,
              cascades: res.record.cascades,
              tilesCleared: res.record.tilesCleared,
            });
            setPhase('result');
          } else {
            finishedRef.current = false;
          }
        });
      }
    };

    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [phase, session, submitResult]);

  const timeLeftSec = useMemo(() => Math.ceil(timeLeftMs / 1000), [timeLeftMs]);

  const handleStart = useCallback(async () => {
    if (status?.pointsLimitReached) {
      setShowLimitWarning(true);
      return;
    }

    setError(null);
    const ok = await startGame();
    if (ok) {
      setResult(null);
      setMoves([]);
      setScore(0);
      prevScoreRef.current = 0;
      setBoard([]);
    }
  }, [startGame, setError, status?.pointsLimitReached]);

  const handleConfirmStart = useCallback(async () => {
    setShowLimitWarning(false);
    setError(null);
    const ok = await startGame();
    if (ok) {
      setResult(null);
      setMoves([]);
      setScore(0);
      prevScoreRef.current = 0;
      setBoard([]);
    }
  }, [startGame, setError]);

  const handleTileClick = useCallback(
    (index: number) => {
      if (phase !== 'playing' || !session) return;
      if (loading) return;
      if (timeLeftMs <= 0) return;

      if (selectedIndex === null) {
        setSelectedIndex(index);
        return;
      }

      if (selectedIndex === index) {
        setSelectedIndex(null);
        return;
      }

      if (!areAdjacent(selectedIndex, index, session.config.cols)) {
        setSelectedIndex(index);
        return;
      }

      const move: Match3Move = { from: selectedIndex, to: index };
      const nextMoves = [...movesRef.current, move];
      const next = computeStateFromMoves(nextMoves);
      if (!next.ok) {
        setSelectedIndex(null);
        setError(next.message || '无效交换');
        
        // Shake animation feedback?
        const boardEl = document.getElementById('game-board');
        if(boardEl) {
          boardEl.animate([
            { transform: 'translateX(0)' },
            { transform: 'translateX(-5px)' },
            { transform: 'translateX(5px)' },
            { transform: 'translateX(0)' }
          ], { duration: 300 });
        }
        return;
      }

      setError(null);
      movesRef.current = nextMoves;
      setMoves(nextMoves);
      setBoard(next.board);
      setScore(next.score);
      saveMoves(session.sessionId, nextMoves);
      setSelectedIndex(null);
    },
    [computeStateFromMoves, loading, phase, selectedIndex, session, setError, timeLeftMs]
  );

  const handleCancel = useCallback(async () => {
    if (!session) return;
    await cancelGame();
    clearMoves(session.sessionId);
    setMoves([]);
    setBoard([]);
    setScore(0);
    setSelectedIndex(null);
    setResult(null);
    setPhase('ready');
  }, [cancelGame, session]);

  const handlePlayAgain = useCallback(async () => {
    setResult(null);
    setSelectedIndex(null);
    setMoves([]);
    setBoard([]);
    setScore(0);
    resetSubmitFlag();
    await fetchStatus();
    setPhase('ready');
  }, [fetchStatus, resetSubmitFlag]);

  const handleBackToGames = useCallback(() => {
    router.push('/games');
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {/* Animated Background */}
      <div className="absolute inset-0 z-0 opacity-30 pointer-events-none">
        <div className="absolute top-0 -left-10 w-96 h-96 bg-purple-300 rounded-full mix-blend-multiply filter blur-3xl animate-blob"></div>
        <div className="absolute top-0 -right-10 w-96 h-96 bg-yellow-300 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-8 left-20 w-96 h-96 bg-pink-300 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000"></div>
      </div>
      
      <style jsx global>{`
        @keyframes blob {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
        @keyframes floatUp {
          0% { transform: translateY(0) scale(0.8); opacity: 0; }
          20% { transform: translateY(-10px) scale(1.1); opacity: 1; }
          100% { transform: translateY(-30px) scale(1); opacity: 0; }
        }
        .animate-float-up {
          animation: floatUp 1s ease-out forwards;
        }
      `}</style>

      <div className="relative z-10 max-w-5xl mx-auto py-8 px-4">
        {/* 顶部导航 */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => router.push('/games')}
            className="group flex items-center text-slate-500 hover:text-slate-800 transition-colors font-medium bg-white/50 backdrop-blur-sm px-3 py-1.5 rounded-xl border border-white/20 hover:bg-white/80"
          >
            <ChevronLeft className="w-5 h-5 mr-1 group-hover:-translate-x-0.5 transition-transform" />
            游戏中心
          </button>

          <div className="flex items-center gap-4">
            <Link
              href="/store"
              className="flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur-md rounded-full shadow-sm border border-slate-200 text-slate-700 hover:border-yellow-400 hover:text-yellow-600 transition-all group hover:shadow-md"
            >
              <Star className="w-4 h-4 text-yellow-500" />
              <span className="font-bold tabular-nums">{status?.balance ?? '...'}</span>
              <span className="text-slate-300 group-hover:text-yellow-400 transition-colors">→</span>
            </Link>
          </div>
        </div>

        {/* 标题 */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-slate-900 to-slate-700 tracking-tight mb-2 drop-shadow-sm">消消乐</h1>
          <p className="text-slate-500 font-medium">交换相邻方块，凑 3 个及以上即可消除并得分。</p>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50/90 backdrop-blur-sm border border-red-200 rounded-xl text-red-700 text-center animate-in slide-in-from-top-2">
            {error}
          </div>
        )}

        {/* 冷却提示 */}
        {status?.inCooldown && phase === 'ready' && (
          <div className="mb-6 p-4 bg-amber-50/90 backdrop-blur-sm border border-amber-200 rounded-xl text-amber-700 text-center animate-in slide-in-from-top-2">
            冷却中，请等待 {status.cooldownRemaining} 秒后再开始游戏
          </div>
        )}

        {/* 今日统计 */}
        {status?.dailyStats && phase !== 'playing' && (
          <div className="mb-8 bg-white/80 backdrop-blur-md rounded-2xl p-6 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-center gap-8">
              <div className="text-center">
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-1 font-semibold">今日游戏</div>
                <div className="text-2xl font-bold text-slate-900 tabular-nums">
                  {status.dailyStats.gamesPlayed} <span className="text-sm font-normal text-slate-500">局</span>
                </div>
              </div>
              <div className="w-px h-10 bg-slate-200" />
              <div className="text-center">
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-1 font-semibold">今日积分</div>
                <div className={`text-2xl font-bold ${status.pointsLimitReached ? 'text-orange-500' : 'text-green-600'}`}>
                  <span className="tabular-nums">{status.dailyStats.pointsEarned}</span>{' '}
                  <span className="text-slate-300">/</span>{' '}
                  <span className="text-sm font-normal text-slate-500 tabular-nums">{status.dailyLimit ?? 2000}</span>
                  {status.pointsLimitReached && (
                    <span className="block text-xs text-orange-500 font-medium mt-1">已达上限</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 主内容 */}
        {phase === 'loading' && (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white border border-slate-200 shadow-sm mb-4">
              <Sparkles className="w-8 h-8 text-indigo-500 animate-spin-slow" />
            </div>
            <p className="text-slate-500 font-medium">加载中...</p>
          </div>
        )}

        {phase === 'ready' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white/90 backdrop-blur-md rounded-3xl p-8 shadow-sm border border-slate-100 relative overflow-hidden group hover:shadow-lg transition-all">
              <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                <Zap className="w-32 h-32 text-slate-900 rotate-12" />
              </div>
              <div className="relative z-10">
                <div className="flex items-start justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-2xl font-extrabold text-slate-900">开始一局</h2>
                    <p className="text-slate-500 mt-2">限时 60 秒，挑战你的反应速度。</p>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-lg shadow-slate-200">
                    <Timer className="w-6 h-6" />
                  </div>
                </div>

                <button
                  onClick={handleStart}
                  disabled={loading || status?.inCooldown}
                  className="w-full py-4 px-6 bg-slate-900 hover:bg-slate-800 text-white font-bold text-lg rounded-2xl transition-all shadow-lg shadow-slate-200 hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
                >
                  {loading ? '处理中...' : '开始游戏'}
                </button>

                <div className="mt-6 p-4 bg-slate-50 rounded-xl text-sm text-slate-500 leading-relaxed border border-slate-100">
                  <span className="font-semibold text-slate-700">规则提示：</span>
                  仅允许“能产生消除”的交换。
                </div>
              </div>
            </div>

            <div className="bg-white/90 backdrop-blur-md rounded-3xl p-8 shadow-sm border border-slate-100 h-full">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-6 flex items-center gap-2">
                <Trophy className="w-4 h-4 text-yellow-500" />
                最近记录
              </h3>
              {status?.records?.length ? (
                <div className="space-y-4">
                  {status.records.map((r, i) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/50 px-5 py-4 hover:bg-white hover:shadow-md transition-all"
                      style={{ animationDelay: `${i * 100}ms` }}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${i === 0 ? 'bg-yellow-50 border-yellow-100 text-yellow-600' : 'bg-white border-slate-200 text-slate-400'}`}>
                          {i === 0 ? <Trophy className="w-5 h-5" /> : <span className="font-bold text-sm">#{i + 1}</span>}
                        </div>
                        <div>
                          <div className="text-base font-bold text-slate-900 tabular-nums">{r.score} 分</div>
                          <div className="text-xs text-slate-500 tabular-nums">
                            {r.moves} 步 · {r.cascades} 连锁
                          </div>
                        </div>
                      </div>
                      <div className="text-sm font-extrabold text-emerald-600 tabular-nums bg-emerald-50 px-3 py-1 rounded-lg">+{r.pointsEarned}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Trophy className="w-8 h-8 text-slate-300" />
                  </div>
                  暂无记录
                </div>
              )}
            </div>
          </div>
        )}

        {phase === 'playing' && session && (
          <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-8 items-start animate-in fade-in duration-300">
            <div className="space-y-4" id="game-board">
              <Board
                board={board}
                config={session.config}
                selectedIndex={selectedIndex}
                onTileClick={handleTileClick}
                disabled={loading || timeLeftMs <= 0}
              />

              <div className="bg-white/90 backdrop-blur-md rounded-3xl p-5 shadow-sm border border-slate-100 relative overflow-hidden">
                {/* Floating Score Animation */}
                {lastScoreIncrease && (
                   <div 
                     key={lastScoreIncrease.id}
                     className="absolute top-4 left-1/2 -translate-x-1/2 text-2xl font-black text-emerald-500 pointer-events-none animate-float-up z-20"
                   >
                     +{lastScoreIncrease.val}
                   </div>
                )}
                
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs text-slate-400 uppercase tracking-wider mb-1 font-bold">得分</div>
                    <div className="text-4xl font-black text-slate-900 tabular-nums tracking-tighter">
                      {displayScore}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-400 uppercase tracking-wider mb-1 font-bold">剩余时间</div>
                    <div className={cn(
                      "text-3xl font-black tabular-nums transition-colors duration-300",
                      timeLeftSec <= 10 ? "text-red-500 animate-pulse" : "text-slate-900"
                    )}>
                      {Math.max(0, timeLeftSec)}s
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between gap-3 text-sm border-t border-slate-100 pt-4">
                  <div className="text-slate-500 tabular-nums font-medium">步数：{moves.length}</div>
                  <button
                    onClick={handleCancel}
                    disabled={loading}
                    className="inline-flex items-center gap-2 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed font-medium px-2 py-1 rounded-lg hover:bg-red-50"
                    type="button"
                  >
                    <X className="w-4 h-4" />
                    放弃
                  </button>
                </div>

                {isRestored && (
                  <div className="mt-4 p-3 rounded-2xl bg-amber-50 border border-amber-100 text-amber-700 text-xs font-medium text-center">
                    已恢复中断的游戏进度
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white/90 backdrop-blur-md rounded-3xl p-6 shadow-sm border border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-6">操作指南</h3>
              <div className="space-y-6">
                <div className="flex items-start gap-4 p-4 rounded-2xl bg-slate-50/50 hover:bg-slate-50 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-indigo-200">
                    <Timer className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 text-sm mb-1">基础玩法</div>
                    <div className="text-sm text-slate-600 leading-relaxed">点击一个方块，再点击相邻方块即可交换。凑齐 3 个或更多相同方块即可消除得分。</div>
                  </div>
                </div>
                
                <div className="flex items-start gap-4 p-4 rounded-2xl bg-slate-50/50 hover:bg-slate-50 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-pink-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-pink-200">
                    <RotateCcw className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 text-sm mb-1">有效交换</div>
                    <div className="text-sm text-slate-600 leading-relaxed">只有能产生消除的交换才会生效。无效交换会自动还原（且不消耗时间/步数）。</div>
                  </div>
                </div>

                {status?.pointsLimitReached && (
                  <div className="flex items-start gap-4 p-4 rounded-2xl bg-orange-50 border border-orange-100">
                    <div className="w-10 h-10 rounded-xl bg-orange-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-orange-200">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-orange-800 text-sm mb-1">积分上限提示</div>
                      <div className="text-sm text-orange-700 leading-relaxed">今日积分已达上限。本局仍可游玩，但不会获得积分奖励。</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 结算弹窗 */}
        {phase === 'result' && result && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-300 slide-in-from-bottom-8">
              <div className="text-center relative">
                {/* Decorative background for header */}
                <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-40 h-40 bg-yellow-300 rounded-full blur-3xl opacity-20 pointer-events-none"></div>
                
                <div className="relative inline-flex mb-6">
                  <div className="w-20 h-20 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-200 transform rotate-3">
                    <Trophy className="w-10 h-10 text-white drop-shadow-md" />
                  </div>
                  <div className="absolute -top-2 -right-2 bg-white rounded-full p-1 shadow-sm">
                    <Star className="w-6 h-6 text-yellow-500 fill-yellow-500 animate-spin-slow" />
                  </div>
                </div>

                <h3 className="text-2xl font-black text-slate-900 mb-1">游戏结束!</h3>
                <p className="text-slate-500 text-sm mb-8 font-medium">表现不错！看看你的战绩</p>

                <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="col-span-2 bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl p-4 border border-slate-200">
                    <div className="text-xs text-slate-400 uppercase tracking-wider mb-1 font-bold">最终得分</div>
                    <div className="text-4xl font-black text-slate-900 tabular-nums tracking-tight">{result.score}</div>
                  </div>
                  
                  <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100 flex flex-col items-center justify-center">
                    <div className="text-xs text-emerald-600 uppercase tracking-wider mb-1 font-bold">获得积分</div>
                    <div className="text-xl font-black text-emerald-600 tabular-nums">+{result.pointsEarned}</div>
                  </div>
                  
                  <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex flex-col items-center justify-center">
                     <div className="text-xs text-slate-400 uppercase tracking-wider mb-1 font-bold">消除方块</div>
                     <div className="text-xl font-black text-slate-700 tabular-nums">{result.tilesCleared}</div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleBackToGames}
                    className="flex-1 py-3.5 px-4 border-2 border-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-50 hover:border-slate-200 transition-colors active:scale-[0.98]"
                    type="button"
                  >
                    返回
                  </button>
                  <button
                    onClick={handlePlayAgain}
                    className="flex-1 py-3.5 px-4 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl transition-all shadow-lg shadow-slate-200 hover:shadow-xl hover:-translate-y-0.5 active:scale-[0.98]"
                    type="button"
                  >
                    再来一局
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 积分上限警告 */}
        {showLimitWarning && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
              <div className="text-center">
                <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-orange-100 rotate-3">
                  <AlertTriangle className="w-8 h-8 text-orange-500" />
                </div>
                <h3 className="text-xl font-extrabold text-slate-900 mb-2">积分已达上限</h3>
                <p className="text-slate-500 mb-8 leading-relaxed text-sm">
                  今日已获得 <span className="font-bold text-orange-600 tabular-nums">{status?.dailyStats?.pointsEarned ?? 0}</span> 积分，
                  <br/>
                  继续游戏将 <span className="text-orange-600 font-bold">无法获得</span> 新的积分。
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowLimitWarning(false)}
                    className="flex-1 py-3 px-4 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors"
                    type="button"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmStart}
                    className="flex-1 py-3 px-4 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-colors shadow-lg shadow-orange-200"
                    type="button"
                  >
                    继续游戏
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
