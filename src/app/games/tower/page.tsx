// src/app/games/tower/page.tsx

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronLeft, Star, Trophy, Zap, Layers, X, HelpCircle, Flag } from 'lucide-react';
import LaneCards from './components/LaneCards';
import FloatingText from './components/FloatingText';
import type { FloatingTextItem } from './components/FloatingText';
import GameHeader from './components/GameHeader';
import ResultModal from './components/ResultModal';
import { useGameSession } from './hooks/useGameSession';
import { createTowerRng, generateFloor, simulateTowerGame } from '@/lib/tower-engine';
import type { TowerFloor, TowerLaneContent, ResolvedLaneContent } from '@/lib/tower-engine';
import {
  ANIM_WALK_DURATION,
  ANIM_ATTACK_DURATION,
  ANIM_POWERUP_DURATION,
  ANIM_DEATH_DURATION,
  ANIM_REVEAL_DURATION,
  ANIM_SHIELD_BLOCK_DURATION,
  ANIM_BOSS_DEFEAT_DURATION,
} from './lib/constants';

type Phase = 'loading' | 'ready' | 'playing' | 'result';
type AnimState = 'idle' | 'walking' | 'attacking' | 'powerup' | 'death' | 'nextFloor' | 'revealing' | 'shieldBlock' | 'bossDefeated';
type TimerHandle = ReturnType<typeof setTimeout> | number;

function choicesStorageKey(sessionId: string) {
  return `tower:choices:${sessionId}`;
}

function loadChoices(sessionId: string): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(choicesStorageKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c: unknown) => typeof c === 'number' && Number.isInteger(c) && c >= 0);
  } catch {
    return [];
  }
}

function saveChoices(sessionId: string, choices: number[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(choicesStorageKey(sessionId), JSON.stringify(choices));
  } catch {
    // ignore
  }
}

function clearChoices(sessionId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(choicesStorageKey(sessionId));
  } catch {
    // ignore
  }
}

