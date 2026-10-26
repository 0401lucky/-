'use client';

import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import Image from 'next/image';
import { Check, RefreshCw, Sparkles, Star } from 'lucide-react';
import confetti from 'canvas-confetti';
import { DRAW_MOTION, getDrawImage } from '@/lib/cards/draw-animation';
import { RARITY_LEVELS } from '@/lib/cards/constants';
import type { SingleDrawResult } from '@/lib/cards/draw-types';
import type { Rarity } from '@/lib/cards/types';
import styles from './DrawReveal.module.css';

const RARITY_LABELS: Record<Rarity, string> = {
  legendary_rare: 'SSR+', legendary: 'SSR', epic: 'SR', rare: 'R', common: 'N',
};

// This small canvas resets synchronously, including its resize listeners.
const PARTICLE_CANVAS_OPTIONS = { resize: true, useWorker: false } as const;

interface DrawRevealProps {
  results: SingleDrawResult[];
  cooldownRemaining: number;
  againDisabled: boolean;
  onAgain: () => void;
  onClose: () => void;
}

type MotionStyle = CSSProperties & Record<`--${string}`, string | number>;

const RevealCard = memo(function RevealCard({ result, index, total, flipped, reveal }: {
  result: SingleDrawResult;
  index: number;
  total: number;
  flipped: boolean;
  reveal: (index: number) => void;
}) {
  const angle = total === 1 ? 0 : ((index % 5) - (Math.min(total, 5) - 1) / 2) * 1.4;
  const rowCount = Math.min(3, total - Math.floor(index / 3) * 3);
  const style: MotionStyle = {
    '--entry-delay': `${index * DRAW_MOTION.entryStagger}ms`,
    '--rotation': `${angle}deg`,
    '--entry-x': `${angle * -6}px`,
    '--mobile-shift': total === 1 ? '0px' : `calc(${(3 - rowCount) / 2} * (var(--card-width) + var(--gap)))`,
  };
  return (
    <button
      type="button"
      className={`${styles.card} ${styles[result.card.rarity]} ${flipped ? styles.flipped : ''}`}
      style={style}
      aria-label={flipped ? `${result.card.name}，${result.isDuplicate ? '重复卡牌' : '新卡牌'}` : `揭晓第 ${index + 1} 张卡牌`}
      aria-pressed={flipped}
      aria-disabled={flipped}
      onClick={() => reveal(index)}
    >
      <span className={styles.aura} aria-hidden="true" />
      <span className={styles.inner}>
        <span className={styles.back} aria-hidden="true">
          <span className={styles.backOrbit} />
          <Star size={36} fill="currentColor" strokeWidth={0.7} />
          <span className={styles.backLabel}>LUCKY</span>
          <span className={styles.backRune}>✦ CARD COLLECTION ✦</span>
        </span>
        <span className={styles.front} aria-hidden={!flipped}>
          <Image
            src={getDrawImage(result.card, total === 1)}
            alt={result.card.name}
            fill
            sizes={total === 1 ? '(max-width: 600px) 250px, 300px' : '(max-width: 600px) 120px, 170px'}
            className={styles.art}
            loading="eager"
            fetchPriority="high"
            draggable={false}
          />
          <span className={styles.shade} />
          <span className={styles.rarity}>{RARITY_LABELS[result.card.rarity]}</span>
          <span className={styles.caption}>
            <span className={styles.name}>{result.card.name}</span>
            <span className={`${styles.tag} ${result.isDuplicate ? styles.duplicate : ''}`}>
              {result.isDuplicate ? <><RefreshCw size={10} />+{result.fragmentsAdded ?? 0} 碎片</> : <><Sparkles size={10} />NEW</>}
            </span>
          </span>
          <span className={styles.gleam} aria-hidden="true" />
        </span>
      </span>
    </button>
  );
});

