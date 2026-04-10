// src/app/games/tower/page.tsx

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronLeft, Flag, HelpCircle, Shield, Star, X, Zap } from 'lucide-react';
import LaneCards from './components/LaneCards';
import FloatingText from './components/FloatingText';
import type { FloatingTextItem } from './components/FloatingText';
import GameHeader from './components/GameHeader';
import ResultModal from './components/ResultModal';
import DifficultySelect from './components/DifficultySelect';
import { useGameSession } from './hooks/useGameSession';
import type { TowerStepOutcome } from './hooks/useGameSession';
import {
  ANIM_ATTACK_DURATION,
  ANIM_BOSS_DEFEAT_DURATION,
  ANIM_DEATH_DURATION,
  ANIM_POWERUP_DURATION,
  ANIM_REVEAL_DURATION,
  ANIM_SHIELD_BLOCK_DURATION,
  ANIM_SHOP_DURATION,
  ANIM_TRAP_DURATION,
  ANIM_WALK_DURATION,
} from './lib/constants';
import {
  BLESSING_ICONS,
  BLESSING_LABELS,
  BUFF_LABELS,
  CURSE_ICONS,
  CURSE_LABELS,
  formatPower,
  type ResolvedLaneContent,
  type TowerDifficulty,
} from '@/lib/tower-engine';

type Phase = 'ready' | 'selectDifficulty' | 'playing' | 'result';
type AnimState =
  | 'idle'
  | 'walking'
  | 'attacking'
  | 'powerup'
  | 'death'
  | 'revealing'
  | 'shieldBlock'
  | 'bossDefeated'
  | 'trapped'
  | 'shopping';
type TimerHandle = ReturnType<typeof setTimeout> | number;

function getAnimState(lane: ResolvedLaneContent, outcome: TowerStepOutcome): AnimState {
  if (outcome.gameOver) return 'death';
  if (outcome.blockedByShield) return 'shieldBlock';
  if (lane.type === 'boss') return 'bossDefeated';
  if (lane.type === 'monster') return 'attacking';
  if (lane.type === 'trap') return 'trapped';
  if (lane.type === 'shop') return 'shopping';
  return 'powerup';
}

