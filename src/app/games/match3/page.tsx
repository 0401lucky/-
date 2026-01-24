// src/app/games/match3/page.tsx

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronLeft, RotateCcw, Sparkles, Star, Timer, Trophy, X } from 'lucide-react';
import { Board } from './components/Board';
import { useGameSession } from './hooks/useGameSession';
import { createInitialBoard, simulateMatch3Game } from '@/lib/match3-engine';
import type { Match3Move } from '@/lib/match3-engine';

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

  const movesRef = useRef<Match3Move[]>([]);
  const finishedRef = useRef(false);

  useEffect(() => {
    movesRef.current = moves;
  }, [moves]);

  useEffect(() => {
    fetchStatus().finally(() => setPhase('ready'));
  }, [fetchStatus]);

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

    finishedRef.current = false;
    setSelectedIndex(null);

    const restoredMoves = loadMoves(session.sessionId);
    movesRef.current = restoredMoves;
    const sim = simulateMatch3Game(session.seed, session.config, restoredMoves, { maxMoves: 250 });
    if (sim.ok) {
      setMoves(restoredMoves);
      setBoard(sim.finalBoard);
      setScore(sim.score);
    } else {
      clearMoves(session.sessionId);
      const init = createInitialBoard(session.seed, session.config);
      if (init.ok) {
        movesRef.current = [];
        setMoves([]);
        setBoard(init.finalBoard);
        setScore(0);
      }
      setError('本地进度异常，已重置该局');
    }

    setPhase('playing');
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
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        {/* 顶部导航 */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => router.push('/games')}
            className="group flex items-center text-slate-500 hover:text-slate-800 transition-colors font-medium"
          >
            <ChevronLeft className="w-5 h-5 mr-1 group-hover:-translate-x-0.5 transition-transform" />
            游戏中心
          </button>

          <div className="flex items-center gap-4">
            <Link
              href="/store"
              className="flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow-sm border border-slate-200 text-slate-700 hover:border-yellow-400 hover:text-yellow-600 transition-all group"
            >
              <Star className="w-4 h-4 text-yellow-500" />
              <span className="font-bold tabular-nums">{status?.balance ?? '...'}</span>
              <span className="text-slate-300 group-hover:text-yellow-400 transition-colors">→</span>
            </Link>
          </div>
        </div>

        {/* 标题 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">消消乐</h1>
          <p className="text-slate-500 mt-2">交换相邻方块，凑 3 个及以上即可消除并得分。</p>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-center">
            {error}
          </div>
        )}

        {/* 冷却提示 */}
        {status?.inCooldown && phase === 'ready' && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-center">
            冷却中，请等待 {status.cooldownRemaining} 秒后再开始游戏
          </div>
        )}

        {/* 今日统计 */}
        {status?.dailyStats && phase !== 'playing' && (
          <div className="mb-8 bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-center gap-8">
              <div className="text-center">
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">今日游戏</div>
                <div className="text-xl font-bold text-slate-900 tabular-nums">
                  {status.dailyStats.gamesPlayed} <span className="text-sm font-normal text-slate-500">局</span>
                </div>
              </div>
              <div className="w-px h-10 bg-slate-200" />
              <div className="text-center">
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">今日积分</div>
                <div className={`text-xl font-bold ${status.pointsLimitReached ? 'text-orange-500' : 'text-green-600'}`}>
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
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white border border-slate-200 shadow-sm mb-4">
              <Sparkles className="w-6 h-6 text-slate-600 animate-pulse" />
            </div>
            <p className="text-slate-500">加载中...</p>
          </div>
        )}

        {phase === 'ready' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-xl font-extrabold text-slate-900">开始一局</h2>
                  <p className="text-slate-500 text-sm mt-1">限时 60 秒，得分将按每日上限发放积分。</p>
                </div>
                <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-lg shadow-slate-200">
                  <Timer className="w-5 h-5" />
                </div>
              </div>

              <button
                onClick={handleStart}
                disabled={loading || status?.inCooldown}
                className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-2xl transition-all shadow-lg shadow-slate-200 hover:shadow-xl disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? '处理中...' : '开始游戏'}
              </button>

              <div className="mt-5 text-xs text-slate-500 leading-relaxed">
                规则：仅允许“能产生消除”的交换；无消除交换将被拒绝。
              </div>
            </div>

            <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">最近记录</h3>
              {status?.records?.length ? (
                <div className="space-y-3">
                  {status.records.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/40 px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center">
                          <Trophy className="w-5 h-5 text-slate-700" />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-slate-900 tabular-nums">{r.score} 分</div>
                          <div className="text-xs text-slate-500 tabular-nums">
                            {r.moves} 步 · {r.cascades} 连锁 · {r.tilesCleared} 消除
                          </div>
                        </div>
                      </div>
                      <div className="text-sm font-extrabold text-emerald-700 tabular-nums">+{r.pointsEarned}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-500">暂无记录</div>
              )}
            </div>
          </div>
        )}

        {phase === 'playing' && session && (
          <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-8 items-start">
            <div className="space-y-4">
              <Board
                board={board}
                config={session.config}
                selectedIndex={selectedIndex}
                onTileClick={handleTileClick}
                disabled={loading || timeLeftMs <= 0}
              />

              <div className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">得分</div>
                    <div className="text-3xl font-extrabold text-slate-900 tabular-nums">{score}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">剩余时间</div>
                    <div className="text-2xl font-extrabold text-slate-900 tabular-nums">{Math.max(0, timeLeftSec)}s</div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                  <div className="text-slate-500 tabular-nums">步数：{moves.length}</div>
                  <button
                    onClick={handleCancel}
                    disabled={loading}
                    className="inline-flex items-center gap-2 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    type="button"
                  >
                    <X className="w-4 h-4" />
                    放弃本局
                  </button>
                </div>

                {isRestored && (
                  <div className="mt-4 p-3 rounded-2xl bg-slate-50 border border-slate-100 text-slate-600 text-sm">
                    已恢复未完成的对局进度（本地记录）。
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">操作提示</h3>
              <div className="space-y-3 text-sm text-slate-600 leading-relaxed">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-2xl bg-slate-900 text-white flex items-center justify-center mt-0.5">
                    <Timer className="w-4 h-4" />
                  </div>
                  <div>点击一个方块，再点击相邻方块即可交换；计时结束将自动结算。</div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-2xl bg-slate-900 text-white flex items-center justify-center mt-0.5">
                    <RotateCcw className="w-4 h-4" />
                  </div>
                  <div>只有能产生消除的交换才会生效（避免无意义操作）。</div>
                </div>
                {status?.pointsLimitReached && (
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-2xl bg-orange-500 text-white flex items-center justify-center mt-0.5">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <div>今日积分已达上限：本局仍可游玩，但不会再获得积分。</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 结算弹窗 */}
        {phase === 'result' && result && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl animate-in zoom-in-95">
              <div className="text-center">
                <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-100">
                  <Trophy className="w-8 h-8 text-emerald-600" />
                </div>
                <h3 className="text-2xl font-extrabold text-slate-900 mb-2">结算完成</h3>
                <p className="text-slate-500 mb-6">本局得分与实际发放积分如下（受每日上限影响）。</p>

                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                    <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">得分</div>
                    <div className="text-2xl font-extrabold text-slate-900 tabular-nums">{result.score}</div>
                  </div>
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                    <div className="text-xs text-emerald-600 uppercase tracking-wider mb-1">获得积分</div>
                    <div className="text-2xl font-extrabold text-emerald-700 tabular-nums">+{result.pointsEarned}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                    <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">步数</div>
                    <div className="text-lg font-bold text-slate-900 tabular-nums">{result.moves}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                    <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">连锁/消除</div>
                    <div className="text-lg font-bold text-slate-900 tabular-nums">
                      {result.cascades}/{result.tilesCleared}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleBackToGames}
                    className="flex-1 py-3 px-4 border-2 border-slate-200 text-slate-700 font-semibold rounded-2xl hover:bg-slate-50 transition-colors"
                    type="button"
                  >
                    返回游戏中心
                  </button>
                  <button
                    onClick={handlePlayAgain}
                    className="flex-1 py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-2xl transition-colors"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl animate-in zoom-in-95">
              <div className="text-center">
                <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-orange-100">
                  <AlertTriangle className="w-8 h-8 text-orange-600" />
                </div>
                <h3 className="text-xl font-extrabold text-slate-900 mb-2">今日积分已达上限</h3>
                <p className="text-slate-500 mb-6">
                  你今日已获得 <span className="font-bold text-orange-600 tabular-nums">{status?.dailyStats?.pointsEarned ?? 0}</span> 积分，
                  达到每日上限 <span className="font-bold tabular-nums">{status?.dailyLimit ?? 2000}</span> 积分。
                  <br />
                  <span className="text-orange-700 font-medium">继续游戏将不会获得积分。</span>
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowLimitWarning(false)}
                    className="flex-1 py-3 px-4 border-2 border-slate-200 text-slate-700 font-semibold rounded-2xl hover:bg-slate-50 transition-colors"
                    type="button"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmStart}
                    className="flex-1 py-3 px-4 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-2xl transition-colors"
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