export function DrawReveal({ results, cooldownRemaining, againDisabled, onAgain, onClose }: DrawRevealProps) {
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [flipped, setFlipped] = useState<number[]>(() => reducedMotion ? results.map((_, index) => index) : []);
  const [ready, setReady] = useState(reducedMotion);
  const [skipped, setSkipped] = useState(false);
  const [closing, setClosing] = useState(false);
  const [spotlight, setSpotlight] = useState(false);
  const shown = useRef(new Set<number>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
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

  const celebrate = useCallback(() => {
    if (celebrated.current || closed.current || reducedMotion) return;
    celebrated.current = true;
    const rarity = results[highlight].card.rarity;
    if (RARITY_LEVELS[rarity] < RARITY_LEVELS.epic) return;
    setSpotlight(true);
    if (!canvas.current) return;
    particles.current ??= confetti.create(canvas.current, PARTICLE_CANVAS_OPTIONS);
    const colors = rarity === 'legendary_rare' ? ['#f9a8d4', '#c4b5fd', '#bae6fd', '#fff1f2']
      : rarity === 'legendary' ? ['#fcd34d', '#fef3c7', '#ffffff'] : ['#c4b5fd', '#e9d5ff', '#ffffff'];
    const count = rarity === 'legendary_rare' ? 32 : rarity === 'legendary' ? 24 : 12;
    for (const side of [0.22, 0.78]) {
      void particles.current({ particleCount: count, spread: 58, startVelocity: 22, gravity: 0.75, ticks: 90, shapes: ['circle'],
        angle: side < 0.5 ? 65 : 115, origin: { x: side, y: 0.68 }, colors, scalar: 0.75,
        disableForReducedMotion: true });
    }
  }, [highlight, reducedMotion, results]);

  const reveal = useCallback((index: number) => {
    if (closed.current || shown.current.has(index)) return;
    shown.current.add(index);
    setFlipped([...shown.current]);
    if (index === highlight) schedule(celebrate, DRAW_MOTION.flip * 0.58);
    if (shown.current.size === results.length) {
      schedule(() => setReady(true), reducedMotion ? 0 : DRAW_MOTION.flip + DRAW_MOTION.settle);
    }
  }, [celebrate, highlight, reducedMotion, results.length, schedule]);

  const revealAll = useCallback(() => {
    if (closed.current || ready) return;
    clearTimers();
    setSkipped(true);
    shown.current = new Set(results.map((_, index) => index));
    setFlipped([...shown.current]);
    if (reducedMotion) setReady(true);
    else schedule(() => { celebrate(); setReady(true); }, DRAW_MOTION.skip);
  }, [celebrate, clearTimers, ready, reducedMotion, results, schedule]);

  const leave = useCallback((action: 'onClose' | 'onAgain') => {
    if (closed.current) return;
    closed.current = true;
    clearTimers();
    particles.current?.reset();
    setClosing(true);
    if (reducedMotion) callbacks.current[action]();
    else schedule(() => callbacks.current[action](), DRAW_MOTION.exit);
  }, [clearTimers, reducedMotion, schedule]);

  useEffect(() => {
    if (reducedMotion) {
      shown.current = new Set(results.map((_, index) => index));
      setFlipped([...shown.current]);
      setReady(true);
    } else {
      if (canvas.current && RARITY_LEVELS[results[highlight].card.rarity] >= RARITY_LEVELS.epic) {
        particles.current ??= confetti.create(canvas.current, PARTICLE_CANVAS_OPTIONS);
      }
      results.forEach((_, index) => schedule(() => reveal(index), DRAW_MOTION.firstFlip + index * DRAW_MOTION.flipStagger));
    }
    return () => { clearTimers(); particles.current?.reset(); };
  }, [clearTimers, highlight, reducedMotion, results, reveal, schedule]);

  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference?.matches ?? false);
    preference?.addEventListener('change', update);
    const previous = document.activeElement as HTMLElement | null;
    skipButton.current?.focus({ preventScroll: true });
    return () => { preference?.removeEventListener('change', update); previous?.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { if (ready) confirmButton.current?.focus({ preventScroll: true }); }, [ready]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (ready) leave('onClose'); else revealAll();
    }
    if (event.key === 'Tab') {
      const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  const motion: MotionStyle = {
    '--flip-duration': `${DRAW_MOTION.flip}ms`,
    '--entry-duration': `${DRAW_MOTION.entry}ms`,
    '--celebration-width': results.length === 1 ? '620px' : '880px',
    '--desktop-columns': Math.min(results.length, 5),
    '--desktop-rows': Math.ceil(results.length / 5),
    '--mobile-rows': Math.ceil(results.length / 3),
  };

  return (
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="抽卡结果" onKeyDown={onKeyDown}
      className={`${styles.overlay} ${skipped ? styles.skipped : ''} ${closing ? styles.closing : ''}`}
      style={motion} onClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        if (ready) leave('onClose'); else revealAll();
      }}>
      <div className={`${styles.light} ${spotlight ? styles.highlight : ''}`} aria-hidden="true" />
      <div className={styles.orbit} aria-hidden="true" />
      <canvas ref={canvas} className={styles.celebration} aria-hidden="true" />
      <header className={styles.header}>
        <span className={styles.eyebrow}><Sparkles size={12} />LUCKY COLLECTION</span>
        <h2>本次收获</h2>
        <p aria-live="polite">{ready ? `${results.length} 张卡牌 · ${results.filter((result) => !result.isDuplicate).length} 张新卡`
          : `正在揭晓 ${flipped.length} / ${results.length}`}</p>
      </header>
      <div className={`${styles.cards} ${results.length === 1 ? styles.single : styles.multiple}`}>
        {results.map((result, index) => <RevealCard key={`${result.card.id}-${index}`} result={result}
          index={index} total={results.length} flipped={flipped.includes(index)} reveal={reveal} />)}
      </div>
      <footer className={styles.footer}>
        {ready ? <div className={styles.controls}>
          <button type="button" className={styles.again} onClick={() => leave('onAgain')} disabled={againDisabled || closing}>
            <RefreshCw size={14} />{cooldownRemaining > 0 ? `冷却中 ${cooldownRemaining}s` : '再抽一次'}
            {cooldownRemaining === 0 && <span>−{results.length}</span>}
          </button>
          <button ref={confirmButton} type="button" className={styles.confirm} onClick={() => leave('onClose')} disabled={closing}>
            <Check size={14} />收下卡牌
          </button>
        </div> : <button ref={skipButton} type="button" className={styles.skip} onClick={revealAll} disabled={closing}>
          <Sparkles size={13} />立即揭晓
        </button>}
      </footer>
    </div>
  );
}
