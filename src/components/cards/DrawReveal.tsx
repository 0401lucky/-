'use client';

import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import Image from 'next/image';
import { Check, ChevronRight, RefreshCw, SkipForward, Sparkles, X } from 'lucide-react';
import confetti from 'canvas-confetti';
import { DRAW_MOTION, getDrawImage, getShowcaseDuration } from '@/lib/cards/draw-animation';
import { RARITY_LEVELS } from '@/lib/cards/constants';
import type { SingleDrawResult } from '@/lib/cards/draw-types';
import type { Rarity } from '@/lib/cards/types';
import styles from './DrawReveal.module.css';

const RARITY_LABELS: Record<Rarity, { short: string; name: string }> = {
  legendary_rare: { short: 'SSR+', name: '传说稀有' },
  legendary: { short: 'SSR', name: '传说' },
  epic: { short: 'SR', name: '史诗' },
  rare: { short: 'R', name: '稀有' },
  common: { short: 'N', name: '普通' },
};

// A bounded canvas resets synchronously, including its resize listeners.
const PARTICLE_CANVAS_OPTIONS = { resize: true, useWorker: false } as const;

interface DrawRevealProps {
  results: SingleDrawResult[];
  drawCost?: number;
  cooldownRemaining: number;
  againDisabled: boolean;
  onAgain: () => void;
  onClose: () => void;
}

type MotionStyle = CSSProperties & Record<`--${string}`, string | number>;
type Scene = { phase: 'meteor' | 'showcase' | 'complete'; index: number };

function tiltCard(event: PointerEvent<HTMLElement>, reducedMotion: boolean) {
  if (reducedMotion || event.pointerType !== 'mouse') return;
  const bounds = event.currentTarget.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const x = (event.clientX - bounds.left) / bounds.width - 0.5;
  const y = (event.clientY - bounds.top) / bounds.height - 0.5;
  event.currentTarget.style.setProperty('--tilt-x', `${-y * 12}deg`);
  event.currentTarget.style.setProperty('--tilt-y', `${x * 14}deg`);
}

function resetTilt(event: PointerEvent<HTMLElement>) {
  event.currentTarget.style.removeProperty('--tilt-x');
  event.currentTarget.style.removeProperty('--tilt-y');
}

const DrawCard = memo(function DrawCard({ result, showcase }: { result: SingleDrawResult; showcase: boolean }) {
  const label = RARITY_LABELS[result.card.rarity];
  return (
    <span className={`${styles.card} ${styles[result.card.rarity]} ${showcase ? styles.materialize : ''}`} data-draw-card>
      <span className={styles.pillar} aria-hidden="true" />
      <span className={styles.aura} aria-hidden="true" />
      <span className={styles.tilt}>
        <span className={styles.frame}>
          <span className={styles.artWell}>
            <Image
              src={getDrawImage(result.card, showcase)}
              alt={result.card.name}
              fill
              sizes={showcase ? '(max-width: 600px) 64vw, 320px' : '(max-width: 600px) 30vw, 180px'}
              className={styles.art}
              loading="eager"
              fetchPriority={showcase ? 'high' : 'auto'}
              draggable={false}
            />
            <span className={styles.foil} aria-hidden="true" />
            <span className={styles.plate}>
              <span className={styles.name}>{result.card.name}</span>
              <span className={styles.rarityName}>{label.name}</span>
              <span className={`${styles.tag} ${result.isDuplicate ? styles.duplicate : ''}`}>
                {result.isDuplicate ? <><RefreshCw size={10} />+{result.fragmentsAdded ?? 0} 碎片</> : <><Sparkles size={10} />NEW</>}
              </span>
            </span>
            <span className={styles.rarity}>{label.short}</span>
            <span className={styles.gleam} aria-hidden="true" />
            {showcase && <span className={styles.bloom} aria-hidden="true" />}
          </span>
        </span>
      </span>
    </span>
  );
});

