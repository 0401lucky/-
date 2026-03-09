// src/app/games/tower/page.tsx

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ChevronLeft, Star, Zap, Layers, X, HelpCircle, Flag, Shield, Ghost, Plus, ShoppingBag } from 'lucide-react';
import LaneCards from './components/LaneCards';
import FloatingText from './components/FloatingText';
import type { FloatingTextItem } from './components/FloatingText';
import GameHeader from './components/GameHeader';
import ResultModal from './components/ResultModal';
import DifficultySelect from './components/DifficultySelect';
import { useGameSession } from './hooks/useGameSession';
import {
  createTowerRng,
  generateFloor,
  simulateTowerGame,
  rollBlessing,
  rollCurse,
  MAX_POWER,
  formatPower,
  BUFF_LABELS,
  BLESSING_LABELS,
  BLESSING_ICONS,
  CURSE_LABELS,
  CURSE_ICONS,
} from '@/lib/tower-engine';
import type {
  TowerFloor,
  TowerLaneContent,
  ResolvedLaneContent,
  BuffType,
  TowerDifficulty,
  ActiveBlessing,
  ActiveCurse,
  GenerateFloorOptions,
} from '@/lib/tower-engine';
import {
  ANIM_WALK_DURATION,
  ANIM_ATTACK_DURATION,
  ANIM_POWERUP_DURATION,
  ANIM_DEATH_DURATION,
  ANIM_REVEAL_DURATION,
  ANIM_SHIELD_BLOCK_DURATION,
  ANIM_BOSS_DEFEAT_DURATION,
  ANIM_TRAP_DURATION,
  ANIM_SHOP_DURATION,
} from './lib/constants';

