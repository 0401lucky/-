'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FarmStatusResponse, PetType } from '@/lib/types/farm-v2';
import {
  BEHAVIOR,
  DEFAULT_PET_SCALE,
  isSupportedDesktopPet,
  LS_HIDDEN_KEY,
  LS_POSITION_KEY,
  PET_ASSETS,
  PET_DISPLAY_NAME,
  PET_UPDATED_EVENT,
  type DesktopPetType,
  type PetAssetConfig,
  type PetStateName,
} from './petConfig';

type Direction = 'left' | 'right';

interface BehaviorState {
  /** 当前播放的精灵状态 */
  sprite: PetStateName;
  /** 当前世界状态 */
  mode: 'idle' | 'walk' | 'jump' | 'wave' | 'drag' | 'special';
  /** 移动方向（行走时使用） */
  direction: Direction;
  /** 行走目标 x / y */
  targetX: number;
  targetY: number;
  /** 当前坐标（左上角，未缩放） */
  x: number;
  y: number;
  /** 跳跃产生的额外向上位移（像素） */
  yLift: number;
  /** 当前段开始时间 */
  segmentStartedAt: number;
  /** 当前段持续时间 */
  segmentDurationMs: number;
}

interface ViewportSize {
  width: number;
  height: number;
}

function clampX(x: number, vw: number, pw: number): number {
  const max = Math.max(0, vw - pw);
  if (x < 0) return 0;
  if (x > max) return max;
  return x;
}

function clampY(y: number, vh: number, ph: number): number {
  const max = Math.max(0, vh - ph);
  if (y < 0) return 0;
  if (y > max) return max;
  return y;
}

function getInitialPosition(
  viewport: ViewportSize,
  petWidth: number,
  petHeight: number,
): { x: number; y: number } {
  const defaultX = Math.max(0, viewport.width - petWidth - 32);
  const defaultY = Math.max(0, viewport.height - petHeight - BEHAVIOR.groundOffset);
  if (typeof window === 'undefined') return { x: defaultX, y: defaultY };
  try {
    const stored = window.localStorage.getItem(LS_POSITION_KEY);
    if (stored) {
      const [xs, ys] = stored.split(',');
      const x = Number.parseFloat(xs);
      const y = Number.parseFloat(ys);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        return {
          x: clampX(x, viewport.width, petWidth),
          y: clampY(y, viewport.height, petHeight),
        };
      }
    }
  } catch {
    // 忽略 storage 异常
  }
  return { x: defaultX, y: defaultY };
}

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

const SPECIAL_SPRITES: ReadonlyArray<PetStateName> = ['waiting', 'review', 'failed', 'running'];

/** 只有 idle 才允许被用户的点击/双击触发表情；跑步和表情段都不被表情打断 */
function isFreeMode(mode: BehaviorState['mode']): boolean {
  return mode === 'idle';
}

type NextBehavior = Pick<
  BehaviorState,
  'sprite' | 'mode' | 'direction' | 'targetX' | 'targetY' | 'segmentStartedAt' | 'segmentDurationMs'
>;