function getAnimDuration(lane: ResolvedLaneContent, outcome: TowerStepOutcome): number {
  if (outcome.gameOver) return ANIM_DEATH_DURATION;
  if (outcome.blockedByShield) return ANIM_SHIELD_BLOCK_DURATION;
  if (lane.type === 'boss') return ANIM_BOSS_DEFEAT_DURATION;
  if (lane.type === 'monster') return ANIM_ATTACK_DURATION;
  if (lane.type === 'trap') return ANIM_TRAP_DURATION;
  if (lane.type === 'shop') return ANIM_SHOP_DURATION;
  return ANIM_POWERUP_DURATION;
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
    stepGame,
    submitResult,
    resetSubmitFlag,
    setError,
    setSession,
  } = useGameSession();

  const [phase, setPhase] = useState<Phase>('ready');
  const [animState, setAnimState] = useState<AnimState>('idle');
  const [selectedLane, setSelectedLane] = useState<number | null>(null);
  const [revealedLane, setRevealedLane] = useState<ResolvedLaneContent | null>(null);
  const [floatingTexts, setFloatingTexts] = useState<FloatingTextItem[]>([]);
  const [showHelp, setShowHelp] = useState(false);
  const [showLimitWarning, setShowLimitWarning] = useState(false);
  const [showSettleConfirm, setShowSettleConfirm] = useState(false);
  const [powerChanged, setPowerChanged] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [result, setResult] = useState<{
    floorsClimbed: number;
    finalPower: number;
    gameOver: boolean;
    score: number;
    pointsEarned: number;
    bossesDefeated: number;
    maxCombo: number;
    basePoints: number;
    bossPoints: number;
    comboPoints: number;
    perfectPoints: number;
    difficulty?: TowerDifficulty;
    difficultyMultiplier?: number;
  } | null>(null);

  const animTimersRef = useRef<Set<TimerHandle>>(new Set());
  const floatingIdRef = useRef(0);
  const restoredSubmitRef = useRef<string | null>(null);
  const effectivePhase: Phase = session ? 'playing' : result ? 'result' : phase;

  const scheduleTimer = useCallback((callback: () => void, delay: number) => {
    const timerId = window.setTimeout(() => {
      animTimersRef.current.delete(timerId);
      callback();
    }, delay);
    animTimersRef.current.add(timerId);
    return timerId;
  }, []);

  const resetAnimationState = useCallback(() => {
    setAnimState('idle');
    setSelectedLane(null);
    setRevealedLane(null);
    setIsAnimating(false);
  }, []);

  const addFloatingText = useCallback((text: string, color: string) => {
    const id = ++floatingIdRef.current;
    setFloatingTexts((prev) => [...prev, { id, text, color }]);
    scheduleTimer(() => {
      setFloatingTexts((prev) => prev.filter((item) => item.id !== id));
    }, 1200);
  }, [scheduleTimer]);

  const flashPower = useCallback(() => {
    setPowerChanged(true);
    scheduleTimer(() => setPowerChanged(false), 300);
  }, [scheduleTimer]);

  useEffect(() => {
    const timers = animTimersRef.current;
    return () => {
      for (const timerId of timers) {
        clearTimeout(timerId);
      }
      timers.clear();
    };
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (effectivePhase !== 'ready' || !status?.inCooldown) return;
    const timer = window.setInterval(() => {
      void fetchStatus();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [effectivePhase, fetchStatus, status?.inCooldown]);

  const handleSubmit = useCallback(async () => {
    if (!session) {
      setPendingSubmit(false);
      setIsAnimating(false);
      return;
    }

    setPendingSubmit(true);
    const res = await submitResult();
    if (!res) {
      setPendingSubmit(false);
      setIsAnimating(false);
      return;
    }

    if ('failed' in res) {
      setIsAnimating(false);
      if (res.expired) {
        setPendingSubmit(false);
        setSession(null);
        setPhase('ready');
        void fetchStatus();
      }
      return;
    }

    setPendingSubmit(false);
    resetAnimationState();
    setResult({
      floorsClimbed: res.record.floorsClimbed,
      finalPower: res.record.finalPower,
      gameOver: res.record.gameOver,
      score: res.record.score,
      pointsEarned: res.pointsEarned,
      bossesDefeated: res.record.bossesDefeated ?? 0,
      maxCombo: res.record.maxCombo ?? 0,
      basePoints: res.record.basePoints ?? res.record.score,
      bossPoints: res.record.bossPoints ?? 0,
      comboPoints: res.record.comboPoints ?? 0,
      perfectPoints: res.record.perfectPoints ?? 0,
      difficulty: res.record.difficulty,
      difficultyMultiplier: res.record.difficultyMultiplier,
    });
    setPhase('result');
  }, [fetchStatus, resetAnimationState, session, setSession, submitResult]);

  useEffect(() => {
    if (!session?.gameOver || !isRestored || pendingSubmit) return;
    if (restoredSubmitRef.current === session.sessionId) return;
    restoredSubmitRef.current = session.sessionId;
    const timer = window.setTimeout(() => {
      void handleSubmit();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [handleSubmit, isRestored, pendingSubmit, session]);

  const handleChooseLane = useCallback((laneIndex: number) => {
    if (
      effectivePhase !== 'playing' ||
      !session ||
      !session.currentFloor ||
      session.gameOver ||
      isAnimating ||
      loading ||
      pendingSubmit
    ) {
      return;
    }

    const currentSession = session;
    const currentFloor = session.currentFloor;
    const rawLane = currentFloor.lanes[laneIndex];

    setSelectedLane(laneIndex);
    setAnimState('walking');
    setIsAnimating(true);
    setError(null);

    const stepPromise = stepGame(currentSession.sessionId, laneIndex);

    const commitOutcome = async () => {
      const res = await stepPromise;
      if (!res) {
        resetAnimationState();
        return;
      }

      const nextSession = res.session;
      const outcome = res.outcome;
      const resolvedLane = outcome.selectedLane;
      const powerDelta = nextSession.player.power - currentSession.player.power;

      if (powerDelta !== 0) {
        flashPower();
      }
      if (powerDelta > 0) {
        addFloatingText(`+${formatPower(powerDelta)}`, resolvedLane.type === 'boss' ? '#ff6d00' : '#22c55e');
      } else if (powerDelta < 0) {
        addFloatingText(`${powerDelta}`, '#f44336');
      }
      if (outcome.blockedByShield) {
        addFloatingText('护盾抵挡!', '#42a5f5');
      }
      if (outcome.newBuff) {
        addFloatingText(`${BUFF_LABELS[outcome.newBuff]}!`, '#a855f7');
      }
      if (outcome.newBlessing) {
        const blessing = outcome.newBlessing;
        addFloatingText(`${BLESSING_ICONS[blessing.type]} ${BLESSING_LABELS[blessing.type]}!`, '#d4a017');
      }
      if (outcome.newCurse) {
        const curse = outcome.newCurse;
        addFloatingText(`${CURSE_ICONS[curse.type]} ${CURSE_LABELS[curse.type]}!`, '#dc2626');
      }
      for (const blessingType of outcome.expiredBlessings) {
        addFloatingText(`${BLESSING_ICONS[blessingType]} ${BLESSING_LABELS[blessingType]} 消退`, '#9ca3af');
      }
      for (const curseType of outcome.expiredCurses) {
        addFloatingText(`${CURSE_ICONS[curseType]} ${CURSE_LABELS[curseType]} 解除`, '#22c55e');
      }

      setAnimState(getAnimState(resolvedLane, outcome));
      if (outcome.gameOver) {
        addFloatingText('GAME OVER', '#ff1744');
      }

      scheduleTimer(() => {
        setSession(nextSession);
        if (outcome.gameOver) {
          void handleSubmit();
          return;
        }
        resetAnimationState();
      }, getAnimDuration(resolvedLane, outcome));
    };

    scheduleTimer(() => {
      if (rawLane?.type === 'mystery') {
        void stepPromise.then((res) => {
          if (!res) {
            resetAnimationState();
            return;
          }
          setRevealedLane(res.outcome.selectedLane);
          setAnimState('revealing');
          scheduleTimer(() => {
            void commitOutcome();
          }, ANIM_REVEAL_DURATION);
        });
        return;
      }
      void commitOutcome();
    }, ANIM_WALK_DURATION);
  }, [
    addFloatingText,
    flashPower,
    handleSubmit,
    isAnimating,
    loading,
    pendingSubmit,
    effectivePhase,
    resetAnimationState,
    scheduleTimer,
    session,
    setError,
    setSession,
    stepGame,
  ]);

  const handleStart = useCallback(() => {
    if (status?.pointsLimitReached) {
      setShowLimitWarning(true);
      return;
    }
    setError(null);
    setPhase('selectDifficulty');
  }, [setError, status?.pointsLimitReached]);

  const handleDifficultySelect = useCallback(async (difficulty: TowerDifficulty) => {
    const ok = await startGame(difficulty);
    if (!ok) {
      setPhase('ready');
      return;
    }
    restoredSubmitRef.current = null;
    setPendingSubmit(false);
    setResult(null);
    resetAnimationState();
  }, [resetAnimationState, startGame]);

  const handleCancel = useCallback(async () => {
    const ok = await cancelGame();
    if (!ok) return;
    resetAnimationState();
    setPendingSubmit(false);
    setShowSettleConfirm(false);
    setResult(null);
    restoredSubmitRef.current = null;
    setPhase('ready');
  }, [cancelGame, resetAnimationState]);

  const handleRetrySubmit = useCallback(() => {
    if (!session || loading) return;
    setError(null);
    void handleSubmit();
  }, [handleSubmit, loading, session, setError]);

  const handlePlayAgain = useCallback(async () => {
    setResult(null);
    restoredSubmitRef.current = null;
    resetAnimationState();
    setPendingSubmit(false);
    resetSubmitFlag();
    setPhase('ready');
    await fetchStatus();
  }, [fetchStatus, resetAnimationState, resetSubmitFlag]);

  const floorNumber = session?.floorNumber ?? 1;
  const currentFloor = session?.currentFloor ?? null;
  const player = session?.player;
  const choicesCount = session?.choicesCount ?? 0;
  const power = player?.power ?? 1;
  const shield = player?.shield ?? 0;
  const combo = player?.combo ?? 0;
  const buffs = player?.buffs ?? [];
  const blessings = player?.blessings ?? [];
  const curses = player?.curses ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col px-4 pb-6">
        <div className="flex items-center justify-between px-2 pt-6 pb-4">
          <button
            onClick={() => router.push('/games')}
            className="group flex items-center gap-1.5 rounded-2xl border border-white/40 bg-white/70 px-4 py-2 text-sm font-medium text-slate-500 shadow-sm transition-all hover:bg-white hover:text-slate-800"
          >
            <ChevronLeft className="h-5 w-5 group-hover:-translate-x-0.5 transition-transform" />
            返回
          </button>

          <Link
            href="/store"
            className="flex items-center gap-2 rounded-2xl border border-white/40 bg-white/70 px-4 py-2 text-slate-700 shadow-sm transition-all hover:text-amber-600"
          >
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100">
              <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
            </div>
            <span className="text-sm font-bold tabular-nums">{status?.balance ?? '...'}</span>
          </Link>
        </div>

        <div className="mb-4 text-center">
          <h1 className="text-3xl font-black tracking-tight text-slate-800">无限爬塔</h1>
          <p className="mt-1 text-xs font-medium text-slate-500">迷雾与结算全部由服务端判定</p>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-red-200/50 bg-red-50/90 p-4 text-center text-sm font-bold text-red-600 shadow-sm">
            {error}
          </div>
        )}

        {pendingSubmit && session && (
          <div className="mb-4 rounded-2xl border border-orange-200/50 bg-orange-50/90 p-4 shadow-sm">
            <div className="mb-2 text-center text-sm font-bold text-orange-800">本局正在结算</div>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={handleRetrySubmit}
                disabled={loading}
                className="rounded-xl bg-orange-500 px-4 py-2 text-xs font-bold text-white transition-all disabled:opacity-50"
              >
                {loading ? '重试中...' : '重试提交'}
              </button>
              <button
                onClick={handleCancel}
                disabled={loading}
                className="rounded-xl border border-orange-200 bg-white/60 px-4 py-2 text-xs font-bold text-orange-600 transition-all disabled:opacity-50"
              >
                放弃本局
              </button>
            </div>
          </div>
        )}

        {status?.inCooldown && effectivePhase === 'ready' && (
          <div className="mb-6 rounded-3xl border border-white/20 bg-slate-900/5 p-6 text-center">
            <div className="text-4xl font-black tabular-nums text-slate-700">
              {status.cooldownRemaining}<span className="ml-1 text-base font-medium text-slate-400">s</span>
            </div>
            <div className="mt-2 text-sm font-medium text-slate-500">稍等片刻再开始</div>
          </div>
        )}

        {effectivePhase === 'ready' && (
          <div className="flex flex-1 flex-col gap-6">
            <div className="rounded-[2rem] border border-white/50 bg-white/70 p-8 shadow-sm">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-200">
                <Zap className="h-8 w-8" />
              </div>
              <div className="text-center">
                <h2 className="text-2xl font-black text-slate-800">准备出发</h2>
                <p className="mt-2 text-sm font-medium text-slate-500">不再依赖本地推演，断线恢复也以服务端进度为准</p>
              </div>
              <button
                onClick={handleStart}
                disabled={loading || status?.inCooldown || pendingSubmit}
                className="mt-8 w-full rounded-2xl bg-slate-900 px-6 py-4 text-lg font-bold text-white transition-all disabled:opacity-60"
              >
                {loading ? '处理中...' : '开始冒险'}
              </button>
            </div>

            {status?.records?.length ? (
              <div className="rounded-3xl border border-white/30 bg-white/40 p-6">
                <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-500">最近高光</h3>
                <div className="space-y-3">
                  {status.records.slice(0, 3).map((record, index) => (
                    <div key={record.id} className="flex items-center justify-between rounded-xl border border-white/40 bg-white/60 p-3 shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${index === 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-100 text-slate-500'}`}>
                          #{index + 1}
                        </div>
                        <div>
                          <div className="text-sm font-bold text-slate-700">{record.floorsClimbed}层</div>
                          <div className="text-[10px] text-slate-400">力量 {formatPower(record.finalPower)}</div>
                        </div>
                      </div>
                      <div className="text-sm font-black text-emerald-600">+{record.pointsEarned}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {effectivePhase === 'selectDifficulty' && (
          <div className="flex flex-1 flex-col justify-center pb-10">
            <DifficultySelect onSelect={handleDifficultySelect} disabled={loading} />
            <div className="mt-8 text-center">
              <button
                onClick={() => setPhase('ready')}
                disabled={loading}
                className="rounded-full bg-white/50 px-6 py-2 text-sm font-medium text-slate-500 shadow-sm transition-all hover:bg-white/80 hover:text-slate-800"
              >
                取消，我再想想
              </button>
            </div>
          </div>
        )}

        {effectivePhase === 'playing' && session && currentFloor && player && (
          <div className="flex flex-1 flex-col min-h-0">
            <GameHeader
              floorNumber={floorNumber}
              power={power}
              choicesCount={choicesCount}
              powerChanged={powerChanged}
              hasShield={shield > 0}
              shieldCount={shield}
              isBossFloor={currentFloor.isBoss}
              isShopFloor={currentFloor.isShop}
              combo={combo}
              buffs={buffs}
              difficulty={session.difficulty}
              themeFloor={currentFloor.theme}
              blessings={blessings}
              curses={curses}
            />

            <div className="relative my-2 flex min-h-[300px] flex-1 flex-col justify-center">
              <LaneCards
                floor={currentFloor}
                playerPower={power}
                onChooseLane={handleChooseLane}
                disabled={isAnimating || loading || pendingSubmit}
                selectedLane={selectedLane}
                animState={animState}
                revealedLane={revealedLane}
                hasShield={shield > 0}
                shieldCount={shield}
                combo={combo}
                buffs={buffs}
                blessings={blessings}
                curses={curses}
              />
              <FloatingText items={floatingTexts} />
            </div>

            <div className="mb-6 mt-auto flex justify-center">
              <div className="relative">
                <div className={`flex h-20 w-20 items-center justify-center rounded-3xl border-4 border-white bg-gradient-to-br from-slate-900 to-slate-800 text-4xl shadow-xl shadow-slate-300 transition-all duration-300 ${animState === 'walking' ? 'animate-bounce' : ''}`}>
                  <span>⚔️</span>
                </div>
                <div className="absolute -top-3 -right-3 rounded-xl border-2 border-white bg-amber-500 px-2.5 py-1 text-sm font-black text-white shadow-lg shadow-amber-200">
                  {formatPower(power)}
                </div>
                {shield > 0 && (
                  <div className="absolute -top-3 -left-3 flex items-center gap-0.5 rounded-xl border-2 border-white bg-blue-500 px-2 py-1 text-xs font-bold text-white shadow-lg shadow-blue-200">
                    <Shield className="h-3 w-3 fill-current" />
                    {shield > 1 && <span>x{shield}</span>}
                  </div>
                )}
              </div>
            </div>

            <div className="mx-4 mb-2 flex items-center justify-between rounded-2xl border border-white/50 bg-white/80 p-2 shadow-sm">
              <button
                onClick={() => setShowHelp((value) => !value)}
                className="rounded-xl p-3 text-slate-400 transition-all hover:bg-indigo-50 hover:text-indigo-600"
              >
                <HelpCircle className="h-5 w-5" />
              </button>

              {isRestored && (
                <div className="rounded-full border border-amber-100 bg-amber-50 px-3 py-1 text-[10px] font-bold text-amber-700">
                  恢复存档
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setShowSettleConfirm(true)}
                  disabled={loading || isAnimating || choicesCount === 0 || pendingSubmit}
                  className="rounded-xl bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-600 transition-colors disabled:opacity-50"
                >
                  结算
                </button>
                <button
                  onClick={handleCancel}
                  disabled={loading || isAnimating}
                  className="rounded-xl bg-slate-50 px-4 py-2 text-xs font-bold text-slate-400 transition-colors disabled:opacity-50"
                >
                  放弃
                </button>
              </div>
            </div>

            {showHelp && (
              <div className="fixed inset-x-4 bottom-24 z-50 rounded-[2rem] border border-white/50 bg-white/95 p-6 shadow-2xl backdrop-blur-xl">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-black text-slate-800">游戏指南</h3>
                  <button onClick={() => setShowHelp(false)} className="rounded-full bg-slate-100 p-2">
                    <X className="h-4 w-4 text-slate-500" />
                  </button>
                </div>
                <div className="space-y-2 text-xs text-slate-600">
                  <p>1. 当前楼层只返回你应该看到的信息，迷雾不会提前泄露。</p>
                  <p>2. Boss 祝福持续 5 层，陷阱诅咒持续 3 层，都会从下一层开始扣层数。</p>
                  <p>3. 刷新页面会按服务端快照恢复，不会再依赖本地存档。</p>
                </div>
              </div>
            )}
          </div>
        )}

        {effectivePhase === 'result' && result && (
          <ResultModal
            floorsClimbed={result.floorsClimbed}
            finalPower={result.finalPower}
            gameOver={result.gameOver}
            score={result.score}
            pointsEarned={result.pointsEarned}
            bossesDefeated={result.bossesDefeated}
            maxCombo={result.maxCombo}
            basePoints={result.basePoints}
            bossPoints={result.bossPoints}
            comboPoints={result.comboPoints}
            perfectPoints={result.perfectPoints}
            difficulty={result.difficulty}
            difficultyMultiplier={result.difficultyMultiplier}
            onPlayAgain={handlePlayAgain}
            onBackToGames={() => router.push('/games')}
          />
        )}

        {showSettleConfirm && session && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-md">
            <div className="w-full max-w-sm rounded-[2rem] bg-white p-8 shadow-2xl">
              <div className="text-center">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50">
                  <Flag className="h-8 w-8 text-emerald-500" />
                </div>
                <h3 className="mb-2 text-xl font-extrabold text-slate-900">确认结算？</h3>
                <p className="mb-6 text-sm leading-relaxed text-slate-500">
                  已爬到第 <span className="font-bold text-slate-900 tabular-nums">{session.choicesCount}</span> 层，
                  力量 <span className="font-bold text-slate-900 tabular-nums">{formatPower(session.player.power)}</span>
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowSettleConfirm(false)}
                    className="flex-1 rounded-xl bg-slate-50 px-4 py-3 font-bold text-slate-600"
                    type="button"
                  >
                    再想想
                  </button>
                  <button
                    onClick={() => {
                      setShowSettleConfirm(false);
                      setIsAnimating(true);
                      void handleSubmit();
                    }}
                    className="flex-1 rounded-xl bg-emerald-500 px-4 py-3 font-bold text-white shadow-lg shadow-emerald-200"
                    type="button"
                  >
                    确认带走
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showLimitWarning && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-md">
            <div className="w-full max-w-sm rounded-[2rem] bg-white p-8 shadow-2xl">
              <div className="text-center">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-orange-100 bg-orange-50">
                  <AlertTriangle className="h-8 w-8 text-orange-500" />
                </div>
                <h3 className="mb-2 text-xl font-extrabold text-slate-900">积分已达上限</h3>
                <p className="mb-8 text-sm leading-relaxed text-slate-500">
                  今日已获得 <span className="font-bold text-orange-600 tabular-nums">{status?.dailyStats?.pointsEarned ?? 0}</span> 积分，
                  继续游戏将无法获得新的积分。
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowLimitWarning(false)}
                    className="flex-1 rounded-xl border border-slate-200 px-4 py-3 font-bold text-slate-600"
                    type="button"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => {
                      setShowLimitWarning(false);
                      setPhase('selectDifficulty');
                    }}
                    className="flex-1 rounded-xl bg-orange-500 px-4 py-3 font-bold text-white shadow-lg shadow-orange-200"
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
