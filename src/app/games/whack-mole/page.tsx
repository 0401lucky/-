'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, Bomb, Hammer, RotateCcw, Sparkles, Target, Timer, Trophy, X, Zap } from 'lucide-react';
import {
  WHACK_MOLE_BOMB_PENALTY,
  WHACK_MOLE_END_REFRESH_MS,
  WHACK_MOLE_GAME_DURATION_MS,
  WHACK_MOLE_GOLDEN_POINTS,
  WHACK_MOLE_MAX_BOMBS,
  WHACK_MOLE_MAX_COMBO_BONUS,
  WHACK_MOLE_NORMAL_POINTS,
  WHACK_MOLE_START_REFRESH_MS,
  WHACK_MOLE_WIN_SCORE,
  calculateWhackMolePointReward,
  createEmptyWhackMoleBoard,
  getWhackMoleBoard,
  getWhackMoleBombCount,
  getWhackMoleRefreshMs,
  getWhackMoleScoreDelta,
  getWhackMoleTickIndex,
  scoreWhackMoleEvents,
  type WhackMoleCell,
  type WhackMoleHitEvent,
  type WhackMoleHitResult,
} from '@/lib/whack-mole-engine';

type GamePhase = 'ready' | 'playing' | 'submitting' | 'finished';
type FeedbackState = 'hit' | 'goldenHit' | 'bombHit';
type DisplayHoleState = WhackMoleCell | FeedbackState;

interface WhackMoleSessionView {
  sessionId: string;
  seed: string;
  startedAt: number;
  expiresAt: number;
  durationMs: number;
  board: WhackMoleCell[];
  boardTick: number;
  timeLeftMs: number;
  score: number;
  combo: number;
  eventsCount: number;
}

interface WhackMoleSession {
  sessionId: string;
  seed: string;
  startedAt: number;
  expiresAt: number;
  durationMs: number;
}

interface WhackMoleRecord {
  id: string;
  score: number;
  pointsEarned: number;
  hits: number;
  goldenHits: number;
  misses: number;
  bombs: number;
  maxCombo: number;
  createdAt: number;
}

interface WhackMoleStatus {
  balance: number;
  dailyStats: { gamesPlayed: number; pointsEarned: number };
  inCooldown: boolean;
  cooldownRemaining: number;
  dailyLimit: number;
  pointsLimitReached: boolean;
  records: WhackMoleRecord[];
  activeSession: WhackMoleSessionView | null;
}

interface SubmitResult {
  record: WhackMoleRecord;
  pointsEarned: number;
}

interface PersistedEvents {
  sessionId: string;
  events: WhackMoleHitEvent[];
}

const BOARD_SIZE = 4;
const BEST_SCORE_KEY = 'lucky-whack-mole-best-score';
const EVENTS_PERSIST_KEY = 'lucky-whack-mole-events';
const FEEDBACK_DURATION_MS = 520;
const TIMER_TICK_MS = 80;
const MOLE_IMAGE_SRC = '/images/games/whack-mole.png';
const GOLDEN_MOLE_IMAGE_SRC = '/images/games/whack-mole-golden.png';
const HIT_MOLE_IMAGE_SRC = '/images/games/whack-mole-hit.png';
const GOLDEN_HIT_MOLE_IMAGE_SRC = '/images/games/whack-mole-golden-hit.png';
const HOLE_BACKGROUND_IMAGE_SRC = '/images/games/whack-mole-hole-bg.png';
const BOMB_IMAGE_SRC = '/images/games/whack-mole-bomb.png';

async function parseJson<T>(res: Response): Promise<{ success?: boolean; data?: T; message?: string } | null> {
  try {
    return (await res.json()) as { success?: boolean; data?: T; message?: string };
  } catch {
    return null;
  }
}

function formatTime(ms: number) {
  return Math.max(0, Math.ceil(ms / 1000));
}

function getHoleLabel(state: DisplayHoleState) {
  if (state === 'mole') return '地鼠';
  if (state === 'golden') return '金色地鼠';
  if (state === 'hit') return '被打地鼠';
  if (state === 'goldenHit') return '被打金色地鼠';
  if (state === 'bomb' || state === 'bombHit') return '炸弹';
  return '空洞';
}

function getHitMessage(result: WhackMoleHitResult, delta: number, combo: number) {
  if (result === 'golden_hit') return `金色地鼠 +${delta}，连击 ${combo}`;
  if (result === 'hit') return `命中 +${delta}，连击 ${combo}`;
  if (result === 'bomb') return `踩到炸弹 ${delta}，连击清空`;
  if (result === 'duplicate') return '这一格已经敲过，连击中断';
  return '打空了，连击中断';
}

function getCellResult(cell: WhackMoleCell): WhackMoleHitResult {
  if (cell === 'mole') return 'hit';
  if (cell === 'golden') return 'golden_hit';
  if (cell === 'bomb') return 'bomb';
  return 'miss';
}