export function DrawReveal(props: DrawRevealProps) {
  if (props.results.length === 0) return null;
  return <DrawRevealAnimation {...props} />;
}

function DrawRevealAnimation({ results, drawCost = 1, cooldownRemaining, againDisabled, onAgain, onClose }: DrawRevealProps) {
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [scene, setScene] = useState<Scene>(() => ({ phase: reducedMotion ? 'complete' : 'meteor', index: 0 }));
  const [skipped, setSkipped] = useState(false);
  const [closing, setClosing] = useState(false);
  const sceneRef = useRef(scene);
  const advanceAllowedAt = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closed = useRef(false);
  const celebrated = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const skipButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const particles = useRef<ReturnType<typeof confetti.create> | null>(null);
  const callbacks = useRef({ onAgain, onClose });
  const highlight = results.reduce((best, result, index) =>
    RARITY_LEVELS[result.card.rarity] > RARITY_LEVELS[results[best].card.rarity] ? index : best, 0);
  const bestRarity = results[highlight].card.rarity;
  const active = results[scene.index];
  const single = results.length === 1;
  const ready = scene.phase === 'complete';
  const sceneRarity = scene.phase === 'meteor' || (ready && !single) ? bestRarity : active.card.rarity;
  const label = RARITY_LABELS[active.card.rarity];

  useEffect(() => { callbacks.current = { onAgain, onClose }; }, [onAgain, onClose]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  const schedule = useCallback((action: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timers.current = timers.current.filter((entry) => entry !== timer);
      action();
    }, delay);
    timers.current.push(timer);
  }, []);

  const transition = useCallback((next: Scene) => {
    if (closed.current) return;
    clearTimers();
    if (next.phase !== 'complete' || !single) particles.current?.reset();
    sceneRef.current = next;
    advanceAllowedAt.current = Date.now() + DRAW_MOTION.minimumShowcase;
    setScene(next);
  }, [clearTimers, single]);

  const advance = useCallback(() => {
    const current = sceneRef.current;
    if (closed.current || current.phase !== 'showcase' || Date.now() < advanceAllowedAt.current) return;
    const next = current.index + 1;
    transition(next < results.length ? { phase: 'showcase', index: next } : { phase: 'complete', index: current.index });
  }, [results.length, transition]);

  const revealAll = useCallback(() => {
    if (closed.current || sceneRef.current.phase === 'complete') return;
    particles.current?.reset();
    setSkipped(true);
    transition({ phase: 'complete', index: sceneRef.current.index });
  }, [transition]);

  const celebrate = useCallback((index: number) => {
    if (index !== highlight || celebrated.current || closed.current || reducedMotion || !canvas.current) return;
    if (sceneRef.current.phase !== 'showcase' || sceneRef.current.index !== index || RARITY_LEVELS[bestRarity] < RARITY_LEVELS.epic) return;
    celebrated.current = true;
    particles.current ??= confetti.create(canvas.current, PARTICLE_CANVAS_OPTIONS);
    const colors = bestRarity === 'legendary_rare' ? ['#ff7ad1', '#ffd36e', '#7cf7ff', '#b09cff', '#ffffff']
      : bestRarity === 'legendary' ? ['#fbbf24', '#fde68a', '#ffffff'] : ['#c084fc', '#e9d5ff', '#ffffff'];
    const count = bestRarity === 'legendary_rare' ? 32 : bestRarity === 'legendary' ? 24 : 12;
    for (const side of [0.3, 0.7]) {
      void particles.current({ particleCount: count, spread: 64, startVelocity: 24, gravity: 0.7, ticks: 85, shapes: ['circle'],
        angle: side < 0.5 ? 65 : 115, origin: { x: side, y: 0.62 }, colors, scalar: 0.75,
        disableForReducedMotion: true });
    }
  }, [bestRarity, highlight, reducedMotion]);

  const leave = useCallback((action: 'onClose' | 'onAgain') => {
    if (closed.current || (action === 'onAgain' && (againDisabled || cooldownRemaining > 0))) return;
    closed.current = true;
    clearTimers();
    particles.current?.reset();
    setClosing(true);
    if (reducedMotion) callbacks.current[action]();
    else exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      callbacks.current[action]();
    }, DRAW_MOTION.exit);
  }, [againDisabled, clearTimers, cooldownRemaining, reducedMotion]);

  useEffect(() => {
    if (closed.current || reducedMotion || scene.phase === 'complete') return;
    if (scene.phase === 'meteor') {
      schedule(() => transition({ phase: 'showcase', index: 0 }), DRAW_MOTION.meteor + DRAW_MOTION.impact);
    } else {
      schedule(() => celebrate(scene.index), DRAW_MOTION.celebrationDelay);
      schedule(advance, single ? DRAW_MOTION.materialize : getShowcaseDuration(active.card.rarity));
    }
    return clearTimers;
  }, [active.card.rarity, advance, celebrate, clearTimers, reducedMotion, scene, schedule, single, transition]);

  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => {
      const reduce = preference?.matches ?? false;
      setReducedMotion(reduce);
      if (reduce && sceneRef.current.phase !== 'complete') revealAll();
    };
    preference?.addEventListener('change', update);
    return () => preference?.removeEventListener('change', update);
  }, [revealAll]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (skipButton.current ?? confirmButton.current)?.focus({ preventScroll: true });
    return () => {
      clearTimers();
      if (exitTimer.current) clearTimeout(exitTimer.current);
      particles.current?.reset();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [clearTimers]);
  useEffect(() => { if (ready) confirmButton.current?.focus({ preventScroll: true }); }, [ready]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (ready) leave('onClose'); else revealAll();
    } else if (event.key === 'ArrowRight' && scene.phase === 'showcase') {
      event.preventDefault();
      advance();
    } else if (event.key === 'Tab') {
      const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const first = buttons[0];
      const last = buttons.at(-1);
      const outside = !dialog.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first?.focus(); }
    }
  };
  const motion: MotionStyle = {
    '--meteor-duration': `${DRAW_MOTION.meteor}ms`,
    '--materialize-duration': `${DRAW_MOTION.materialize}ms`,
    '--summary-duration': `${DRAW_MOTION.summary}ms`,
    '--skip-duration': `${DRAW_MOTION.skip}ms`,
    '--celebration-width': single ? '620px' : '880px',
    '--desktop-columns': Math.min(results.length, 5),
    '--desktop-rows': Math.ceil(results.length / 5),
    '--mobile-columns': Math.min(results.length, 3),
    '--mobile-rows': Math.ceil(results.length / 3),
  };

  return (
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="抽卡结果" onKeyDown={onKeyDown}
      data-phase={scene.phase} data-rarity={sceneRarity}
      className={`${styles.overlay} ${styles[sceneRarity]} ${skipped ? styles.skipped : ''} ${closing ? styles.closing : ''}`}
      style={motion} onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest('button')) return;
        if (ready) { if (!target.closest('[data-draw-card]')) leave('onClose'); }
        else advance();
      }}>
      <div className={styles.stars} aria-hidden="true" />
      <div className={styles.light} aria-hidden="true" />
      <div className={styles.orbit} aria-hidden="true" />
      <canvas ref={canvas} className={styles.celebration} aria-hidden="true" />
      <button type="button" className={styles.close} onClick={ready ? () => leave('onClose') : revealAll}
        aria-label={ready ? '关闭抽卡结果' : '跳过抽卡动画'} disabled={closing}><X size={18} /></button>
      <header className={styles.header}>
        <span className={styles.eyebrow}><Sparkles size={12} />LUCKY COLLECTION</span>
        <h2>{scene.phase === 'meteor' ? '星光回应' : '本次收获'}</h2>
        <p aria-live="polite">{ready ? `${results.length} 张卡牌 · ${results.filter((result) => !result.isDuplicate).length} 张新卡`
          : scene.phase === 'meteor' ? '祈愿中…' : single ? '你的命运已揭晓' : `第 ${scene.index + 1} / ${results.length} 张 · 点击继续`}</p>
      </header>
      <div className={styles.stage}>
        {scene.phase === 'meteor' ? <div className={styles.meteorScene} aria-hidden="true" data-meteor-rarity={bestRarity}>
          {!single && <div className={styles.companions}>{[0, 1, 2].map((index) => <span key={index} className={styles.smallMeteor} />)}</div>}
          <div className={styles.meteor}>
            <span className={styles.meteorTail} />
            {bestRarity === 'legendary_rare' && <span className={styles.prismTail} />}
            <span className={styles.meteorHead} />
          </div>
          <div className={styles.meteorImpact} />
          <div className={styles.meteorFlash} />
        </div> : ready && !single ? <div className={styles.cards} role="group" aria-label="本次卡牌汇总">
          {results.map((result, index) => {
            const rowCount = Math.min(3, results.length - Math.floor(index / 3) * 3);
            const entry: MotionStyle = {
              '--entry-delay': `${index * DRAW_MOTION.summaryStagger}ms`,
              '--mobile-shift': `calc(${(Math.min(results.length, 3) - rowCount) / 2} * (var(--card-width) + var(--gap)))`,
            };
            return <figure key={`${result.card.id}-${index}`} className={styles.summaryCard} style={entry}
              onPointerMove={(event) => tiltCard(event, reducedMotion)} onPointerLeave={resetTilt}>
              <DrawCard result={result} showcase={false} />
            </figure>;
          })}
        </div> : <div className={styles.showcase}>
          <div key={`effects-${scene.index}`} className={styles.showcaseEffects} aria-hidden="true">
            {RARITY_LEVELS[active.card.rarity] >= RARITY_LEVELS.epic && <><span className={styles.watermark}>{label.short}</span><span className={styles.rays} /></>}
            {active.card.rarity !== 'common' && <span className={styles.revealRing} />}
            {active.card.rarity === 'legendary_rare' && <span className={styles.prismRing} />}
          </div>
          <button type="button" className={styles.showcaseCard} onClick={advance} disabled={ready || closing}
            aria-label={single ? `${active.card.name}，${active.isDuplicate ? '重复卡牌' : '新卡牌'}` : '下一张卡牌'}
            onPointerMove={(event) => tiltCard(event, reducedMotion)} onPointerLeave={resetTilt}>
            <DrawCard key={`${active.card.id}-${scene.index}`} result={active} showcase />
          </button>
          <div key={`caption-${scene.index}`} className={styles.showcaseCaption}>
            <span>{label.short} · {label.name}</span>
            <strong>{active.card.name}</strong>
          </div>
        </div>}
      </div>
      <footer className={styles.footer}>
        {ready ? <div className={styles.controls}>
          <button type="button" className={styles.again} onClick={() => leave('onAgain')} disabled={againDisabled || cooldownRemaining > 0 || closing}>
            <RefreshCw size={14} />{cooldownRemaining > 0 ? `冷却中 ${cooldownRemaining}s` : '再抽一次'}
            {cooldownRemaining === 0 && <span>−{results.length * drawCost}</span>}
          </button>
          <button ref={confirmButton} type="button" className={styles.confirm} onClick={() => leave('onClose')} disabled={closing}>
            <Check size={14} />收下卡牌
          </button>
        </div> : <div className={styles.controls}>
          {scene.phase === 'showcase' && !single && <button type="button" className={styles.next} onClick={advance} disabled={closing}>
            {scene.index === results.length - 1 ? '查看汇总' : '下一张'}<ChevronRight size={15} />
          </button>}
          <button ref={skipButton} type="button" className={styles.skip} onClick={revealAll} disabled={closing}>
            <SkipForward size={13} />跳过动画
          </button>
        </div>}
      </footer>
    </div>
  );
}