function pickNextBehavior(
  current: BehaviorState,
  viewport: ViewportSize,
  petWidth: number,
  petHeight: number,
  now: number,
): NextBehavior {
  const roll = Math.random();
  const duration = randBetween(BEHAVIOR.segmentMinMs, BEHAVIOR.segmentMaxMs);

  // 12% 招手 / 18% 特殊表情 / 25% idle / 45% 行走
  if (roll < 0.12) {
    return {
      sprite: 'waving',
      mode: 'wave',
      direction: current.direction,
      targetX: current.x,
      targetY: current.y,
      segmentStartedAt: now,
      segmentDurationMs: 1500,
    };
  }

  if (roll < 0.30) {
    const sprite = SPECIAL_SPRITES[Math.floor(Math.random() * SPECIAL_SPRITES.length)];
    return {
      sprite,
      mode: 'special',
      direction: current.direction,
      targetX: current.x,
      targetY: current.y,
      segmentStartedAt: now,
      segmentDurationMs: 2600,
    };
  }

  if (roll < 0.55) {
    return {
      sprite: 'idle',
      mode: 'idle',
      direction: current.direction,
      targetX: current.x,
      targetY: current.y,
      segmentStartedAt: now,
      segmentDurationMs: duration,
    };
  }

  // 行走：随机二维目标，保留最小距离
  const maxX = Math.max(0, viewport.width - petWidth);
  const maxY = Math.max(0, viewport.height - petHeight);
  let tx = Math.round(randBetween(0, maxX));
  let ty = Math.round(randBetween(20, maxY));
  if (Math.hypot(tx - current.x, ty - current.y) < 80) {
    tx = current.x > maxX / 2 ? Math.max(0, current.x - 160) : Math.min(maxX, current.x + 160);
    ty = current.y > maxY / 2 ? Math.max(20, current.y - 120) : Math.min(maxY, current.y + 120);
  }
  const dir: Direction = tx >= current.x ? 'right' : 'left';
  return {
    sprite: dir === 'right' ? 'running-right' : 'running-left',
    mode: 'walk',
    direction: dir,
    targetX: tx,
    targetY: ty,
    segmentStartedAt: now,
    segmentDurationMs: duration,
  };
}

function useViewportSize(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 720 : window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

interface FetchedPet {
  type: PetType;
  name: string;
}

function useAdoptedPet(): { loading: boolean; pet: FetchedPet | null } {
  const [pet, setPet] = useState<FetchedPet | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/farm/status', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) {
        setPet(null);
        return;
      }
      const data = (await res.json()) as { success: boolean; data?: FarmStatusResponse };
      const p = data?.data?.state?.pet;
      if (p && p.type) {
        setPet({ type: p.type, name: p.name ?? '' });
      } else {
        setPet(null);
      }
    } catch {
      setPet(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUpdated = () => refresh();
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    window.addEventListener(PET_UPDATED_EVENT, onUpdated);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener(PET_UPDATED_EVENT, onUpdated);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { loading, pet };
}

function loadStripImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`load failed: ${url}`));
    img.src = url;
  });
}

interface DesktopPetProps {
  /** 渲染比例，默认 0.55 */
  scale?: number;
}

export default function DesktopPet({ scale = DEFAULT_PET_SCALE }: DesktopPetProps) {
  const { loading, pet } = useAdoptedPet();
  const [hidden, setHidden] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(LS_HIDDEN_KEY) === '1';
    } catch {
      return false;
    }
  });

  const persistHidden = useCallback((next: boolean) => {
    setHidden(next);
    try {
      if (next) window.localStorage.setItem(LS_HIDDEN_KEY, '1');
      else window.localStorage.removeItem(LS_HIDDEN_KEY);
    } catch {
      // 忽略
    }
  }, []);

  if (loading) return null;
  if (!pet) return null;
  if (!isSupportedDesktopPet(pet.type)) return null;

  if (hidden) {
    return <RestoreButton onClick={() => persistHidden(false)} petType={pet.type} />;
  }

  return (
    <PetStage
      petType={pet.type}
      scale={scale}
    />
  );
}

interface RestoreButtonProps {
  petType: DesktopPetType;
  onClick: () => void;
}

function RestoreButton({ petType, onClick }: RestoreButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`显示${PET_DISPLAY_NAME[petType]}桌宠`}
      title="显示桌宠"
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        width: 44,
        height: 44,
        borderRadius: 22,
        border: '1px solid rgba(15,23,42,0.15)',
        background: 'rgba(255,255,255,0.92)',
        boxShadow: '0 6px 20px rgba(15,23,42,0.15)',
        cursor: 'pointer',
        zIndex: 9998,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
        lineHeight: 1,
      }}
    >
      {RESTORE_ICON[petType]}
    </button>
  );
}