export default function TowerPage() {
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
  const [choices, setChoices] = useState<number[]>([]);
  const [power, setPower] = useState(1);
  const [shield, setShield] = useState(false);
  const [currentFloor, setCurrentFloor] = useState<TowerFloor | null>(null);
  const [animState, setAnimState] = useState<AnimState>('idle');
  const [selectedLane, setSelectedLane] = useState<number | null>(null);
  const [revealedLane, setRevealedLane] = useState<TowerLaneContent | null>(null);
  const [floatingTexts, setFloatingTexts] = useState<FloatingTextItem[]>([]);
  const [result, setResult] = useState<{
    floorsClimbed: number;
    finalPower: number;
    gameOver: boolean;
    score: number;
    pointsEarned: number;
  } | null>(null);
  const [showLimitWarning, setShowLimitWarning] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [pendingSubmitChoices, setPendingSubmitChoices] = useState<number[] | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettleConfirm, setShowSettleConfirm] = useState(false);
  const [powerChanged, setPowerChanged] = useState(false);

  const choicesRef = useRef<number[]>([]);
  const rngRef = useRef<(() => number) | null>(null);
  const powerRef = useRef(1);
  const shieldRef = useRef(false);
  const animTimersRef = useRef<Set<TimerHandle>>(new Set());
  const floatingIdRef = useRef(0);

  const scheduleTimer = useCallback((callback: () => void, delay: number) => {
    const timerId = window.setTimeout(() => {
      animTimersRef.current.delete(timerId);
      callback();
    }, delay);
    animTimersRef.current.add(timerId);
    return timerId;
  }, []);

  useEffect(() => {
    const timers = animTimersRef.current;
    return () => {
      for (const id of timers) clearTimeout(id);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    choicesRef.current = choices;
  }, [choices]);

  useEffect(() => {
    powerRef.current = power;
  }, [power]);

  useEffect(() => {
    shieldRef.current = shield;
  }, [shield]);

  // 飘字辅助函数
  const addFloatingText = useCallback((text: string, color: string) => {
    const id = ++floatingIdRef.current;
    setFloatingTexts((prev) => [...prev, { id, text, color }]);
    scheduleTimer(() => {
      setFloatingTexts((prev) => prev.filter((ft) => ft.id !== id));
    }, 1200);
  }, [scheduleTimer]);

  // 初始化
  useEffect(() => {
    fetchStatus().finally(() => setPhase('ready'));
  }, [fetchStatus]);

  // 冷却轮询
  useEffect(() => {
    if (phase !== 'ready' || !status?.inCooldown) return;
    const timer = window.setInterval(() => {
      void fetchStatus();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, status?.inCooldown, fetchStatus]);

  // 会话恢复 / 开局初始化
  useEffect(() => {
    if (!session) return;

    const rng = createTowerRng(session.seed);
    rngRef.current = rng;

    // 尝试恢复进度
    const restoredChoices = loadChoices(session.sessionId);
    const sim = simulateTowerGame(session.seed, restoredChoices);

    if (sim.ok && restoredChoices.length > 0) {
      // 恢复成功
      choicesRef.current = restoredChoices;
      setChoices(restoredChoices);

      // 重建 rng 状态到正确位置
      const freshRng = createTowerRng(session.seed);
      let currentPower = 1;
      let currentShield = false;
      for (let i = 0; i < restoredChoices.length; i++) {
        const floor = generateFloor(freshRng, i + 1, currentPower);
        let lane = floor.lanes[restoredChoices[i]];
        if (lane.type === 'mystery') lane = lane.hidden;

        if (lane.type === 'boss') {
          if (currentPower > lane.value) {
            currentPower += lane.value * 2;
          } else if (currentShield) {
            currentShield = false;
          }
        } else if (lane.type === 'monster') {
          if (currentPower > lane.value) {
            currentPower += lane.value;
          } else if (currentShield) {
            currentShield = false;
          }
        } else if (lane.type === 'add') {
          currentPower += lane.value;
        } else if (lane.type === 'multiply') {
          currentPower *= lane.value;
        } else if (lane.type === 'shield') {
          if (currentShield) {
            currentPower += lane.value;
          } else {
            currentShield = true;
          }
        }
      }

      rngRef.current = freshRng;
      setPower(sim.finalPower);
      powerRef.current = sim.finalPower;
      setShield(sim.finalShield);
      shieldRef.current = sim.finalShield;

      if (sim.gameOver) {
        // 恢复后已死亡 - 直接提交
        void handleSubmit(restoredChoices);
        return;
      }

      // 生成下一层
      const nextFloor = generateFloor(freshRng, restoredChoices.length + 1, sim.finalPower);
      setCurrentFloor(nextFloor);
    } else {
      // 新游戏
      choicesRef.current = [];
      setChoices([]);
      setPower(1);
      powerRef.current = 1;
      setShield(false);
      shieldRef.current = false;

      if (restoredChoices.length > 0) {
        clearChoices(session.sessionId);
        setError('本地进度异常，已重置该局');
      }

      const firstFloor = generateFloor(rng, 1, 1);
      setCurrentFloor(firstFloor);
    }

    setPhase('playing');
    setAnimState('idle');
    setSelectedLane(null);
    setRevealedLane(null);
    setIsAnimating(false);
    setPendingSubmitChoices(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const handleSubmit = useCallback(
    async (finalChoices: number[]) => {
      if (!session) {
        setPendingSubmitChoices(null);
        setIsAnimating(false);
        return;
      }
      const sessionId = session.sessionId;
      setPendingSubmitChoices(finalChoices);

      const res = await submitResult(finalChoices);
      if (!res) {
        setIsAnimating(false);
        setError((prev) => prev ?? '结算提交失败，请重试或放弃本局');
        return;
      }

      clearChoices(sessionId);
      setPendingSubmitChoices(null);
      setError(null);
      setResult({
        floorsClimbed: res.record.floorsClimbed,
        finalPower: res.record.finalPower,
        gameOver: res.record.gameOver,
        score: res.record.score,
        pointsEarned: res.pointsEarned,
      });
      setPhase('result');
    },
    [session, submitResult, setError]
  );

  const handleChooseLane = useCallback(
    (laneIndex: number) => {
      if (
        phase !== 'playing' ||
        !session ||
        !currentFloor ||
        !rngRef.current ||
        isAnimating ||
        loading ||
        !!pendingSubmitChoices
      ) {
        return;
      }

      const rawLane = currentFloor.lanes[laneIndex];
      setSelectedLane(laneIndex);
      setIsAnimating(true);
      setAnimState('walking');

      // --- 内部闭包函数 ---

      const advanceToNextFloor = (options?: { newPower?: number; shieldChange?: 'gain' | 'lose' }) => {
        if (options?.newPower !== undefined) {
          setPower(options.newPower);
          powerRef.current = options.newPower;
          setPowerChanged(true);
          scheduleTimer(() => setPowerChanged(false), 300);
        }

        if (options?.shieldChange === 'gain') {
          setShield(true);
          shieldRef.current = true;
        } else if (options?.shieldChange === 'lose') {
          setShield(false);
          shieldRef.current = false;
        }

        const newChoices = [...choicesRef.current, laneIndex];
        choicesRef.current = newChoices;
        setChoices(newChoices);
        saveChoices(session.sessionId, newChoices);

        const nextFloor = generateFloor(rngRef.current!, newChoices.length + 1, powerRef.current);
        setCurrentFloor(nextFloor);
        setRevealedLane(null);
        setAnimState('idle');
        setSelectedLane(null);
        setIsAnimating(false);
      };

      const handleDeath = () => {
        setAnimState('death');
        addFloatingText('GAME OVER', '#ff1744');

        const newChoices = [...choicesRef.current, laneIndex];
        choicesRef.current = newChoices;
        setChoices(newChoices);
        saveChoices(session.sessionId, newChoices);

        scheduleTimer(() => {
          void handleSubmit(newChoices);
        }, ANIM_DEATH_DURATION);
      };

      const handleShieldBlock = () => {
        setAnimState('shieldBlock');
        addFloatingText('护盾抵挡!', '#42a5f5');
        scheduleTimer(() => advanceToNextFloor({ shieldChange: 'lose' }), ANIM_SHIELD_BLOCK_DURATION);
      };

      const executeLaneEffect = (lane: ResolvedLaneContent) => {
        if (lane.type === 'boss') {
          if (powerRef.current > lane.value) {
            setAnimState('bossDefeated');
            addFloatingText(`+${lane.value * 2}`, '#ff6d00');
            scheduleTimer(() => advanceToNextFloor({ newPower: powerRef.current + lane.value * 2 }), ANIM_BOSS_DEFEAT_DURATION);
          } else if (shieldRef.current) {
            handleShieldBlock();
          } else {
            handleDeath();
          }
        } else if (lane.type === 'monster') {
          if (powerRef.current > lane.value) {
            setAnimState('attacking');
            addFloatingText(`+${lane.value}`, '#ef5350');
            scheduleTimer(() => advanceToNextFloor({ newPower: powerRef.current + lane.value }), ANIM_ATTACK_DURATION);
          } else if (shieldRef.current) {
            handleShieldBlock();
          } else {
            handleDeath();
          }
        } else if (lane.type === 'shield') {
          setAnimState('powerup');
          if (shieldRef.current) {
            addFloatingText(`+${lane.value}`, '#42a5f5');
            scheduleTimer(() => advanceToNextFloor({ newPower: powerRef.current + lane.value }), ANIM_POWERUP_DURATION);
          } else {
            addFloatingText('获得护盾!', '#42a5f5');
            scheduleTimer(() => advanceToNextFloor({ shieldChange: 'gain' }), ANIM_POWERUP_DURATION);
          }
        } else if (lane.type === 'add') {
          setAnimState('powerup');
          addFloatingText(`+${lane.value}`, '#66bb6a');
          scheduleTimer(() => advanceToNextFloor({ newPower: powerRef.current + lane.value }), ANIM_POWERUP_DURATION);
        } else if (lane.type === 'multiply') {
          setAnimState('powerup');
          addFloatingText(`x${lane.value}`, '#ffa726');
          scheduleTimer(() => advanceToNextFloor({ newPower: powerRef.current * lane.value }), ANIM_POWERUP_DURATION);
        }
      };

      // --- 行走后执行 ---

      scheduleTimer(() => {
        if (rawLane.type === 'mystery') {
          const resolved = rawLane.hidden;
          setRevealedLane(resolved);
          setAnimState('revealing');
          scheduleTimer(() => {
            executeLaneEffect(resolved);
          }, ANIM_REVEAL_DURATION);
        } else {
          executeLaneEffect(rawLane);
        }
      }, ANIM_WALK_DURATION);
    },
    [phase, session, currentFloor, isAnimating, loading, pendingSubmitChoices, handleSubmit, scheduleTimer, addFloatingText]
  );

  const handleStart = useCallback(async () => {
    if (status?.pointsLimitReached) {
      setShowLimitWarning(true);
      return;
    }

    setError(null);
    const ok = await startGame();
    if (ok) {
      setPendingSubmitChoices(null);
      setResult(null);
      setChoices([]);
      setPower(1);
      powerRef.current = 1;
      setShield(false);
      shieldRef.current = false;
      setCurrentFloor(null);
      setRevealedLane(null);
    }
  }, [startGame, setError, status?.pointsLimitReached]);

  const handleConfirmStart = useCallback(async () => {
    setShowLimitWarning(false);
    setError(null);
    const ok = await startGame();
    if (ok) {
      setPendingSubmitChoices(null);
      setResult(null);
      setChoices([]);
      setPower(1);
      powerRef.current = 1;
      setShield(false);
      shieldRef.current = false;
      setCurrentFloor(null);
      setRevealedLane(null);
    }
  }, [startGame, setError]);

  const handleCancel = useCallback(async () => {
    if (!session) return;
    await cancelGame();
    clearChoices(session.sessionId);
    setChoices([]);
    setPower(1);
    powerRef.current = 1;
    setShield(false);
    shieldRef.current = false;
    setCurrentFloor(null);
    setResult(null);
    setPendingSubmitChoices(null);
    setAnimState('idle');
    setSelectedLane(null);
    setRevealedLane(null);
    setIsAnimating(false);
    setShowSettleConfirm(false);
    setPhase('ready');
  }, [cancelGame, session]);

  const handleRetrySubmit = useCallback(() => {
    if (!pendingSubmitChoices || loading) return;
    setError(null);
    void handleSubmit(pendingSubmitChoices);
  }, [pendingSubmitChoices, loading, setError, handleSubmit]);

  const handleSettle = useCallback(() => {
    if (isAnimating || loading || pendingSubmitChoices !== null || choicesRef.current.length === 0) return;
    setShowSettleConfirm(true);
  }, [isAnimating, loading, pendingSubmitChoices]);

  const handleConfirmSettle = useCallback(() => {
    setShowSettleConfirm(false);
    setIsAnimating(true);
    void handleSubmit(choicesRef.current);
  }, [handleSubmit]);

  const handlePlayAgain = useCallback(async () => {
    setResult(null);
    setSelectedLane(null);
    setAnimState('idle');
    setIsAnimating(false);
    setPendingSubmitChoices(null);
    setChoices([]);
    setPower(1);
    powerRef.current = 1;
    setShield(false);
    shieldRef.current = false;
    setCurrentFloor(null);
    setRevealedLane(null);
    resetSubmitFlag();
    setPhase('ready');
    void fetchStatus();
  }, [fetchStatus, resetSubmitFlag]);

  const handleBackToGames = useCallback(() => {
    router.push('/games');
  }, [router]);

  const floorNumber = choices.length + 1;
  const hasPendingSubmit = pendingSubmitChoices !== null;

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {/* 背景 */}
      <div className="absolute inset-0 z-0 opacity-30 pointer-events-none">
        <div className="absolute top-0 -left-10 w-96 h-96 bg-red-300 rounded-full mix-blend-multiply filter blur-3xl animate-blob" />
        <div className="absolute top-0 -right-10 w-96 h-96 bg-amber-300 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000" />
        <div className="absolute -bottom-8 left-20 w-96 h-96 bg-violet-300 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000" />
      </div>

      <style jsx global>{`
        @keyframes blob {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        .animate-blob { animation: blob 7s infinite; }
        .animation-delay-2000 { animation-delay: 2s; }
        .animation-delay-4000 { animation-delay: 4s; }
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
          <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-slate-900 to-slate-700 tracking-tight mb-2 drop-shadow-sm">
            爬塔挑战
          </h1>
          <p className="text-slate-500 font-medium">选择路线，击败弱小的怪物来壮大自己，尽可能爬到更高层！</p>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50/90 backdrop-blur-sm border border-red-200 rounded-xl text-red-700 text-center animate-in slide-in-from-top-2">
            {error}
          </div>
        )}

        {hasPendingSubmit && (
          <div className="mb-6 p-4 bg-orange-50/90 backdrop-blur-sm border border-orange-200 rounded-xl animate-in slide-in-from-top-2">
            <div className="text-orange-800 font-semibold text-center">结算提交未完成</div>
            <div className="text-orange-700 text-sm text-center mt-1">
              本局已结束，但结算请求失败。请重试提交，或放弃本局以恢复正常操作。
            </div>
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                onClick={handleRetrySubmit}
                disabled={loading}
                className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                type="button"
              >
                {loading ? '提交中...' : '重试提交'}
              </button>
              <button
                onClick={handleCancel}
                disabled={loading}
                className="px-4 py-2 border border-slate-200 text-slate-600 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                type="button"
              >
                放弃本局
              </button>
            </div>
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
              <Zap className="w-8 h-8 text-amber-500 animate-pulse" />
            </div>
            <p className="text-slate-500 font-medium">加载中...</p>
          </div>
        )}

        {phase === 'ready' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white/90 backdrop-blur-md rounded-3xl p-8 shadow-sm border border-slate-100 relative overflow-hidden group hover:shadow-lg transition-all">
              <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                <Layers className="w-32 h-32 text-slate-900 rotate-12" />
              </div>
              <div className="relative z-10">
                <div className="flex items-start justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-2xl font-extrabold text-slate-900">开始爬塔</h2>
                    <p className="text-slate-500 mt-2">选择路线，一路向上，挑战最高层数。</p>
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-lg shadow-slate-200">
                    <Zap className="w-6 h-6" />
                  </div>
                </div>

                <button
                  onClick={handleStart}
                  disabled={loading || status?.inCooldown || hasPendingSubmit}
                  className="w-full py-4 px-6 bg-slate-900 hover:bg-slate-800 text-white font-bold text-lg rounded-2xl transition-all shadow-lg shadow-slate-200 hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
                >
                  {loading ? '处理中...' : '开始游戏'}
                </button>

                <div className="mt-6 space-y-3">
                  <div className="p-4 bg-slate-50 rounded-xl text-sm text-slate-500 leading-relaxed border border-slate-100">
                    <span className="font-semibold text-slate-700">玩法说明：</span>
                    初始力量值为 1，每层有 2-3 条通道。遇到比你弱的怪物可击败并吞噬它的数值；遇到不弱于你的怪物则 Game Over。
                  </div>
                  <div className="p-4 bg-amber-50 rounded-xl text-sm text-amber-700 leading-relaxed border border-amber-100">
                    <span className="font-semibold">积分规则：</span>
                    得分 = 爬过的层数转化积分（1-10层每层20分，11-20层每层15分，21-30层每层10分，31层起每层5分，单局上限1500分）。
                  </div>
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
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${i === 0 ? 'bg-yellow-50 border-yellow-100 text-yellow-600' : 'bg-white border-slate-200 text-slate-400'}`}>
                          {i === 0 ? <Trophy className="w-5 h-5" /> : <span className="font-bold text-sm">#{i + 1}</span>}
                        </div>
                        <div>
                          <div className="text-base font-bold text-slate-900 tabular-nums">
                            第 {r.floorsClimbed} 层
                          </div>
                          <div className="text-xs text-slate-500 tabular-nums">
                            力量 {r.finalPower} · {r.score} 分
                          </div>
                        </div>
                      </div>
                      <div className="text-sm font-extrabold text-emerald-600 tabular-nums bg-emerald-50 px-3 py-1 rounded-lg">
                        +{r.pointsEarned}
                      </div>
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

        {phase === 'playing' && session && currentFloor && (
          <div className="max-w-lg mx-auto animate-in fade-in duration-300">
            {/* 粘性状态栏 */}
            <GameHeader
              floorNumber={floorNumber}
              power={power}
              choicesCount={choices.length}
              powerChanged={powerChanged}
              hasShield={shield}
              isBossFloor={currentFloor.isBoss}
            />

            {/* 核心交互区 */}
            <div className="relative my-6">
              <LaneCards
                floor={currentFloor}
                playerPower={power}
                onChooseLane={handleChooseLane}
                disabled={isAnimating || loading || hasPendingSubmit}
                selectedLane={selectedLane}
                animState={animState}
                revealedLane={revealedLane}
                hasShield={shield}
              />
              <FloatingText items={floatingTexts} />
            </div>

            {/* 玩家角色标记 */}
            <div className="flex justify-center my-6">
              <div className="relative">
                <div className={`
                  w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-400 to-blue-600
                  flex items-center justify-center text-3xl shadow-lg shadow-blue-200
                  transition-all duration-300
                  ${animState === 'walking' ? 'animate-bounce' : ''}
                  ${animState === 'attacking' || animState === 'bossDefeated' ? 'scale-110' : ''}
                  ${animState === 'powerup' ? 'scale-110 ring-4 ring-yellow-300/50' : ''}
                  ${animState === 'shieldBlock' ? 'scale-110 ring-4 ring-blue-300/50' : ''}
                  ${animState === 'death' ? 'animate-death-flash' : ''}
                `}>
                  ⚔️
                </div>
                <div className="absolute -top-2 -right-2 bg-amber-500 text-white text-xs font-black px-1.5 py-0.5 rounded-lg shadow-sm tabular-nums">
                  {power}
                </div>
                {shield && (
                  <div className="absolute -top-2 -left-2 bg-blue-500 text-white text-xs px-1.5 py-0.5 rounded-lg shadow-sm">
                    🛡️
                  </div>
                )}
              </div>
            </div>

            {/* 操作栏 */}
            <div className="bg-white/90 backdrop-blur-md rounded-2xl p-4 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => setShowHelp((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-slate-400 hover:text-slate-600 transition-colors font-medium px-2 py-1 rounded-lg hover:bg-slate-50"
                  type="button"
                >
                  <HelpCircle className="w-4 h-4" />
                  帮助
                </button>
                <button
                  onClick={handleSettle}
                  disabled={loading || isAnimating || choices.length === 0 || hasPendingSubmit}
                  className="inline-flex items-center gap-1.5 text-emerald-600 hover:text-emerald-700 font-semibold px-3 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed border border-emerald-200 hover:border-emerald-300 disabled:border-transparent"
                  type="button"
                >
                  <Flag className="w-4 h-4" />
                  主动结算
                </button>
                <button
                  onClick={handleCancel}
                  disabled={loading || isAnimating}
                  className="inline-flex items-center gap-1.5 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed font-medium px-2 py-1 rounded-lg hover:bg-red-50"
                  type="button"
                >
                  <X className="w-4 h-4" />
                  放弃游戏
                </button>
              </div>

              {isRestored && (
                <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-700 text-xs font-medium text-center">
                  已恢复中断的游戏进度
                </div>
              )}

              {showHelp && (
                <div className="mt-3 space-y-2 animate-slide-up">
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-red-50 text-sm">
                    <span className="text-lg">👾</span>
                    <span className="text-slate-600">
                      <span className="font-bold text-red-600">怪物</span> — 力量 &gt; 怪物数值可击败并吞噬，否则 Game Over
                    </span>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-green-50 text-sm">
                    <span className="text-lg">💚</span>
                    <span className="text-slate-600">
                      <span className="font-bold text-green-600">加法增益</span> — 直接增加力量值
                    </span>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-50 text-sm">
                    <span className="text-lg">⭐</span>
                    <span className="text-slate-600">
                      <span className="font-bold text-amber-600">乘法增益</span> — 力量值翻倍
                    </span>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-orange-50 text-sm">
                    <span className="text-lg">💀</span>
                    <span className="text-slate-600">
                      <span className="font-bold text-orange-600">Boss</span> — 每10层出现，击败获得双倍数值奖励
                    </span>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-blue-50 text-sm">
                    <span className="text-lg">🛡️</span>
                    <span className="text-slate-600">
                      <span className="font-bold text-blue-600">护盾</span> — 获得护盾可抵挡一次致命攻击；已有护盾时转化为力量
                    </span>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-purple-50 text-sm">
                    <span className="text-lg">❓</span>
                    <span className="text-slate-600">
                      <span className="font-bold text-purple-600">迷雾</span> — 隐藏通道内容，选择后揭示真实效果
                    </span>
                  </div>
                  {status?.pointsLimitReached && (
                    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-orange-50 border border-orange-100 text-sm">
                      <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0" />
                      <span className="text-orange-700">今日积分已达上限，本局不获得积分</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 结算弹窗 */}
        {phase === 'result' && result && (
          <ResultModal
            floorsClimbed={result.floorsClimbed}
            finalPower={result.finalPower}
            gameOver={result.gameOver}
            score={result.score}
            pointsEarned={result.pointsEarned}
            onPlayAgain={handlePlayAgain}
            onBackToGames={handleBackToGames}
          />
        )}

        {/* 主动结算确认 */}
        {showSettleConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
              <div className="text-center">
                <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-emerald-100 rotate-3">
                  <Flag className="w-8 h-8 text-emerald-500" />
                </div>
                <h3 className="text-xl font-extrabold text-slate-900 mb-2">确认结算？</h3>
                <p className="text-slate-500 mb-4 leading-relaxed text-sm">
                  当前已爬到第 <span className="font-bold text-slate-900 tabular-nums">{choices.length}</span> 层，
                  力量值 <span className="font-bold text-slate-900 tabular-nums">{power}</span>。
                </p>
                <p className="text-slate-400 mb-8 text-xs">
                  结算后将按已通过的层数计算积分，本局结束。
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowSettleConfirm(false)}
                    className="flex-1 py-3 px-4 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors"
                    type="button"
                  >
                    继续攀爬
                  </button>
                  <button
                    onClick={handleConfirmSettle}
                    className="flex-1 py-3 px-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl transition-colors shadow-lg shadow-emerald-200"
                    type="button"
                  >
                    确认结算
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
                  <br />
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