type Phase = 'ready' | 'selectDifficulty' | 'playing' | 'result';
type AnimState = 'idle' | 'walking' | 'attacking' | 'powerup' | 'death' | 'nextFloor' | 'revealing' | 'shieldBlock' | 'bossDefeated' | 'trapped' | 'shopping';
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

  const [phase, setPhase] = useState<Phase>('ready');
  const [choices, setChoices] = useState<number[]>([]);
  const [power, setPower] = useState(1);
  const [shield, setShield] = useState(0);
  const [combo, setCombo] = useState(0);
  const [buffs, setBuffs] = useState<BuffType[]>([]);
  const [blessings, setBlessings] = useState<ActiveBlessing[]>([]);
  const [curses, setCurses] = useState<ActiveCurse[]>([]);
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
    bossesDefeated: number;
    maxCombo: number;
    basePoints: number;
    bossPoints: number;
    comboPoints: number;
    perfectPoints: number;
    difficulty?: TowerDifficulty;
    difficultyMultiplier?: number;
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
  const shieldRef = useRef(0);
  const comboRef = useRef(0);
  const buffsRef = useRef<BuffType[]>([]);
  const blessingsRef = useRef<ActiveBlessing[]>([]);
  const cursesRef = useRef<ActiveCurse[]>([]);
  const bossesDefeatedRef = useRef(0);
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

  useEffect(() => {
    comboRef.current = combo;
  }, [combo]);

  useEffect(() => {
    buffsRef.current = buffs;
  }, [buffs]);

  useEffect(() => {
    blessingsRef.current = blessings;
  }, [blessings]);

  useEffect(() => {
    cursesRef.current = curses;
  }, [curses]);

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
    void fetchStatus();
  }, [fetchStatus]);

  // 冷却轮询
  useEffect(() => {
    if (phase !== 'ready' || !status?.inCooldown) return;
    const timer = window.setInterval(() => {
      void fetchStatus();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, status?.inCooldown, fetchStatus]);

  // 构建 GenerateFloorOptions 的辅助函数
  const buildFloorOptions = useCallback((): GenerateFloorOptions | undefined => {
    if (!session?.difficulty) return undefined;
    return {
      difficulty: session.difficulty,
      blessings: blessingsRef.current,
      curses: cursesRef.current,
      bossesDefeated: bossesDefeatedRef.current,
    };
  }, [session?.difficulty]);

  // 会话恢复 / 开局初始化
  useEffect(() => {
    if (!session) return;

    const rng = createTowerRng(session.seed);
    rngRef.current = rng;
    const difficulty = session.difficulty;

    // 尝试恢复进度
    const restoredChoices = loadChoices(session.sessionId);
    const sim = simulateTowerGame(session.seed, restoredChoices, difficulty);

    if (sim.ok && restoredChoices.length > 0) {
      // 恢复成功
      choicesRef.current = restoredChoices;
      setChoices(restoredChoices);

      // 重建 rng 状态到正确位置
      const freshRng = createTowerRng(session.seed);
      let currentPower = 1;
      let currentShield = 0;
      let currentCombo = 0;
      const currentBuffs: BuffType[] = [];
      let currentBlessings: ActiveBlessing[] = [];
      let currentCurses: ActiveCurse[] = [];
      let currentBossesDefeated = 0;

      for (let i = 0; i < restoredChoices.length; i++) {
        if (difficulty) {
          currentBlessings = currentBlessings
            .map(b => ({ ...b, remainingFloors: b.remainingFloors - 1 }))
            .filter(b => b.remainingFloors > 0);
          currentCurses = currentCurses
            .map(c => ({ ...c, remainingFloors: c.remainingFloors - 1 }))
            .filter(c => c.remainingFloors > 0);
        }

        const floorOpts: GenerateFloorOptions | undefined = difficulty
          ? { difficulty, blessings: currentBlessings, curses: currentCurses, bossesDefeated: currentBossesDefeated }
          : undefined;
        const floor = generateFloor(freshRng, i + 1, currentPower, currentBuffs, floorOpts);
        let lane = floor.lanes[restoredChoices[i]];
        if (lane.type === 'mystery') lane = lane.hidden;

        const comboPercent = currentBuffs.includes('combo_master') ? 0.20 : 0.10;
        const maxShield = currentBuffs.includes('fortify') ? 2 : 1;
        const hasLifesteal = currentBuffs.includes('lifesteal');
        const hasLucky = currentBuffs.includes('lucky');

        // 祝福效果
        const hasFlame = currentBlessings.some(b => b.type === 'flame_power');
        const hasGolden = currentBlessings.some(b => b.type === 'golden_touch');
        const hasWeakness = currentCurses.some(c => c.type === 'weakness');
        let effectivePower = currentPower;
        if (hasFlame) effectivePower = Math.floor(effectivePower * 1.5);
        if (hasWeakness) effectivePower = Math.floor(effectivePower * 0.75);

        if (lane.type === 'boss') {
          if (effectivePower > lane.value) {
            let gain = lane.value * 2;
            if (hasGolden) gain *= 2;
            if (hasLifesteal) gain += Math.floor(lane.value * 0.2);
            const comboBonus = Math.floor(gain * comboPercent * currentCombo * 2);
            currentPower = Math.min(currentPower + gain + comboBonus, MAX_POWER);
            currentCombo++;
            currentBossesDefeated++;
            if (difficulty) {
              const blessing = rollBlessing(freshRng, currentBlessings);
              if (blessing) {
                currentBlessings = [...currentBlessings.filter(b => b.type !== blessing.type), blessing];
              }
            }
          } else if (currentShield > 0) {
            currentShield--;
            currentCombo = 0;
          }
        } else if (lane.type === 'monster') {
          if (effectivePower > lane.value) {
            let gain = lane.value;
            if (hasGolden) gain *= 2;
            if (hasLifesteal) gain += Math.floor(lane.value * 0.2);
            const comboBonus = Math.floor(gain * comboPercent * currentCombo);
            currentPower = Math.min(currentPower + gain + comboBonus, MAX_POWER);
            currentCombo++;
          } else if (currentShield > 0) {
            currentShield--;
            currentCombo = 0;
          }
        } else if (lane.type === 'add') {
          let v = hasLucky ? Math.floor(lane.value * 1.3) : lane.value;
          if (hasGolden) v *= 2;
          currentPower = Math.min(currentPower + v, MAX_POWER);
          currentCombo = 0;
        } else if (lane.type === 'multiply') {
          let v = hasLucky ? lane.value + 1 : lane.value;
          if (hasGolden) v *= 2;
          currentPower = Math.min(currentPower * v, MAX_POWER);
          currentCombo = 0;
        } else if (lane.type === 'shield') {
          if (currentShield >= maxShield) {
            let v = hasLucky ? Math.floor(lane.value * 1.3) : lane.value;
            if (hasGolden) v *= 2;
            currentPower = Math.min(currentPower + v, MAX_POWER);
          } else {
            currentShield++;
          }
          currentCombo = 0;
        } else if (lane.type === 'shop') {
          if (!currentBuffs.includes(lane.buff)) {
            currentBuffs.push(lane.buff);
          }
          currentCombo = 0;
        } else if (lane.type === 'trap') {
          if (lane.subtype === 'sub') {
            currentPower = Math.max(1, currentPower - lane.value);
          } else {
            currentPower = Math.max(1, Math.ceil(currentPower / lane.value));
          }
          currentCombo = 0;
          if (difficulty) {
            const curse = rollCurse(freshRng);
            if (curse) {
              currentCurses = [...currentCurses.filter(c => c.type !== curse.type), curse];
            }
          }
        }

      }

      rngRef.current = freshRng;
      setPower(sim.finalPower);
      powerRef.current = sim.finalPower;
      setShield(sim.finalShield);
      shieldRef.current = sim.finalShield;
      setCombo(sim.finalCombo);
      comboRef.current = sim.finalCombo;
      setBuffs([...sim.finalBuffs]);
      buffsRef.current = [...sim.finalBuffs];

      // 恢复祝福/诅咒/Boss击杀数
      const simBlessings = sim.blessings ?? [];
      const simCurses = sim.curses ?? [];
      setBlessings(simBlessings);
      blessingsRef.current = simBlessings;
      setCurses(simCurses);
      cursesRef.current = simCurses;
      bossesDefeatedRef.current = sim.bossesDefeated;

      if (sim.gameOver) {
        // 恢复后已死亡 - 直接提交
        void handleSubmit(restoredChoices);
        return;
      }

      // 生成下一层
      const nextFloorOpts: GenerateFloorOptions | undefined = difficulty
        ? { difficulty, blessings: simBlessings, curses: simCurses, bossesDefeated: sim.bossesDefeated }
        : undefined;
      const nextFloor = generateFloor(freshRng, restoredChoices.length + 1, sim.finalPower, sim.finalBuffs, nextFloorOpts);
      setCurrentFloor(nextFloor);
    } else {
      // 新游戏
      choicesRef.current = [];
      setChoices([]);
      setPower(1);
      powerRef.current = 1;
      setShield(0);
      shieldRef.current = 0;
      setCombo(0);
      comboRef.current = 0;
      setBuffs([]);
      buffsRef.current = [];
      setBlessings([]);
      blessingsRef.current = [];
      setCurses([]);
      cursesRef.current = [];
      bossesDefeatedRef.current = 0;

      if (restoredChoices.length > 0) {
        clearChoices(session.sessionId);
        setError('本地进度异常，已重置该局');
      }

      const firstFloorOpts: GenerateFloorOptions | undefined = difficulty
        ? { difficulty, blessings: [], curses: [], bossesDefeated: 0 }
        : undefined;
      const firstFloor = generateFloor(rng, 1, 1, [], firstFloorOpts);
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

      // 检查是否为失败结果
      if ('failed' in res) {
        setIsAnimating(false);
        if (res.expired) {
          // 会话已过期，清除重试状态，不再建议重试
          clearChoices(sessionId);
          setPendingSubmitChoices(null);
        }
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

      const advanceToNextFloor = (options?: {
        newPower?: number;
        shieldChange?: 'gain' | 'lose' | number;
        comboChange?: 'increment' | 'reset';
        newBuff?: BuffType;
        bossDefeated?: boolean;
        newBlessing?: ActiveBlessing;
        newCurse?: ActiveCurse;
      }) => {
        if (options?.newPower !== undefined) {
          const clampedPower = Math.min(options.newPower, MAX_POWER);
          setPower(clampedPower);
          powerRef.current = clampedPower;
          setPowerChanged(true);
          scheduleTimer(() => setPowerChanged(false), 300);
        }

        if (options?.shieldChange !== undefined) {
          if (options.shieldChange === 'gain') {
            const newVal = shieldRef.current + 1;
            setShield(newVal);
            shieldRef.current = newVal;
          } else if (options.shieldChange === 'lose') {
            const newVal = Math.max(0, shieldRef.current - 1);
            setShield(newVal);
            shieldRef.current = newVal;
          } else if (typeof options.shieldChange === 'number') {
            setShield(options.shieldChange);
            shieldRef.current = options.shieldChange;
          }
        }

        if (options?.comboChange === 'increment') {
          const newCombo = comboRef.current + 1;
          setCombo(newCombo);
          comboRef.current = newCombo;
        } else if (options?.comboChange === 'reset') {
          setCombo(0);
          comboRef.current = 0;
        }

        if (options?.newBuff) {
          if (!buffsRef.current.includes(options.newBuff)) {
            const newBuffs = [...buffsRef.current, options.newBuff];
            setBuffs(newBuffs);
            buffsRef.current = newBuffs;
          }
        }

        if (options?.bossDefeated) {
          bossesDefeatedRef.current++;
        }

        // 处理新的祝福
        if (options?.newBlessing) {
          const nb = options.newBlessing;
          const updated = [...blessingsRef.current.filter(b => b.type !== nb.type), nb];
          setBlessings(updated);
          blessingsRef.current = updated;
          addFloatingText(`${BLESSING_ICONS[nb.type]} ${BLESSING_LABELS[nb.type]}!`, '#d4a017');
        }

        // 处理新的诅咒
        if (options?.newCurse) {
          const nc = options.newCurse;
          const updated = [...cursesRef.current.filter(c => c.type !== nc.type), nc];
          setCurses(updated);
          cursesRef.current = updated;
          addFloatingText(`${CURSE_ICONS[nc.type]} ${CURSE_LABELS[nc.type]}!`, '#dc2626');
        }

        // 祝福/诅咒持续回合递减
        const decrementedBlessings = blessingsRef.current
          .map(b => ({ ...b, remainingFloors: b.remainingFloors - 1 }))
          .filter(b => b.remainingFloors > 0);
        const expiredBlessings = blessingsRef.current.filter(b => b.remainingFloors <= 1);
        for (const eb of expiredBlessings) {
          addFloatingText(`${BLESSING_ICONS[eb.type]} ${BLESSING_LABELS[eb.type]} 消退`, '#9ca3af');
        }
        setBlessings(decrementedBlessings);
        blessingsRef.current = decrementedBlessings;

        const decrementedCurses = cursesRef.current
          .map(c => ({ ...c, remainingFloors: c.remainingFloors - 1 }))
          .filter(c => c.remainingFloors > 0);

        const expiredCurses = cursesRef.current.filter(c => c.remainingFloors <= 1);
        for (const ec of expiredCurses) {
          addFloatingText(`${CURSE_ICONS[ec.type]} ${CURSE_LABELS[ec.type]} 解除`, '#22c55e');
        }
        setCurses(decrementedCurses);
        cursesRef.current = decrementedCurses;

        const newChoices = [...choicesRef.current, laneIndex];
        choicesRef.current = newChoices;
        setChoices(newChoices);
        saveChoices(session.sessionId, newChoices);

        const floorOpts = buildFloorOptions();
        const nextFloor = generateFloor(rngRef.current!, newChoices.length + 1, powerRef.current, buffsRef.current, floorOpts);
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
        scheduleTimer(() => advanceToNextFloor({ shieldChange: 'lose', comboChange: 'reset' }), ANIM_SHIELD_BLOCK_DURATION);
      };

      const executeLaneEffect = (lane: ResolvedLaneContent) => {
        const currentBuffs = buffsRef.current;
        const hasLifesteal = currentBuffs.includes('lifesteal');
        const hasLucky = currentBuffs.includes('lucky');
        const comboPercent = currentBuffs.includes('combo_master') ? 0.20 : 0.10;
        const maxShield = currentBuffs.includes('fortify') ? 2 : 1;
        const currentCombo = comboRef.current;

        // 祝福/诅咒效果
        const curBlessings = blessingsRef.current;
        const curCurses = cursesRef.current;
        const hasFlame = curBlessings.some(b => b.type === 'flame_power');
        const hasGolden = curBlessings.some(b => b.type === 'golden_touch');
        const hasWeakness = curCurses.some(c => c.type === 'weakness');

        let effectivePower = powerRef.current;
        if (hasFlame) effectivePower = Math.floor(effectivePower * 1.5);
        if (hasWeakness) effectivePower = Math.floor(effectivePower * 0.75);

        if (lane.type === 'boss') {
          if (effectivePower > lane.value) {
            setAnimState('bossDefeated');
            let gain = lane.value * 2;
            if (hasGolden) gain *= 2;
            if (hasLifesteal) gain += Math.floor(lane.value * 0.2);
            const comboBonus = Math.floor(gain * comboPercent * currentCombo * 2);
            const totalGain = gain + comboBonus;
            const text = comboBonus > 0 ? `+${totalGain} (COMBO)` : `+${totalGain}`;
            addFloatingText(text, '#ff6d00');
            const newBlessing = session.difficulty && rngRef.current
              ? rollBlessing(rngRef.current, blessingsRef.current)
              : null;
            scheduleTimer(() => advanceToNextFloor({
              newPower: powerRef.current + totalGain,
              comboChange: 'increment',
              bossDefeated: true,
              ...(newBlessing ? { newBlessing } : {}),
            }), ANIM_BOSS_DEFEAT_DURATION);
          } else if (shieldRef.current > 0) {
            handleShieldBlock();
          } else {
            handleDeath();
          }
        } else if (lane.type === 'monster') {
          if (effectivePower > lane.value) {
            setAnimState('attacking');
            let gain = lane.value;
            if (hasGolden) gain *= 2;
            if (hasLifesteal) gain += Math.floor(lane.value * 0.2);
            const comboBonus = Math.floor(gain * comboPercent * currentCombo);
            const totalGain = gain + comboBonus;
            const text = comboBonus > 0 ? `+${totalGain} COMBO x${currentCombo}` : `+${totalGain}`;
            const color = comboBonus > 0 ? '#ff5722' : '#ef5350';
            addFloatingText(text, color);
            scheduleTimer(() => advanceToNextFloor({
              newPower: powerRef.current + totalGain,
              comboChange: 'increment',
            }), ANIM_ATTACK_DURATION);
          } else if (shieldRef.current > 0) {
            handleShieldBlock();
          } else {
            handleDeath();
          }
        } else if (lane.type === 'shield') {
          setAnimState('powerup');
          if (shieldRef.current >= maxShield) {
            let v = hasLucky ? Math.floor(lane.value * 1.3) : lane.value;
            if (hasGolden) v *= 2;
            addFloatingText(`+${v}`, '#42a5f5');
            scheduleTimer(() => advanceToNextFloor({
              newPower: powerRef.current + v,
              comboChange: 'reset',
            }), ANIM_POWERUP_DURATION);
          } else {
            addFloatingText('获得护盾!', '#42a5f5');
            scheduleTimer(() => advanceToNextFloor({
              shieldChange: 'gain',
              comboChange: 'reset',
            }), ANIM_POWERUP_DURATION);
          }
        } else if (lane.type === 'add') {
          setAnimState('powerup');
          let v = hasLucky ? Math.floor(lane.value * 1.3) : lane.value;
          if (hasGolden) v *= 2;
          addFloatingText(`+${v}`, '#66bb6a');
          scheduleTimer(() => advanceToNextFloor({
            newPower: powerRef.current + v,
            comboChange: 'reset',
          }), ANIM_POWERUP_DURATION);
        } else if (lane.type === 'multiply') {
          setAnimState('powerup');
          let v = hasLucky ? lane.value + 1 : lane.value;
          if (hasGolden) v *= 2;
          addFloatingText(`x${v}`, '#ffa726');
          scheduleTimer(() => advanceToNextFloor({
            newPower: powerRef.current * v,
            comboChange: 'reset',
          }), ANIM_POWERUP_DURATION);
        } else if (lane.type === 'shop') {
          setAnimState('shopping');
          addFloatingText(`${BUFF_LABELS[lane.buff]}!`, '#a855f7');
          scheduleTimer(() => advanceToNextFloor({
            newBuff: lane.buff,
            comboChange: 'reset',
          }), ANIM_SHOP_DURATION);
        } else if (lane.type === 'trap') {
          setAnimState('trapped');
          const newCurse = session.difficulty && rngRef.current
            ? rollCurse(rngRef.current)
            : null;
          if (lane.subtype === 'sub') {
            const newPower = Math.max(1, powerRef.current - lane.value);
            addFloatingText(`-${lane.value}!`, '#f44336');
            scheduleTimer(() => advanceToNextFloor({
              newPower,
              comboChange: 'reset',
              ...(newCurse ? { newCurse } : {}),
            }), ANIM_TRAP_DURATION);
          } else {
            const newPower = Math.max(1, Math.ceil(powerRef.current / lane.value));
            addFloatingText(`÷${lane.value}!`, '#f44336');
            scheduleTimer(() => advanceToNextFloor({
              newPower,
              comboChange: 'reset',
              ...(newCurse ? { newCurse } : {}),
            }), ANIM_TRAP_DURATION);
          }
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
    [phase, session, currentFloor, isAnimating, loading, pendingSubmitChoices, handleSubmit, scheduleTimer, addFloatingText, buildFloorOptions]
  );

  const handleStart = useCallback(async () => {
    if (status?.pointsLimitReached) {
      setShowLimitWarning(true);
      return;
    }

    setError(null);
    setPhase('selectDifficulty');
  }, [setError, status?.pointsLimitReached]);

  const handleDifficultySelect = useCallback(async (difficulty: TowerDifficulty) => {
    const ok = await startGame(difficulty);
    if (ok) {
      setPendingSubmitChoices(null);
      setResult(null);
      setChoices([]);
      setPower(1);
      powerRef.current = 1;
      setShield(0);
      shieldRef.current = 0;
      setCombo(0);
      comboRef.current = 0;
      setBuffs([]);
      buffsRef.current = [];
      setBlessings([]);
      blessingsRef.current = [];
      setCurses([]);
      cursesRef.current = [];
      bossesDefeatedRef.current = 0;
      setCurrentFloor(null);
      setRevealedLane(null);
    } else {
      // 开始失败，回到 ready
      setPhase('ready');
    }
  }, [startGame]);

  const handleConfirmStart = useCallback(async () => {
    setShowLimitWarning(false);
    setError(null);
    setPhase('selectDifficulty');
  }, [setError]);

  const handleCancel = useCallback(async () => {
    if (!session) return;
    await cancelGame();
    clearChoices(session.sessionId);
    setChoices([]);
    setPower(1);
    powerRef.current = 1;
    setShield(0);
    shieldRef.current = 0;
    setCombo(0);
    comboRef.current = 0;
    setBuffs([]);
    buffsRef.current = [];
    setBlessings([]);
    blessingsRef.current = [];
    setCurses([]);
    cursesRef.current = [];
    bossesDefeatedRef.current = 0;
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
    setShield(0);
    shieldRef.current = 0;
    setCombo(0);
    comboRef.current = 0;
    setBuffs([]);
    buffsRef.current = [];
    setBlessings([]);
    blessingsRef.current = [];
    setCurses([]);
    cursesRef.current = [];
    bossesDefeatedRef.current = 0;
    setCurrentFloor(null);
    setRevealedLane(null);
    resetSubmitFlag();
    setPhase('ready');
    void fetchStatus();
  }, [fetchStatus, resetSubmitFlag]);

  const handleBackToGames = useCallback(() => {
    router.push('/games');
  }, [router]);

  const handleBackToReady = useCallback(() => {
    setPhase('ready');
  }, []);

  const floorNumber = choices.length + 1;
  const hasPendingSubmit = pendingSubmitChoices !== null;

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {/* 背景 - 极光/柔和渐变 */}
      <div className="absolute inset-0 z-0 bg-slate-50 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-purple-200/40 rounded-full mix-blend-multiply filter blur-3xl animate-blob" />
        <div className="absolute top-[-10%] right-[-10%] w-[60%] h-[60%] bg-indigo-200/40 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-2000" />
        <div className="absolute bottom-[-20%] left-[20%] w-[60%] h-[60%] bg-pink-200/40 rounded-full mix-blend-multiply filter blur-3xl animate-blob animation-delay-4000" />
        <div className="absolute inset-0 bg-white/30 backdrop-blur-[1px]" />
      </div>

      <style jsx global>{`
        @keyframes blob {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        .animate-blob { animation: blob 10s infinite alternate cubic-bezier(0.4, 0, 0.2, 1); }
        .animation-delay-2000 { animation-delay: 2s; }
        .animation-delay-4000 { animation-delay: 4s; }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
        .animate-shake { animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both; }
        
        @keyframes pop {
            0% { transform: scale(0.95); }
            40% { transform: scale(1.05); }
            100% { transform: scale(1); }
        }
        .animate-pop { animation: pop 0.3s ease-out; }

        @keyframes float-up {
            0% { transform: translateY(10px); opacity: 0; }
            100% { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      <div className="relative z-10 w-full max-w-lg mx-auto h-full flex flex-col min-h-screen">
        {/* 顶部导航区 */}
        <div className="px-6 pt-6 pb-2 flex items-center justify-between">
          <button
            onClick={() => router.push('/games')}
            className="group flex items-center gap-1.5 text-slate-500 hover:text-slate-800 transition-all font-medium bg-white/60 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/40 shadow-sm hover:shadow-md hover:bg-white/80 active:scale-95"
          >
            <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
            <span className="text-sm">返回</span>
          </button>

          <Link
            href="/store"
            className="flex items-center gap-2 px-4 py-2 bg-white/60 backdrop-blur-md rounded-2xl shadow-sm border border-white/40 text-slate-700 hover:border-amber-200 hover:text-amber-600 transition-all group hover:shadow-md active:scale-95"
          >
            <div className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center">
              <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
            </div>
            <span className="font-bold text-sm tabular-nums">{status?.balance ?? '...'}</span>
          </Link>
        </div>

        {/* 游戏标题区 */}
        <div className="px-6 py-2 text-center mb-2">
          <h1 className="text-3xl font-black text-slate-800 tracking-tight drop-shadow-sm flex items-center justify-center gap-2">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">
              无限爬塔
            </span>
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Swipe left/right or Tap to choose
          </p>
        </div>

        {/* 主游戏区域 */}
        <div className="flex-1 flex flex-col px-4 pb-6 min-h-0">
          {/* 错误提示 */}
          {error && (
            <div className="mb-4 p-4 bg-red-50/90 backdrop-blur-md border border-red-200/50 rounded-2xl text-red-600 text-center text-sm font-bold shadow-sm animate-shake">
              {error}
            </div>
          )}

          {hasPendingSubmit && (
            <div className="mb-4 p-4 bg-orange-50/90 backdrop-blur-md border border-orange-200/50 rounded-2xl shadow-sm animate-in slide-in-from-top-2">
              <div className="text-orange-800 font-bold text-center text-sm mb-2">上局结算异常</div>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={handleRetrySubmit}
                  disabled={loading}
                  className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-xl shadow-orange-200 shadow-md transition-all active:scale-95 disabled:opacity-50"
                >
                  {loading ? '重试中...' : '重试提交'}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={loading}
                  className="px-4 py-2 border border-orange-200 bg-white/50 text-orange-600 text-xs font-bold rounded-xl hover:bg-orange-50 transition-all active:scale-95 disabled:opacity-50"
                >
                  放弃本局
                </button>
              </div>
            </div>
          )}

          {/* 冷却提示 */}
          {status?.inCooldown && phase === 'ready' && (
            <div className="mb-6 p-6 bg-slate-900/5 backdrop-blur-md border border-white/20 rounded-3xl flex flex-col items-center justify-center gap-3 animate-in fade-in zoom-in-95">
              <div className="text-4xl font-black text-slate-700 tabular-nums">
                {status.cooldownRemaining}<span className="text-base font-medium text-slate-400 ml-1">s</span>
              </div>
              <div className="text-sm font-medium text-slate-500">休息一下，喝口水吧</div>
            </div>
          )}

          {/* 今日统计 */}
          {status?.dailyStats && phase !== 'playing' && phase !== 'selectDifficulty' && (
            <div className="mb-6 bg-white/60 backdrop-blur-md rounded-3xl p-6 shadow-sm border border-white/50 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-center gap-8">
                <div className="text-center">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 font-bold">今日游戏</div>
                  <div className="text-2xl font-black text-slate-800 tabular-nums">
                    {status.dailyStats.gamesPlayed} <span className="text-sm font-medium text-slate-400">局</span>
                  </div>
                </div>
                <div className="w-px h-10 bg-slate-200/50" />
                <div className="text-center">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 font-bold">今日积分</div>
                  <div className={`text-2xl font-black ${status.pointsLimitReached ? 'text-orange-500' : 'text-emerald-600'}`}>
                    <span className="tabular-nums">{status.dailyStats.pointsEarned}</span>{' '}
                    <span className="text-slate-300">/</span>{' '}
                    <span className="text-sm font-medium text-slate-500 tabular-nums">{status.dailyLimit ?? 2000}</span>
                    {status.pointsLimitReached && (
                      <span className="block text-[10px] text-orange-500 font-bold mt-0.5">已达上限</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 主内容 */}
          {phase === 'ready' && (
            <div className="flex-1 flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
              <div className="bg-white/70 backdrop-blur-md rounded-[2rem] p-8 shadow-sm border border-white/50 relative overflow-hidden group hover:shadow-xl transition-all hover:-translate-y-1">
                <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity duration-500">
                  <Layers className="w-40 h-40 text-slate-900 rotate-12" />
                </div>
                <div className="relative z-10">
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-lg shadow-indigo-200 mx-auto mb-4 rotate-3 group-hover:rotate-6 transition-transform">
                      <Zap className="w-8 h-8" />
                    </div>
                    <h2 className="text-2xl font-black text-slate-800">准备出发</h2>
                    <p className="text-slate-500 text-sm mt-2 font-medium">击败弱小，躲避强大，勇攀高峰</p>
                  </div>

                  <button
                    onClick={handleStart}
                    disabled={loading || status?.inCooldown || hasPendingSubmit}
                    className="w-full py-4 px-6 bg-slate-900 hover:bg-slate-800 text-white font-bold text-lg rounded-2xl transition-all shadow-lg shadow-slate-200 hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98] flex items-center justify-center gap-2 group/btn"
                  >
                    {loading ? '处理中...' : (
                      <>
                        <span>开始冒险</span>
                        <ChevronLeft className="w-5 h-5 rotate-180 group-hover/btn:translate-x-1 transition-transform" />
                      </>
                    )}
                  </button>

                  <div className="mt-8 flex gap-2 overflow-x-auto pb-2 no-scrollbar snap-x">
                    <div className="flex-none w-64 p-4 bg-white/50 rounded-2xl border border-white/50 text-sm snap-center">
                      <div className="font-bold text-slate-700 mb-1 flex items-center gap-1">
                        <span>⚔️</span> 基础规则
                      </div>
                      <div className="text-slate-500 text-xs leading-relaxed">
                        初始力量1。击败力量小于你的怪物(+力量)，躲避大于你的怪物(Game Over)。
                      </div>
                    </div>
                    <div className="flex-none w-64 p-4 bg-white/50 rounded-2xl border border-white/50 text-sm snap-center">
                      <div className="font-bold text-slate-700 mb-1 flex items-center gap-1">
                        <span>🛡️</span> 进阶技巧
                      </div>
                      <div className="text-slate-500 text-xs leading-relaxed">
                        每10层Boss(双倍奖励)。商店可买Buff。连击可获额外加成。护盾抵挡致命一击。
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 简易记录展示 */}
              {status?.records?.length ? (
                <div className="bg-white/40 backdrop-blur-sm rounded-3xl p-6 border border-white/30">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">最近高光</h3>
                  </div>
                  <div className="space-y-3">
                    {status.records.slice(0, 3).map((r, i) => (
                      <div key={r.id} className="flex items-center justify-between p-3 bg-white/60 rounded-xl border border-white/40 shadow-sm">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${i === 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-100 text-slate-500'}`}>
                            #{i + 1}
                          </div>
                          <div>
                            <div className="text-sm font-bold text-slate-700">{r.floorsClimbed}层</div>
                            <div className="text-[10px] text-slate-400">力量 {formatPower(r.finalPower)}</div>
                          </div>
                        </div>
                        <div className="text-sm font-black text-emerald-600">+{r.pointsEarned}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {phase === 'selectDifficulty' && (
            <div className="flex-1 flex flex-col justify-center animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
              <DifficultySelect
                onSelect={handleDifficultySelect}
                disabled={loading}
              />
              <div className="text-center mt-8">
                <button
                  onClick={handleBackToReady}
                  disabled={loading}
                  className="px-6 py-2 rounded-full bg-white/50 hover:bg-white/80 text-slate-500 hover:text-slate-800 transition-all font-medium text-sm backdrop-blur-sm shadow-sm"
                  type="button"
                >
                  取消，我再想想
                </button>
              </div>
            </div>
          )}

          {phase === 'playing' && session && currentFloor && (
            <div className="flex-1 flex flex-col animate-in fade-in duration-300 min-h-0">
              {/* 粘性状态栏 */}
              <GameHeader
                floorNumber={floorNumber}
                power={power}
                choicesCount={choices.length}
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

              {/* 核心交互区 */}
              <div className="flex-1 flex flex-col justify-center my-2 relative min-h-[300px]">
                <LaneCards
                  floor={currentFloor}
                  playerPower={power}
                  onChooseLane={handleChooseLane}
                  disabled={isAnimating || loading || hasPendingSubmit}
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

              {/* 玩家角色标记 - 底部固定或悬浮 */}
              <div className="flex justify-center mb-6 mt-auto">
                <div className="relative group cursor-default">
                  <div className={`
                    w-20 h-20 rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800
                    flex items-center justify-center text-4xl shadow-xl shadow-slate-300
                    transition-all duration-300 border-4 border-white
                    ${animState === 'walking' ? 'animate-bounce' : ''}
                    ${animState === 'attacking' || animState === 'bossDefeated' ? 'scale-110 shadow-red-200 border-red-100' : ''}
                    ${animState === 'powerup' || animState === 'shopping' ? 'scale-110 ring-4 ring-yellow-300/50 border-amber-100' : ''}
                    ${animState === 'shieldBlock' ? 'scale-110 ring-4 ring-blue-300/50 border-blue-100' : ''}
                    ${animState === 'trapped' ? 'animate-tile-shake border-red-200' : ''}
                    ${animState === 'death' ? 'animate-death-flash' : ''}
                    `}>
                    <span className="filter drop-shadow-md">⚔️</span>
                    {/* 能量光晕 */}
                    <div className="absolute inset-0 rounded-3xl bg-white/10 blur-xl -z-10 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>

                  <div className="absolute -top-3 -right-3 bg-amber-500 text-white text-sm font-black px-2.5 py-1 rounded-xl shadow-lg shadow-amber-200 tabular-nums border-2 border-white transform transition-transform group-hover:scale-110">
                    {formatPower(power)}
                  </div>

                  {shield > 0 && (
                    <div className="absolute -top-3 -left-3 bg-blue-500 text-white text-xs font-bold px-2 py-1 rounded-xl shadow-lg shadow-blue-200 border-2 border-white flex items-center gap-0.5">
                      <Shield className="w-3 h-3 fill-current" />
                      {shield > 1 && <span>x{shield}</span>}
                    </div>
                  )}

                  {combo >= 3 && (
                    <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-red-500 text-white text-xs font-black px-2 py-0.5 rounded-full shadow-lg shadow-red-200 border-2 border-white animate-combo-fire whitespace-nowrap">
                      COMBO x{combo}
                    </div>
                  )}
                </div>
              </div>

              {/* 底部操作栏 */}
              <div className="bg-white/80 backdrop-blur-md rounded-2xl p-2 shadow-sm border border-white/50 mx-4 mb-2 flex justify-between items-center">
                <button
                  onClick={() => setShowHelp((v) => !v)}
                  className="p-3 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all active:scale-95"
                >
                  <HelpCircle className="w-5 h-5" />
                </button>

                {isRestored && (
                  <div className="px-3 py-1 rounded-full bg-amber-50 border border-amber-100 text-amber-700 text-[10px] font-bold">
                    恢复存档
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={handleSettle}
                    disabled={loading || isAnimating || choices.length === 0 || hasPendingSubmit}
                    className="px-4 py-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 font-bold text-xs rounded-xl transition-colors disabled:opacity-50 disabled:bg-slate-50 disabled:text-slate-300"
                  >
                    结算
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={loading || isAnimating}
                    className="px-4 py-2 bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-red-500 font-bold text-xs rounded-xl transition-colors disabled:opacity-50"
                  >
                    放弃
                  </button>
                </div>
              </div>

              {showHelp && (
                <div className="fixed inset-x-4 bottom-24 bg-white/95 backdrop-blur-xl rounded-[2rem] p-6 shadow-2xl border border-white/50 animate-in slide-in-from-bottom-10 z-50">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-black text-slate-800">游戏指南</h3>
                    <button onClick={() => setShowHelp(false)} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200">
                      <X className="w-4 h-4 text-slate-500" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-red-50 rounded-2xl border border-red-100">
                      <div className="font-bold text-red-700 mb-1 flex items-center gap-1">
                        <Ghost className="w-4 h-4" /> 怪物
                      </div>
                      <div className="text-red-600/80">你的力量需 &gt; 怪物。击败后获得力量。</div>
                    </div>
                    <div className="p-3 bg-green-50 rounded-2xl border border-green-100">
                      <div className="font-bold text-green-700 mb-1 flex items-center gap-1">
                        <Plus className="w-4 h-4" /> 增益
                      </div>
                      <div className="text-green-600/80">直接增加力量(+)，或翻倍(*)。</div>
                    </div>
                    <div className="p-3 bg-blue-50 rounded-2xl border border-blue-100">
                      <div className="font-bold text-blue-700 mb-1 flex items-center gap-1">
                        <Shield className="w-4 h-4" /> 护盾
                      </div>
                      <div className="text-blue-600/80">抵挡一次伤害。满则转力量。</div>
                    </div>
                    <div className="p-3 bg-purple-50 rounded-2xl border border-purple-100">
                      <div className="font-bold text-purple-700 mb-1 flex items-center gap-1">
                        <ShoppingBag className="w-4 h-4" /> 商店
                      </div>
                      <div className="text-purple-600/80">每5层。购买强力永久被动。</div>
                    </div>
                  </div>
                  <div className="mt-3 p-3 bg-slate-50 rounded-2xl border border-slate-100 text-xs text-slate-500 text-center">
                    每10层遭遇强大的 Boss，做好准备！
                  </div>
                </div>
              )}
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
              bossesDefeated={result.bossesDefeated}
              maxCombo={result.maxCombo}
              basePoints={result.basePoints}
              bossPoints={result.bossPoints}
              comboPoints={result.comboPoints}
              perfectPoints={result.perfectPoints}
              difficulty={result.difficulty}
              difficultyMultiplier={result.difficultyMultiplier}
              onPlayAgain={handlePlayAgain}
              onBackToGames={handleBackToGames}
            />
          )}

          {/* 主动结算确认 */}
          {showSettleConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in">
              <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4">
                <div className="text-center">
                  <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-emerald-100 rotate-3">
                    <Flag className="w-8 h-8 text-emerald-500" />
                  </div>
                  <h3 className="text-xl font-extrabold text-slate-900 mb-2">确认结算？</h3>
                  <p className="text-slate-500 mb-6 leading-relaxed text-sm">
                    已爬到第 <span className="font-bold text-slate-900 tabular-nums">{choices.length}</span> 层，
                    力量 <span className="font-bold text-slate-900 tabular-nums">{formatPower(power)}</span>
                    <br />
                    <span className="text-xs text-slate-400 mt-1 block">结算后将获得积分并结束本局。</span>
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowSettleConfirm(false)}
                      className="flex-1 py-3 px-4 bg-slate-50 text-slate-600 font-bold rounded-xl hover:bg-slate-100 transition-colors"
                      type="button"
                    >
                      犹豫一下
                    </button>
                    <button
                      onClick={handleConfirmSettle}
                      className="flex-1 py-3 px-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl transition-colors shadow-lg shadow-emerald-200 active:scale-95"
                      type="button"
                    >
                      确认带走
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 积分上限警告 */}
          {showLimitWarning && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-in fade-in">
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
    </div>
  );
}