const RESTORE_ICON: Record<DesktopPetType, string> = {
  cat: '🐱',
  red_panda: '🦊',
  dog: '🐶',
  rabbit: '🐰',
};

interface PetStageProps {
  petType: DesktopPetType;
  scale: number;
}

function PetStage({ petType, scale }: PetStageProps) {
  const asset: PetAssetConfig = PET_ASSETS[petType];
  const viewport = useViewportSize();

  const petWidth = Math.round(asset.cellWidth * scale);
  const petHeight = Math.round(asset.cellHeight * scale);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stripsRef = useRef<Map<PetStateName, HTMLImageElement>>(new Map());
  const stripPromisesRef = useRef<Map<PetStateName, Promise<HTMLImageElement>>>(new Map());
  const behaviorRef = useRef<BehaviorState | null>(null);
  const rafRef = useRef<number>(0);
  const spriteStartedAtRef = useRef<number>(0);

  const ensureStrip = useCallback(
    (state: PetStateName): HTMLImageElement | null => {
      const img = stripsRef.current.get(state);
      if (img) return img;
      if (!stripPromisesRef.current.has(state)) {
        const url = `${asset.stripBaseUrl}/${state}.webp`;
        const promise = loadStripImage(url).then((loaded) => {
          stripsRef.current.set(state, loaded);
          return loaded;
        });
        stripPromisesRef.current.set(state, promise);
      }
      return null;
    },
    [asset.stripBaseUrl],
  );

  // 预加载常用状态贴图
  useEffect(() => {
    stripsRef.current = new Map();
    stripPromisesRef.current = new Map();
    ensureStrip('idle');
    ensureStrip('running-right');
    ensureStrip('running-left');
    ensureStrip('jumping');
    ensureStrip('waving');
  }, [petType, ensureStrip]);

  // 初始化或视口变化时夹紧位置
  useEffect(() => {
    if (!behaviorRef.current) {
      const initial = getInitialPosition(viewport, petWidth, petHeight);
      behaviorRef.current = {
        sprite: 'idle',
        mode: 'idle',
        direction: 'right',
        targetX: initial.x,
        targetY: initial.y,
        x: initial.x,
        y: initial.y,
        yLift: 0,
        segmentStartedAt: performance.now(),
        segmentDurationMs: 3000,
      };
      spriteStartedAtRef.current = performance.now();
    } else {
      const b = behaviorRef.current;
      b.x = clampX(b.x, viewport.width, petWidth);
      b.y = clampY(b.y, viewport.height, petHeight);
      b.targetX = clampX(b.targetX, viewport.width, petWidth);
      b.targetY = clampY(b.targetY, viewport.height, petHeight);
    }
  }, [viewport, petWidth, petHeight]);

  // 主循环
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let prev = performance.now();

    const setSprite = (next: PetStateName) => {
      const b = behaviorRef.current!;
      if (b.sprite !== next) {
        b.sprite = next;
        spriteStartedAtRef.current = performance.now();
      }
      ensureStrip(next);
    };

    const advance = (b: BehaviorState, now: number) => {
      const nxt = pickNextBehavior(b, viewport, petWidth, petHeight, now);
      Object.assign(b, nxt);
      setSprite(nxt.sprite);
    };

    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      const b = behaviorRef.current;
      if (!b) return;
      const dt = Math.min(48, now - prev);
      prev = now;

      if (b.mode === 'walk') {
        const speed = BEHAVIOR.walkSpeedPx * scale;
        const dxTotal = b.targetX - b.x;
        const dyTotal = b.targetY - b.y;
        const dist = Math.hypot(dxTotal, dyTotal);
        if (dist < 1.5) {
          b.x = b.targetX;
          b.y = b.targetY;
          advance(b, now);
        } else {
          const step = Math.min(dist, (speed * dt) / 1000);
          b.x += (dxTotal / dist) * step;
          b.y += (dyTotal / dist) * step;
          const newDir: Direction = dxTotal >= 0 ? 'right' : 'left';
          if (newDir !== b.direction) {
            b.direction = newDir;
            setSprite(newDir === 'right' ? 'running-right' : 'running-left');
          }
        }
      } else if (b.mode === 'jump') {
        const t = (now - b.segmentStartedAt) / b.segmentDurationMs;
        if (t >= 1) {
          b.yLift = 0;
          advance(b, now);
        } else {
          // 简单抛物线：4 * t * (1 - t)
          b.yLift = 4 * t * (1 - t) * BEHAVIOR.jumpHeightPx;
        }
      } else if (b.mode !== 'drag') {
        // idle / wave / special：到时切换
        if (now - b.segmentStartedAt >= b.segmentDurationMs) {
          advance(b, now);
        }
      }

      // 渲染
      const img = stripsRef.current.get(b.sprite) ?? stripsRef.current.get('idle');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (img) {
        const stateDef = asset.states[b.sprite];
        const elapsed = (now - spriteStartedAtRef.current) % stateDef.durationMs;
        const frame = Math.floor((elapsed / stateDef.durationMs) * stateDef.frames);
        const sx = frame * asset.cellWidth;
        ctx.drawImage(
          img,
          sx,
          0,
          asset.cellWidth,
          asset.cellHeight,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      }

      const container = containerRef.current;
      if (container) {
        container.style.transform = `translate3d(${b.x}px, ${b.y - b.yLift}px, 0)`;
      }
    };

    rafRef.current = requestAnimationFrame((t) => {
      prev = t;
      tick(t);
    });

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafRef.current);
      } else {
        prev = performance.now();
        rafRef.current = requestAnimationFrame((t) => {
          prev = t;
          tick(t);
        });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [asset, ensureStrip, petWidth, petHeight, scale, viewport]);

  // 交互：拖拽 / 单击 / 双击
  // 优先级：拖拽(=跑步) > 表情 > idle；表情段或跑步段中的单击/双击会被忽略
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let pointerId: number | null = null;
    let pressedAt = 0;
    let pressedX = 0;
    let pressedY = 0;
    let movedDistance = 0;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let isDragging = false;
    let preDragMode: BehaviorState['mode'] = 'idle';
    let preDragSprite: PetStateName = 'idle';
    let preDragSegmentStartedAt = 0;
    let preDragSegmentDurationMs = 0;
    let pendingWaveTimer: number | null = null;

    const cancelPendingWave = () => {
      if (pendingWaveTimer !== null) {
        window.clearTimeout(pendingWaveTimer);
        pendingWaveTimer = null;
      }
    };

    const triggerWave = () => {
      const b = behaviorRef.current!;
      const now = performance.now();
      b.mode = 'wave';
      b.sprite = 'waving';
      b.segmentStartedAt = now;
      b.segmentDurationMs = 1500;
      spriteStartedAtRef.current = now;
    };

    const triggerJump = () => {
      const b = behaviorRef.current!;
      const now = performance.now();
      b.mode = 'jump';
      b.sprite = 'jumping';
      b.segmentStartedAt = now;
      b.segmentDurationMs = asset.states.jumping.durationMs;
      b.yLift = 0;
      spriteStartedAtRef.current = now;
    };

    const restorePreDragState = () => {
      const b = behaviorRef.current!;
      b.mode = preDragMode;
      b.sprite = preDragSprite;
      b.segmentStartedAt = preDragSegmentStartedAt;
      b.segmentDurationMs = preDragSegmentDurationMs;
      spriteStartedAtRef.current = performance.now();
    };

    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      pointerId = event.pointerId;
      container.setPointerCapture(event.pointerId);
      pressedAt = performance.now();
      pressedX = event.clientX;
      pressedY = event.clientY;
      movedDistance = 0;
      isDragging = false;
      const b = behaviorRef.current!;
      dragOffsetX = event.clientX - b.x;
      dragOffsetY = event.clientY - b.y;
      // 暂存当前段，mode 标记为 drag 让主循环冻结自动切换；sprite 暂不变
      preDragMode = b.mode;
      preDragSprite = b.sprite;
      preDragSegmentStartedAt = b.segmentStartedAt;
      preDragSegmentDurationMs = b.segmentDurationMs;
      b.mode = 'drag';
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      const dx = event.clientX - pressedX;
      const dy = event.clientY - pressedY;
      movedDistance = Math.max(movedDistance, Math.hypot(dx, dy));
      const b = behaviorRef.current!;

      if (!isDragging) {
        if (movedDistance <= BEHAVIOR.dragThresholdPx) return;
        // 跨过阈值 → 真正进入拖拽，切到跑步精灵（拖拽属于跑步类，可打断表情）
        isDragging = true;
        const initialDir: Direction = dx >= 0 ? 'right' : 'left';
        b.direction = initialDir;
        b.sprite = initialDir === 'right' ? 'running-right' : 'running-left';
        spriteStartedAtRef.current = performance.now();
      }

      const newX = clampX(event.clientX - dragOffsetX, window.innerWidth, petWidth);
      const newY = clampY(event.clientY - dragOffsetY, window.innerHeight, petHeight);
      const deltaX = newX - b.x;
      if (Math.abs(deltaX) > 0.5) {
        const dir: Direction = deltaX > 0 ? 'right' : 'left';
        if (dir !== b.direction) {
          b.direction = dir;
          b.sprite = dir === 'right' ? 'running-right' : 'running-left';
          spriteStartedAtRef.current = performance.now();
        }
      }
      b.x = newX;
      b.y = newY;
    };

    const finishPointer = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      try {
        container.releasePointerCapture(event.pointerId);
      } catch {
        // 忽略
      }
      const now = performance.now();
      const heldMs = now - pressedAt;
      pointerId = null;
      const b = behaviorRef.current!;

      try {
        window.localStorage.setItem(LS_POSITION_KEY, `${Math.round(b.x)},${Math.round(b.y)}`);
      } catch {
        // 忽略
      }

      if (isDragging) {
        // 拖拽结束 → 跳跃落地反馈
        isDragging = false;
        cancelPendingWave();
        triggerJump();
        return;
      }

      // 未发生拖拽
      if (heldMs > BEHAVIOR.clickThresholdMs) {
        // 长按：恢复原段
        cancelPendingWave();
        restorePreDragState();
        return;
      }

      // 短按（单击/双击候选）：原段不是 idle 则不打断（含跑步、表情）
      if (!isFreeMode(preDragMode)) {
        cancelPendingWave();
        restorePreDragState();
        return;
      }

      // 原段是 idle：允许用户触发动作
      if (pendingWaveTimer !== null) {
        // 第二次点击在 timer 内 → 双击跳跃
        cancelPendingWave();
        triggerJump();
        return;
      }

      // 首次点击：恢复 idle 段并安排招手定时器；期间第二次抬起会取消并改为跳跃
      restorePreDragState();
      pendingWaveTimer = window.setTimeout(() => {
        pendingWaveTimer = null;
        const cur = behaviorRef.current!;
        if (isFreeMode(cur.mode)) {
          triggerWave();
        }
      }, 280);
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', finishPointer);
    container.addEventListener('pointercancel', finishPointer);
    return () => {
      cancelPendingWave();
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', finishPointer);
      container.removeEventListener('pointercancel', finishPointer);
    };
  }, [asset.states.jumping.durationMs, petWidth, petHeight]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: petWidth,
        height: petHeight,
        zIndex: 9999,
        touchAction: 'none',
        cursor: 'grab',
        userSelect: 'none',
        willChange: 'transform',
      }}
      aria-label={`${PET_DISPLAY_NAME[petType]}桌宠`}
      role="img"
    >
      <canvas
        ref={canvasRef}
        width={asset.cellWidth}
        height={asset.cellHeight}
        style={{
          width: petWidth,
          height: petHeight,
          imageRendering: 'pixelated',
          display: 'block',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