function projectHit(cell: WhackMoleCell, scoreBefore: number, comboBefore: number) {
  const result = getCellResult(cell);
  if (cell === 'mole' || cell === 'golden') {
    const scoreDelta = getWhackMoleScoreDelta(cell, comboBefore);
    return {
      result,
      scoreDelta,
      comboAfter: comboBefore + 1,
      feedbackState: result === 'golden_hit' ? 'goldenHit' as const : 'hit' as const,
    };
  }

  if (cell === 'bomb') {
    const nextScore = Math.max(0, scoreBefore - WHACK_MOLE_BOMB_PENALTY);
    return {
      result,
      scoreDelta: nextScore - scoreBefore,
      comboAfter: 0,
      feedbackState: 'bombHit' as const,
    };
  }

  return {
    result,
    scoreDelta: 0,
    comboAfter: 0,
    feedbackState: null,
  };
}

function loadPersistedEvents(sessionId: string): WhackMoleHitEvent[] {
  try {
    const raw = window.localStorage.getItem(EVENTS_PERSIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<PersistedEvents> | null;
    if (!parsed || parsed.sessionId !== sessionId || !Array.isArray(parsed.events)) return [];
    return parsed.events
      .filter((event): event is WhackMoleHitEvent =>
        Boolean(event)
        && typeof event === 'object'
        && typeof (event as WhackMoleHitEvent).index === 'number'
        && typeof (event as WhackMoleHitEvent).elapsedMs === 'number',
      )
      .map((event) => ({
        index: Math.floor(event.index),
        elapsedMs: Math.floor(event.elapsedMs),
      }))
      .filter((event) =>
        Number.isInteger(event.index)
        && event.index >= 0
        && event.index < 16
        && Number.isInteger(event.elapsedMs)
        && event.elapsedMs >= 0
        && event.elapsedMs < WHACK_MOLE_GAME_DURATION_MS,
      );
  } catch {
    return [];
  }
}

function savePersistedEvents(sessionId: string, events: WhackMoleHitEvent[]) {
  try {
    const payload: PersistedEvents = { sessionId, events };
    window.localStorage.setItem(EVENTS_PERSIST_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / privacy errors — losing recovery is acceptable
  }
}

function clearPersistedEvents() {
  try {
    window.localStorage.removeItem(EVENTS_PERSIST_KEY);
  } catch {
    // ignore
  }
}

export default function WhackMolePage() {
  const [phase, setPhase] = useState<GamePhase>('ready');
  const [session, setSession] = useState<WhackMoleSession | null>(null);
  const [status, setStatus] = useState<WhackMoleStatus | null>(null);
  const [board, setBoard] = useState<WhackMoleCell[]>(() => createEmptyWhackMoleBoard());
  const [boardTick, setBoardTick] = useState(0);
  const [timeLeftMs, setTimeLeftMs] = useState(WHACK_MOLE_GAME_DURATION_MS);
  const [localScore, setLocalScore] = useState(0);
  const [localCombo, setLocalCombo] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [lastHit, setLastHit] = useState('准备开始');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WhackMoleRecord | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [hitFeedback, setHitFeedback] = useState<Partial<Record<number, FeedbackState>>>({});

  const submittedRef = useRef(false);
  const sessionRef = useRef<WhackMoleSession | null>(null);
  const phaseRef = useRef<GamePhase>('ready');
  const boardRef = useRef<WhackMoleCell[]>(createEmptyWhackMoleBoard());
  const boardTickRef = useRef(0);
  const hiddenTargetKeysRef = useRef<Set<string>>(new Set());
  const eventsRef = useRef<WhackMoleHitEvent[]>([]);
  const localScoreRef = useRef(0);
  const localComboRef = useRef(0);
  const feedbackTimersRef = useRef<Partial<Record<number, number>>>({});

  const setRoundPhase = useCallback((nextPhase: GamePhase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const clearHitFeedback = useCallback(() => {
    for (const timer of Object.values(feedbackTimersRef.current)) {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    }
    feedbackTimersRef.current = {};
    setHitFeedback({});
  }, []);

  const showHoleFeedback = useCallback((index: number, state: FeedbackState, durationMs = FEEDBACK_DURATION_MS) => {
    const existingTimer = feedbackTimersRef.current[index];
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    setHitFeedback((current) => ({ ...current, [index]: state }));
    feedbackTimersRef.current[index] = window.setTimeout(() => {
      setHitFeedback((current) => {
        const next = { ...current };
        delete next[index];
        return next;
      });
      delete feedbackTimersRef.current[index];
    }, durationMs);
  }, []);

  const updateLocalProgress = useCallback((nextScore: number, nextCombo: number) => {
    localScoreRef.current = nextScore;
    localComboRef.current = nextCombo;
    setLocalScore(nextScore);
    setLocalCombo(nextCombo);
  }, []);

  const setBoardForElapsed = useCallback((seed: string, elapsedMs: number) => {
    const boardElapsedMs = Math.min(Math.max(0, elapsedMs), WHACK_MOLE_GAME_DURATION_MS - 1);
    const nextBoard = elapsedMs >= WHACK_MOLE_GAME_DURATION_MS
      ? createEmptyWhackMoleBoard()
      : getWhackMoleBoard(seed, boardElapsedMs);
    const nextTick = getWhackMoleTickIndex(boardElapsedMs);
    boardRef.current = nextBoard;
    boardTickRef.current = nextTick;
    setBoard(nextBoard);
    setBoardTick(nextTick);
  }, []);

  const resetRoundView = useCallback(() => {
    hiddenTargetKeysRef.current.clear();
    eventsRef.current = [];
    updateLocalProgress(0, 0);
    setBoard(createEmptyWhackMoleBoard());
    boardRef.current = createEmptyWhackMoleBoard();
    boardTickRef.current += 1;
    setBoardTick(boardTickRef.current);
    setTimeLeftMs(WHACK_MOLE_GAME_DURATION_MS);
    clearHitFeedback();
  }, [clearHitFeedback, updateLocalProgress]);

  const applySession = useCallback((view: WhackMoleSessionView) => {
    submittedRef.current = false;
    hiddenTargetKeysRef.current.clear();
    clearHitFeedback();

    const restored = loadPersistedEvents(view.sessionId);
    eventsRef.current = restored;
    const scored = scoreWhackMoleEvents(view.seed, restored);
    updateLocalProgress(scored.score, scored.combo);

    const elapsedMs = Math.max(0, Math.floor(Date.now() - view.startedAt));
    setBoardForElapsed(view.seed, elapsedMs);
    setTimeLeftMs(Math.max(0, WHACK_MOLE_GAME_DURATION_MS - elapsedMs));

    const nextSession: WhackMoleSession = {
      sessionId: view.sessionId,
      seed: view.seed,
      startedAt: view.startedAt,
      expiresAt: view.expiresAt,
      durationMs: view.durationMs,
    };
    setSession(nextSession);
    sessionRef.current = nextSession;
    setResult(null);
    setLastHit(restored.length > 0 ? '已恢复本局敲击记录' : '敲中地鼠可获得连击加成');
    setRoundPhase('playing');
  }, [clearHitFeedback, setBoardForElapsed, setRoundPhase, updateLocalProgress]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/games/whack-mole/status');
      const data = await parseJson<WhackMoleStatus>(res);
      if (!res.ok || !data?.success || !data.data) {
        throw new Error(data?.message ?? (res.status === 401 ? '请先登录后开始游戏' : '加载游戏状态失败'));
      }

      setStatus(data.data);
      setError(null);
      const serverBest = data.data.records.reduce((best, record) => Math.max(best, record.score), 0);
      setBestScore((current) => Math.max(current, serverBest));

      if (data.data.activeSession && phaseRef.current === 'ready') {
        applySession(data.data.activeSession);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误，请稍后重试');
    }
  }, [applySession]);

  const submitResult = useCallback(async (targetSession: WhackMoleSession) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setRoundPhase('submitting');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/games/whack-mole/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: targetSession.sessionId,
          events: eventsRef.current,
        }),
      });
      const data = await parseJson<SubmitResult>(res);

      if (!res.ok || !data?.success || !data.data) {
        throw new Error(data?.message ?? `结算失败（HTTP ${res.status}）`);
      }

      const record = data.data.record;
      setResult(record);
      clearPersistedEvents();
      eventsRef.current = [];
      setBestScore((current) => {
        const nextBest = Math.max(current, record.score);
        window.localStorage.setItem(BEST_SCORE_KEY, String(nextBest));
        return nextBest;
      });
      setSession(null);
      sessionRef.current = null;
      resetRoundView();
      updateLocalProgress(record.score, 0);
      setLastHit(`本局获得 ${record.pointsEarned} 积分`);
      setRoundPhase('finished');
      void fetchStatus();
    } catch (err) {
      submittedRef.current = false;
      setRoundPhase('finished');
      setError(err instanceof Error ? err.message : '结算失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [fetchStatus, resetRoundView, setRoundPhase, updateLocalProgress]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(feedbackTimersRef.current)) {
        if (timer !== undefined) {
          window.clearTimeout(timer);
        }
      }
    };
  }, []);

  useEffect(() => {
    const savedScore = window.localStorage.getItem(BEST_SCORE_KEY);
    setBestScore(Number(savedScore) || 0);
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (phase === 'playing' || phase === 'submitting' || !status?.inCooldown) return;

    const timer = window.setInterval(() => {
      void fetchStatus();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [fetchStatus, phase, status?.inCooldown]);

  useEffect(() => {
    if (phase !== 'playing' || !session) return;

    let previousTick = getWhackMoleTickIndex(
      Math.min(Date.now() - session.startedAt, WHACK_MOLE_GAME_DURATION_MS - 1),
    );

    const timer = window.setInterval(() => {
      const activeSession = sessionRef.current;
      if (!activeSession) return;

      const elapsedMs = Date.now() - activeSession.startedAt;
      const nextTimeLeft = Math.max(0, WHACK_MOLE_GAME_DURATION_MS - elapsedMs);
      setTimeLeftMs(nextTimeLeft);

      if (elapsedMs >= WHACK_MOLE_GAME_DURATION_MS) {
        window.clearInterval(timer);
        void submitResult(activeSession);
        return;
      }

      const nextTick = getWhackMoleTickIndex(elapsedMs);
      if (nextTick !== previousTick) {
        previousTick = nextTick;
        hiddenTargetKeysRef.current = new Set();
        clearHitFeedback();
        setBoardForElapsed(activeSession.seed, elapsedMs);
      }
    }, TIMER_TICK_MS);

    return () => window.clearInterval(timer);
  }, [clearHitFeedback, phase, session, setBoardForElapsed, submitResult]);

  const startGame = useCallback(async (restart = false) => {
    setLoading(true);
    setError(null);
    setResult(null);
    clearPersistedEvents();
    resetRoundView();

    try {
      const res = await fetch('/api/games/whack-mole/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: restart ? JSON.stringify({ restart: true }) : JSON.stringify({}),
      });
      const data = await parseJson<WhackMoleSessionView>(res);
      if (!res.ok || !data?.success || !data.data) {
        throw new Error(data?.message ?? `开始游戏失败（HTTP ${res.status}）`);
      }
      applySession(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '开始游戏失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [applySession, resetRoundView]);

  const cancelGame = useCallback(async () => {
    if (!sessionRef.current) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/games/whack-mole/cancel', { method: 'POST' });
      const data = await parseJson<unknown>(res);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message ?? '结束游戏失败');
      }

      submittedRef.current = false;
      clearPersistedEvents();
      setSession(null);
      sessionRef.current = null;
      setResult(null);
      resetRoundView();
      setLastHit('本局已结束，无奖励');
      setStatus((current) => current ? {
        ...current,
        inCooldown: true,
        cooldownRemaining: Math.max(current.cooldownRemaining, 5),
        activeSession: null,
      } : current);
      setRoundPhase('ready');
      void fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '结束游戏失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [fetchStatus, resetRoundView, setRoundPhase]);

  const handleHolePress = useCallback((index: number) => {
    const activeSession = sessionRef.current;
    if (phaseRef.current !== 'playing' || !activeSession) return;

    const elapsedMs = Math.max(0, Math.floor(Date.now() - activeSession.startedAt));
    if (elapsedMs >= WHACK_MOLE_GAME_DURATION_MS) return;

    const currentTick = boardTickRef.current;
    const targetKey = `${currentTick}:${index}`;
    if (hiddenTargetKeysRef.current.has(targetKey)) return;

    const cell = boardRef.current[index] ?? 'empty';
    const projected = projectHit(cell, localScoreRef.current, localComboRef.current);

    if (projected.feedbackState) {
      hiddenTargetKeysRef.current.add(targetKey);
      showHoleFeedback(index, projected.feedbackState);
    }

    const nextScore = Math.max(0, localScoreRef.current + projected.scoreDelta);
    const nextCombo = projected.comboAfter;
    updateLocalProgress(nextScore, nextCombo);

    eventsRef.current = [...eventsRef.current, { index, elapsedMs }];
    savePersistedEvents(activeSession.sessionId, eventsRef.current);

    setLastHit(getHitMessage(projected.result, projected.scoreDelta, nextCombo));
  }, [showHoleFeedback, updateLocalProgress]);

  const elapsedMs = WHACK_MOLE_GAME_DURATION_MS - timeLeftMs;
  const refreshHint = getWhackMoleRefreshMs(elapsedMs);
  const bombHint = getWhackMoleBombCount(elapsedMs);
  const rewardPreview = calculateWhackMolePointReward(localScore);
  const phaseText = phase === 'playing' ? '进行中' : phase === 'submitting' ? '结算中' : phase === 'finished' ? '已结算' : '待开始';
  const commandLine = phase === 'playing'
    ? '按规则敲击目标：普通加分，金色优先，炸弹会扣分并清空连击。'
    : phase === 'submitting'
      ? '本局正在由服务端复算分数。'
      : phase === 'finished'
        ? '结算完成，可以返回游戏中心或再来一局。'
        : '每局 60 秒，刷新会越来越快，后半段炸弹数量会上升。';
  const primaryButtonLabel = phase === 'playing'
    ? '结束游戏'
    : phase === 'submitting'
      ? '结算中...'
      : phase === 'finished'
        ? '再来一局'
        : '开始游戏';
  const isPrimaryDisabled = loading || phase === 'submitting' || (phase !== 'playing' && Boolean(status?.inCooldown));
  const actionLabel = status?.inCooldown && phase !== 'playing'
    ? `冷却中 ${status.cooldownRemaining}s`
    : primaryButtonLabel;

  return (
    <div className="whack-page">
      <div className="whack-mesh-bg" aria-hidden />
      <div className="whack-stardust" aria-hidden>
        <span style={{ top: '8%', left: '6%', fontSize: 14 }}>✦</span>
        <span style={{ top: '20%', left: '92%', fontSize: 11, animationDelay: '1s' }}>✦</span>
        <span style={{ top: '48%', left: '4%', fontSize: 16, animationDelay: '2s' }}>✧</span>
        <span style={{ top: '76%', left: '94%', fontSize: 12, animationDelay: '0.6s' }}>✧</span>
      </div>

      <header className="whack-topbar">
        <Link href="/games" className="whack-exit-btn">
          <span className="arrow">
            <ArrowLeft size={14} strokeWidth={2.4} />
          </span>
          EXIT
        </Link>
      </header>

      <main className="whack-container">
        {error && (
          <div className="whack-error-banner" role="alert">
            {error}
          </div>
        )}

        <section className="whack-command-bar" aria-live="polite">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-black text-emerald-700">
              <Hammer className="h-4 w-4" />
              <span>{phaseText}</span>
              <span className="text-slate-300">/</span>
              <span className="text-slate-500">{commandLine}</span>
            </div>
            <p className="text-lg font-black text-slate-950 sm:text-xl">{lastHit}</p>
          </div>
          <button
            onClick={() => setShowRules(true)}
            type="button"
            className="inline-flex flex-none items-center justify-center gap-1.5 rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-50"
          >
            <BookOpen className="h-4 w-4" />
            规则
          </button>
        </section>

        <section className="glass-card stage-card whack-game-card">
          <section className="whack-status-dock">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-black text-white">{phaseText}</span>
                <span className="text-xs font-bold text-slate-400">60 秒挑战</span>
              </div>
              <div className="whack-status-metrics">
                <StatusMetric icon={<Timer className="h-4 w-4" />} label="时间" value={`${formatTime(timeLeftMs)}s`} tone="text-emerald-700" />
                <StatusMetric icon={<Sparkles className="h-4 w-4" />} label="得分" value={localScore} tone="text-emerald-600" />
                <StatusMetric icon={<Zap className="h-4 w-4" />} label="连击" value={localCombo} tone="text-amber-600" />
                <StatusMetric icon={<Trophy className="h-4 w-4" />} label="最高" value={Math.max(bestScore, localScore)} tone="text-sky-600" />
              </div>
            </div>

            <button
              onClick={() => {
                void (phase === 'playing' ? cancelGame() : startGame());
              }}
              disabled={isPrimaryDisabled}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 text-sm font-bold text-white shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-700/40 disabled:shadow-none"
              type="button"
            >
              {phase === 'finished' ? <RotateCcw className="h-4 w-4" /> : <Hammer className="h-4 w-4" />}
              {actionLabel}
            </button>
          </section>

          <section className="whack-board-panel">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-slate-400">规则挑战区</div>
                <h2 className="text-2xl font-black text-slate-900">
                  {phase === 'finished' ? '本局结束' : phase === 'submitting' ? '正在结算' : '洞口棋盘'}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">{BOARD_SIZE} × {BOARD_SIZE}</span>
                <span className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-600">炸弹 {bombHint}</span>
                <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-700">{refreshHint}ms</span>
                <span className="rounded-full bg-sky-50 px-3 py-1.5 text-xs font-black text-sky-700">预计奖励 {rewardPreview}</span>
              </div>
            </div>

            <div className="whack-rule-strip" aria-label="局内规则">
              <RuleChip icon={<Hammer />} text={`普通 +${WHACK_MOLE_NORMAL_POINTS}`} />
              <RuleChip icon={<Sparkles />} text={`金色 +${WHACK_MOLE_GOLDEN_POINTS}`} />
              <RuleChip icon={<Zap />} text={`连击 +2 / 上限 +${WHACK_MOLE_MAX_COMBO_BONUS}`} />
              <RuleChip icon={<Bomb />} text={`炸弹 -${WHACK_MOLE_BOMB_PENALTY}`} />
              <RuleChip icon={<Timer />} text={`${WHACK_MOLE_START_REFRESH_MS}ms → ${WHACK_MOLE_END_REFRESH_MS}ms`} />
            </div>

            {phase !== 'playing' && (
              <div className="whack-board-message">
                <div className="font-black text-slate-900">
                  {phase === 'finished'
                    ? `本局得分 ${localScore}`
                    : phase === 'submitting'
                      ? '正在提交结算'
                      : '准备好后开始挑战'}
                </div>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {phase === 'finished'
                    ? '分数由服务端复算后写入福利积分记录。'
                    : '按上方规则敲击目标：连续命中叠加加成，后半段速度更快、炸弹更多。'}
                </p>
              </div>
            )}

            <div className="whack-board mx-auto grid aspect-square w-full max-w-[620px] grid-cols-4 gap-1.5 sm:gap-2">
              {board.map((state, index) => {
                const targetKey = `${boardTick}:${index}`;
                const baseState = hiddenTargetKeysRef.current.has(targetKey) ? 'empty' : state;
                const displayState: DisplayHoleState = hitFeedback[index] ?? baseState;
                const isVisibleTarget = displayState !== 'empty';
                const targetImageKey = `${index}-${boardTick}-${displayState}`;

                return (
                  <button
                    key={index}
                    type="button"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      handleHolePress(index);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleHolePress(index);
                      }
                    }}
                    aria-label={`${index + 1} 号洞 ${getHoleLabel(displayState)}`}
                    className="whack-hole group relative touch-none select-none overflow-hidden rounded-xl border border-emerald-200/70 bg-cover bg-center shadow-inner transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 sm:rounded-2xl"
                    style={{ backgroundImage: `url(${HOLE_BACKGROUND_IMAGE_SRC})` }}
                  >
                    <span className="absolute inset-x-2 bottom-2 h-4 rounded-[999px] bg-slate-900/25 blur-sm sm:inset-x-3 sm:bottom-3 sm:h-5" />
                    {isVisibleTarget && (
                      <span
                        key={targetImageKey}
                        className="whack-target absolute inset-x-1.5 bottom-2 h-[86%] sm:inset-x-2 sm:bottom-3"
                      >
                        {(displayState === 'mole' || displayState === 'golden' || displayState === 'hit' || displayState === 'goldenHit') && (
                          <Image
                            src={
                              displayState === 'hit'
                                ? HIT_MOLE_IMAGE_SRC
                                : displayState === 'goldenHit'
                                  ? GOLDEN_HIT_MOLE_IMAGE_SRC
                                  : displayState === 'golden'
                                    ? GOLDEN_MOLE_IMAGE_SRC
                                    : MOLE_IMAGE_SRC
                            }
                            alt=""
                            fill
                            sizes="(max-width: 640px) 18vw, 120px"
                            priority={index < 4 && phase === 'playing'}
                            className="object-contain drop-shadow-lg"
                          />
                        )}
                        {(displayState === 'bomb' || displayState === 'bombHit') && (
                          <Image
                            src={BOMB_IMAGE_SRC}
                            alt=""
                            fill
                            sizes="(max-width: 640px) 18vw, 120px"
                            priority={index < 4 && phase === 'playing'}
                            className="object-contain drop-shadow-lg"
                          />
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {status?.inCooldown && phase === 'ready' && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-bold text-amber-700">
              冷却中，请等待 {status.cooldownRemaining} 秒
            </div>
          )}
        </section>

        {showRules && <WhackMoleRulesModal onClose={() => setShowRules(false)} />}
        {phase === 'finished' && result && (
          <WhackMoleResultModal
            result={result}
            loading={loading}
            cooldownRemaining={status?.inCooldown ? status.cooldownRemaining : 0}
            onStart={() => void startGame()}
          />
        )}
      </main>

      <style jsx>{`
        @keyframes whack-pop {
          0% { transform: translateY(42%) scale(0.72); opacity: 0; }
          68% { transform: translateY(-3%) scale(1.05); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        .whack-target {
          animation: whack-pop 180ms cubic-bezier(0.18, 0.9, 0.25, 1.2);
        }
        @media (prefers-reduced-motion: reduce) {
          .whack-target { animation: none; }
        }
      `}</style>
      <style jsx global>{`
        .whack-page {
          min-height: 100vh;
          background: #eefcf8;
          color: #0f172a;
          position: relative;
          overflow-x: hidden;
        }
        .whack-page a {
          color: inherit;
          text-decoration: none;
        }
        .whack-page .whack-mesh-bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background:
            radial-gradient(circle at 12% 18%, rgba(45, 212, 191, 0.42), transparent 38%),
            radial-gradient(circle at 88% 16%, rgba(251, 191, 36, 0.22), transparent 34%),
            radial-gradient(circle at 48% 96%, rgba(16, 185, 129, 0.34), transparent 42%),
            linear-gradient(180deg, #effdf8 0%, #e7f7ff 100%);
        }
        .whack-page .whack-stardust {
          position: fixed;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          color: rgba(4, 120, 87, 0.42);
        }
        .whack-page .whack-stardust span {
          position: absolute;
          animation: whack-float 4s ease-in-out infinite;
        }
        @keyframes whack-float {
          0%, 100% { transform: translateY(0); opacity: 0.45; }
          50% { transform: translateY(-10px); opacity: 0.9; }
        }
        .whack-page .whack-topbar {
          position: sticky;
          top: 0;
          z-index: 40;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          padding: 18px 48px;
          padding-top: max(18px, env(safe-area-inset-top));
          background: rgba(239, 253, 248, 0.68);
          border-bottom: 1px solid rgba(255, 255, 255, 0.74);
          backdrop-filter: blur(22px) saturate(1.45);
        }
        .whack-page .whack-exit-btn {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.82);
          background: rgba(255, 255, 255, 0.62);
          padding: 8px 18px 8px 8px;
          color: #065f46;
          font-size: 13px;
          font-weight: 900;
          letter-spacing: 1.5px;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.07);
          backdrop-filter: blur(16px);
        }
        .whack-page .whack-exit-btn .arrow {
          display: inline-flex;
          width: 30px;
          height: 30px;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          border-radius: 50%;
          color: #fff;
          background: linear-gradient(135deg, #34d399, #047857);
          box-shadow: 0 8px 14px rgba(4, 120, 87, 0.28);
        }
        .whack-page .whack-container {
          position: relative;
          z-index: 1;
          max-width: 1360px;
          margin: 0 auto;
          padding: 22px 48px 92px;
          display: flex;
          flex-direction: column;
          gap: 22px;
        }
        .whack-page .whack-error-banner {
          border-radius: 20px;
          border: 1px solid rgba(254, 202, 202, 0.9);
          background: rgba(254, 242, 242, 0.92);
          padding: 14px 16px;
          color: #be123c;
          font-size: 14px;
          font-weight: 800;
        }
        .whack-page .whack-command-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          border-radius: 28px;
          border: 1px solid rgba(167, 243, 208, 0.9);
          background: rgba(255, 255, 255, 0.78);
          padding: 16px 18px;
          box-shadow: 0 18px 46px rgba(15, 23, 42, 0.07);
          backdrop-filter: blur(16px);
        }
        .whack-page .glass-card {
          border: 1px solid rgba(255, 255, 255, 0.82);
          background: rgba(255, 255, 255, 0.82);
          box-shadow: 0 22px 60px rgba(15, 23, 42, 0.1);
          backdrop-filter: blur(18px);
        }
        .whack-page .stage-card {
          padding: 22px;
          border-radius: 30px;
        }
        .whack-page .whack-status-dock {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 18px;
          align-items: center;
          border-radius: 24px;
          border: 1px solid rgba(209, 250, 229, 0.86);
          background: linear-gradient(180deg, rgba(236, 253, 245, 0.96), rgba(255, 255, 255, 0.94));
          padding: 16px;
          margin-bottom: 22px;
        }
        .whack-page .whack-status-metrics {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        .whack-page .whack-metric {
          border-radius: 18px;
          border: 1px solid rgba(226, 232, 240, 0.8);
          background: rgba(255, 255, 255, 0.78);
          padding: 10px 12px;
        }
        .whack-page .whack-board-panel {
          border-radius: 26px;
          border: 1px solid rgba(209, 250, 229, 0.86);
          background: rgba(255, 255, 255, 0.72);
          padding: 18px;
          box-shadow: 0 14px 36px rgba(15, 23, 42, 0.06);
        }
        .whack-page .whack-rule-strip {
          margin: 0 auto 14px;
          display: flex;
          max-width: 720px;
          flex-wrap: wrap;
          justify-content: center;
          gap: 8px;
        }
        .whack-page .whack-rule-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 999px;
          border: 1px solid rgba(226, 232, 240, 0.88);
          background: rgba(255, 255, 255, 0.78);
          padding: 8px 10px;
          color: #334155;
          font-size: 12px;
          font-weight: 900;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.04);
        }
        .whack-page .whack-rule-chip svg {
          width: 14px;
          height: 14px;
          color: #059669;
        }
        .whack-page .whack-board-message {
          margin: 0 auto 16px;
          max-width: 620px;
          border-radius: 22px;
          border: 1px solid rgba(167, 243, 208, 0.9);
          background: rgba(236, 253, 245, 0.86);
          padding: 14px 16px;
          text-align: center;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
        }
        .whack-page .whack-board {
          border-radius: 28px;
          border: 1px solid rgba(167, 243, 208, 0.9);
          background: linear-gradient(180deg, #ecfdf5 0%, #d1fae5 100%);
          padding: 8px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.86);
        }
        .whack-page .whack-hole {
          min-width: 0;
          min-height: 0;
          background-color: #d1fae5;
        }
        .whack-page .whack-result-modal {
          width: min(560px, 100%);
          max-height: min(86vh, 680px);
          overflow-y: auto;
          border-radius: 28px;
          border: 1px solid rgba(167, 243, 208, 0.95);
          background: linear-gradient(180deg, #fff 0%, #ecfdf5 100%);
          padding: 24px;
          box-shadow: 0 30px 70px rgba(15, 23, 42, 0.3);
        }
        .whack-page .whack-result-modal.lost {
          border-color: rgba(254, 205, 211, 0.95);
          background: linear-gradient(180deg, #fff 0%, #fff1f2 100%);
        }
        .whack-page .whack-result-icon {
          display: flex;
          width: 72px;
          height: 72px;
          align-items: center;
          justify-content: center;
          border-radius: 24px;
          color: #fff;
          box-shadow: 0 18px 34px rgba(15, 23, 42, 0.16);
        }
        .whack-page .whack-result-icon.won {
          background: linear-gradient(135deg, #10b981, #047857);
        }
        .whack-page .whack-result-icon.lost {
          background: linear-gradient(135deg, #fb7185, #be123c);
        }
        .whack-page .whack-result-stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 20px;
        }
        .whack-page .whack-result-stat {
          border-radius: 18px;
          border: 1px solid rgba(226, 232, 240, 0.9);
          background: rgba(255, 255, 255, 0.86);
          padding: 12px;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
        }
        .whack-page .whack-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 70;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 42, 0.58);
          padding: 18px;
          backdrop-filter: blur(10px);
        }
        .whack-page .whack-rules-modal {
          width: min(720px, 100%);
          max-height: min(86vh, 680px);
          overflow-y: auto;
          border-radius: 28px;
          border: 1px solid rgba(167, 243, 208, 0.95);
          background: linear-gradient(180deg, #fff 0%, #ecfdf5 100%);
          padding: 24px;
          box-shadow: 0 30px 70px rgba(15, 23, 42, 0.3);
        }
        @media (max-width: 1080px) {
          .whack-page .whack-container {
            padding: 22px 22px 82px;
          }
          .whack-page .whack-status-dock {
            grid-template-columns: 1fr;
          }
          .whack-page .whack-status-metrics {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (max-width: 768px) {
          .whack-page .whack-topbar {
            padding: 12px 14px;
          }
          .whack-page .whack-exit-btn {
            padding: 7px 14px 7px 7px;
            font-size: 12px;
          }
          .whack-page .whack-exit-btn .arrow {
            width: 26px;
            height: 26px;
          }
          .whack-page .whack-container {
            padding: 16px 14px 92px;
            gap: 18px;
          }
          .whack-page .stage-card {
            padding: 14px;
            border-radius: 24px;
          }
          .whack-page .whack-command-bar {
            align-items: stretch;
            flex-direction: column;
            padding: 14px;
          }
          .whack-page .whack-command-bar button,
          .whack-page .whack-status-dock button {
            width: 100%;
          }
          .whack-page .whack-status-metrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .whack-page .whack-board-panel {
            border-radius: 22px;
            padding: 14px;
          }
          .whack-page .whack-board {
            max-width: min(100%, calc(100vw - 64px));
            border-radius: 22px;
            padding: 6px;
          }
          .whack-page .whack-rule-strip {
            justify-content: flex-start;
            overflow-x: auto;
            flex-wrap: nowrap;
            padding-bottom: 4px;
          }
          .whack-page .whack-rule-chip {
            flex: 0 0 auto;
          }
          .whack-page .whack-rules-modal,
          .whack-page .whack-result-modal {
            border-radius: 22px;
            padding: 18px;
          }
          .whack-page .whack-result-stats {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

function StatusMetric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone: string }) {
  return (
    <div className="whack-metric">
      <div className={`flex items-center gap-1.5 text-xs font-black ${tone}`}>
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-lg font-black text-slate-900">{value}</div>
    </div>
  );
}

function RuleChip({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="whack-rule-chip">
      {icon}
      {text}
    </span>
  );
}

function WhackMoleRulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="whack-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="whack-rules-title">
      <div className="whack-rules-modal">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
              <BookOpen className="h-4 w-4" />
              玩法说明
            </div>
            <h2 id="whack-rules-title" className="text-2xl font-black text-slate-950">打地鼠规则</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              每局 60 秒，越到后面刷新越快、炸弹越多。服务端按实际敲击时间复算得分。
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:text-slate-900"
            type="button"
            aria-label="关闭规则"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <RuleCard icon={<Hammer />} title="普通地鼠" text={`命中 +${WHACK_MOLE_NORMAL_POINTS} 分，连续命中会继续叠加连击。`} />
          <RuleCard icon={<Sparkles />} title="金色地鼠" text={`命中 +${WHACK_MOLE_GOLDEN_POINTS} 分，是优先级最高的目标。`} />
          <RuleCard icon={<Zap />} title="连击加成" text={`每次连击额外 +2 分，最高额外 +${WHACK_MOLE_MAX_COMBO_BONUS} 分。`} />
          <RuleCard icon={<Bomb />} title="炸弹" text={`敲到炸弹扣 ${WHACK_MOLE_BOMB_PENALTY} 分，并清空当前连击，后期最多同时出现 ${WHACK_MOLE_MAX_BOMBS} 个。`} />
          <RuleCard icon={<Timer />} title="速度曲线" text={`刷新从 ${WHACK_MOLE_START_REFRESH_MS}ms 加快到 ${WHACK_MOLE_END_REFRESH_MS}ms。`} />
          <RuleCard icon={<Trophy />} title="优秀线" text={`达到 ${WHACK_MOLE_WIN_SCORE} 分可以视为高分通关。`} />
        </div>
      </div>
    </div>
  );
}

function WhackMoleResultModal({
  result,
  loading,
  cooldownRemaining,
  onStart,
}: {
  result: WhackMoleRecord;
  loading: boolean;
  cooldownRemaining: number;
  onStart: () => void;
}) {
  const won = result.score >= WHACK_MOLE_WIN_SCORE;
  const expectedReward = calculateWhackMolePointReward(result.score);

  return (
    <div className="whack-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="whack-result-title">
      <div className={`whack-result-modal ${won ? 'won' : 'lost'}`}>
        <div className="flex flex-col items-center text-center">
          <div className={`whack-result-icon ${won ? 'won' : 'lost'}`}>
            {won ? <Trophy className="h-9 w-9" /> : <Target className="h-9 w-9" />}
          </div>
          <div className="mt-5 text-xs font-black uppercase tracking-wider text-emerald-700/80">
            本局结算
          </div>
          <h2 id="whack-result-title" className="mt-1 text-2xl font-black text-slate-950">
            {won ? '挑战成功' : '挑战失败'}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            本局得分 {result.score}，按得分 10% 结算，获得 {result.pointsEarned} 福利积分。
          </p>
        </div>

        <div className="mt-5 rounded-2xl border border-emerald-100 bg-white px-5 py-3 text-center text-sm font-black text-emerald-700 shadow-sm">
          最终福利积分 = {result.score} × 10% = {expectedReward}
        </div>

        <div className="whack-result-stats">
          <WhackResultStat label="命中" value={String(result.hits)} />
          <WhackResultStat label="金色" value={String(result.goldenHits)} />
          <WhackResultStat label="最高连击" value={String(result.maxCombo)} />
          <WhackResultStat label="打空" value={String(result.misses)} />
          <WhackResultStat label="炸弹" value={String(result.bombs)} />
          <WhackResultStat label="奖励" value={`${result.pointsEarned}`} />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link
            href="/games"
            className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-white px-5 py-3 text-sm font-black text-emerald-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-emerald-50"
          >
            <ArrowLeft className="h-4 w-4" />
            返回游戏中心
          </Link>
          <button
            onClick={onStart}
            disabled={loading || cooldownRemaining > 0}
            className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-700/40"
            type="button"
          >
            <RotateCcw className="h-4 w-4" />
            {cooldownRemaining > 0 ? `冷却中 ${cooldownRemaining}s` : loading ? '处理中' : '再来一局'}
          </button>
        </div>
      </div>
    </div>
  );
}

function WhackResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="whack-result-stat">
      <div className="text-xs font-black text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-black text-slate-950">{value}</div>
    </div>
  );
}

function RuleCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <article className="rounded-2xl border border-emerald-100 bg-white/80 p-4">
      <div className="mb-2 flex items-center gap-2 font-black text-slate-950">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
        {title}
      </div>
      <p className="text-sm leading-6 text-slate-600">{text}</p>
    </article>
  );
}
