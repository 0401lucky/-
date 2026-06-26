'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Crown,
  History,
  Loader2,
  RefreshCw,
  Sparkles,
  Star,
  X,
  Zap,
} from 'lucide-react';
import { ALBUMS, CARDS } from '@/lib/cards/config';
import { PITY_THRESHOLDS, RARITY_PROBABILITIES } from '@/lib/cards/constants';
import type { RecentDraw, UserCards } from '@/lib/cards/draw-types';
import type { CardConfig, Rarity } from '@/lib/cards/types';
import confetti from 'canvas-confetti';

interface CardRulesConfig {
  rarityProbabilities: Record<Rarity, number>;
  pityThresholds: Record<'rare' | 'epic' | 'legendary' | 'legendary_rare', number>;
}

// 单次抽卡结果（与 /api/cards/draw 返回结构一致）
interface SingleDrawResult {
  card: CardConfig;
  isDuplicate: boolean;
  fragmentsAdded?: number;
}

interface DrawResponse {
  success: boolean;
  message?: string;
  drawsAvailable?: number;
  data?: {
    success: boolean;
    card?: CardConfig;
    cards?: SingleDrawResult[];
    count?: number;
    message?: string;
    isDuplicate?: boolean;
    fragmentsAdded?: number;
    drawsAvailable?: number;
  };
}

// 项目 5 档稀有度 → 设计稿的标签 / 主题色 / 星星等元数据
// SSR+ = legendary_rare（传说稀有，最稀有）
// SSR  = legendary（传说）
// SR   = epic（史诗）
// R    = rare（稀有）
// N    = common（普通）
const RARITY_META: Record<
  Rarity,
  { short: string; cn: string; stars: string; themeClass: string; rateClass: string }
> = {
  legendary_rare: { short: 'SSR+', cn: '传说稀有', stars: '★★★★★', themeClass: 'r-mythic', rateClass: 't-mythic' },
  legendary: { short: 'SSR', cn: '传说', stars: '★★★★★', themeClass: 'r-ssr', rateClass: 't-ssr' },
  epic: { short: 'SR', cn: '史诗', stars: '★★★★', themeClass: 'r-sr', rateClass: 't-sr' },
  rare: { short: 'R', cn: '稀有', stars: '★★★', themeClass: 'r-r', rateClass: 't-r' },
  common: { short: 'N', cn: '普通', stars: '★★', themeClass: 'r-n', rateClass: 't-n' },
};

const RARITY_RATE_ORDER: Rarity[] = ['legendary_rare', 'legendary', 'epic', 'rare', 'common'];
const DRAW_COOLDOWN_MS = 5000;

// 格式化相对时间：刚刚 / X 分钟前 / X 小时前 / X 天前 / 具体日期
function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 30) return '刚刚';
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

// 格式化具体时间：今天 HH:MM / 昨天 HH:MM / MM-DD HH:MM / YYYY-MM-DD HH:MM
function formatExactTime(ts: number): string {
  const target = new Date(ts);
  const now = new Date();
  const hh = String(target.getHours()).padStart(2, '0');
  const mm = String(target.getMinutes()).padStart(2, '0');
  const sameYear = target.getFullYear() === now.getFullYear();
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const todayDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayDiff = Math.round((todayDay - targetDay) / 86400000);
  if (dayDiff === 0) return `今天 ${hh}:${mm}`;
  if (dayDiff === 1) return `昨天 ${hh}:${mm}`;
  const M = String(target.getMonth() + 1).padStart(2, '0');
  const D = String(target.getDate()).padStart(2, '0');
  if (sameYear) return `${M}-${D} ${hh}:${mm}`;
  return `${target.getFullYear()}-${M}-${D} ${hh}:${mm}`;
}

// 高稀有度 confetti 触发（沿用旧实现，保持视觉一致）
function fireConfetti(rarity: string) {
  const isMythic = rarity === 'legendary_rare';
  const isLegendary = rarity === 'legendary';
  const colors = isMythic
    ? ['#ff9a9e', '#fad0c4', '#ffecd2', '#a18cd1', '#fbc2eb', '#8fd3f4']
    : isLegendary
      ? ['#fbbf24', '#fcd34d', '#ffffff']
      : ['#c084fc', '#e879f9', '#ffffff'];
  const duration = isMythic ? 3000 : 2000;
  const end = Date.now() + duration;
  (function frame() {
    confetti({ particleCount: isMythic ? 7 : 3, angle: 60, spread: 55, origin: { x: 0 }, colors });
    confetti({ particleCount: isMythic ? 7 : 3, angle: 120, spread: 55, origin: { x: 1 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

export default function DrawPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [cardData, setCardData] = useState<UserCards | null>(null);

  // 抽卡结果弹层
  const [revealing, setRevealing] = useState(false);
  const [revealResults, setRevealResults] = useState<SingleDrawResult[]>([]);
  const [flippedIndices, setFlippedIndices] = useState<number[]>([]);
  const [controlsShown, setControlsShown] = useState(false);
  const [hasSSR, setHasSSR] = useState(false);

  // 主舞台卡片打出动效（翻转 + 缩放）
  const [stagePulling, setStagePulling] = useState(false);

  // 抽卡记录弹窗
  const [showRecords, setShowRecords] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [cardRules, setCardRules] = useState<CardRulesConfig | null>(null);
  const displayRules: CardRulesConfig = cardRules ?? {
    rarityProbabilities: RARITY_PROBABILITIES,
    pityThresholds: PITY_THRESHOLDS,
  };

  // 上次抽卡数（用于"再抽一次"）
  const [lastDrawCount, setLastDrawCount] = useState(1);

  const drawTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const drawCooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const drawCooldownUntilRef = useRef(0);
  const drawInFlightRef = useRef(false);
  const repeatDrawQueuedRef = useRef(false);
  const [drawCooldownRemaining, setDrawCooldownRemaining] = useState(0);

  const clearDrawTimeouts = useCallback(() => {
    for (const t of drawTimeoutsRef.current) clearTimeout(t);
    drawTimeoutsRef.current = [];
  }, []);

  const clearDrawCooldown = useCallback(() => {
    if (drawCooldownTimerRef.current) {
      clearInterval(drawCooldownTimerRef.current);
      drawCooldownTimerRef.current = null;
    }
    drawCooldownUntilRef.current = 0;
    setDrawCooldownRemaining(0);
  }, []);

  const refreshDrawCooldown = useCallback(() => {
    const remaining = Math.max(0, Math.ceil((drawCooldownUntilRef.current - Date.now()) / 1000));
    setDrawCooldownRemaining(remaining);
    if (remaining <= 0 && drawCooldownTimerRef.current) {
      clearInterval(drawCooldownTimerRef.current);
      drawCooldownTimerRef.current = null;
    }
  }, []);

  const startDrawCooldown = useCallback(() => {
    drawCooldownUntilRef.current = Date.now() + DRAW_COOLDOWN_MS;
    refreshDrawCooldown();
    if (drawCooldownTimerRef.current) {
      clearInterval(drawCooldownTimerRef.current);
    }
    drawCooldownTimerRef.current = setInterval(refreshDrawCooldown, 250);
  }, [refreshDrawCooldown]);

  // ----- 数据加载 -----
  const fetchInventory = useCallback(async () => {
    try {
      const res = await fetch('/api/cards/inventory');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.success) setCardData(data.data as UserCards);
    } catch (err) {
      console.error('Failed to load inventory', err);
    }
  }, []);

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch('/api/cards/rules');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.success) setCardRules(data.data as CardRulesConfig);
    } catch (err) {
      console.error('Failed to load card rules', err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const authRes = await fetch('/api/auth/me');
        if (!authRes.ok) {
          router.push('/login?redirect=/cards/draw');
          return;
        }
        if (!cancelled) await Promise.all([fetchInventory(), fetchRules()]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [router, fetchInventory, fetchRules]);

  useEffect(() => () => {
    clearDrawTimeouts();
    clearDrawCooldown();
  }, [clearDrawTimeouts, clearDrawCooldown]);

  // ----- 派生数据（全部基于真实 API/常量） -----
  const drawsAvailable = cardData?.drawsAvailable ?? 0;
  const drawCoolingDown = drawCooldownRemaining > 0;

  const syncDrawsAvailable = useCallback((value: unknown) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    setCardData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        drawsAvailable: Math.max(0, Math.floor(next)),
      };
    });
  }, []);

  // 三档保底剩余抽数：阈值 - 已积累
  const pityRemain = useMemo(
    () => ({
      epic: Math.max(0, displayRules.pityThresholds.epic - (cardData?.pityEpic ?? 0)),
      legendary: Math.max(0, displayRules.pityThresholds.legendary - (cardData?.pityLegendary ?? 0)),
      legendary_rare: Math.max(
        0,
        displayRules.pityThresholds.legendary_rare - (cardData?.pityLegendaryRare ?? cardData?.pityCounter ?? 0),
      ),
    }),
    [
      cardData,
      displayRules.pityThresholds.epic,
      displayRules.pityThresholds.legendary,
      displayRules.pityThresholds.legendary_rare,
    ],
  );

  const ownedCount = cardData?.inventory.length ?? 0;
  const totalCards = CARDS.length;

  // 最近抽卡记录（最多 10 条，最新在前）→ 拼接卡牌完整信息
  const recentDrawsView = useMemo(() => {
    const list = cardData?.recentDraws ?? [];
    return list
      .map((entry) => {
        const card = CARDS.find((c) => c.id === entry.cardId);
        if (!card) return null;
        return { entry, card };
      })
      .filter((item): item is { entry: RecentDraw; card: CardConfig } => item !== null);
  }, [cardData]);

  // ----- 弹层控制 -----
  const closeReveal = useCallback(() => {
    setRevealing(false);
    setHasSSR(false);
    setFlippedIndices([]);
    setControlsShown(false);
  }, []);

  const flipAll = useCallback(() => {
    if (controlsShown) return;
    setFlippedIndices(revealResults.map((_, i) => i));
    revealResults.forEach((r) => {
      if (['legendary_rare', 'legendary', 'epic'].includes(r.card.rarity)) {
        fireConfetti(r.card.rarity);
      }
    });
    setControlsShown(true);
  }, [controlsShown, revealResults]);

  // ----- 抽卡 -----
  const handleDraw = useCallback(
    async (count: number) => {
      if (
        drawInFlightRef.current ||
        drawing ||
        drawCooldownUntilRef.current > Date.now() ||
        drawsAvailable < count
      ) return;
      drawInFlightRef.current = true;
      setDrawing(true);
      setLastDrawCount(count);
      setStagePulling(true);
      clearDrawTimeouts();

      try {
        // 主舞台卡片打出动效（450ms）
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => {
            drawTimeoutsRef.current = drawTimeoutsRef.current.filter((x) => x !== t);
            resolve();
          }, 450);
          drawTimeoutsRef.current.push(t);
        });

        const res = await fetch('/api/cards/draw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count }),
        });
        const data: DrawResponse = await res.json().catch(() => ({
          success: false,
          message: res.ok ? '抽卡响应异常，请稍后重试' : '抽卡服务异常，请稍后重试',
        }));

        if (!data.success || !data.data?.success) {
          syncDrawsAvailable(data.data?.drawsAvailable ?? data.drawsAvailable);
          alert(data.data?.message || data.message || '抽卡失败，请重试');
          return;
        }

        let results: SingleDrawResult[] = [];
        if (count === 1 && data.data.card) {
          results = [
            {
              card: data.data.card,
              isDuplicate: data.data.isDuplicate || false,
              fragmentsAdded: data.data.fragmentsAdded,
            },
          ];
        } else if (data.data.cards) {
          results = data.data.cards;
        }

        if (results.length === 0) return;

        syncDrawsAvailable(data.data.drawsAvailable);
        startDrawCooldown();

        setRevealResults(results);
        setFlippedIndices([]);
        setControlsShown(false);
        setHasSSR(results.some((r) => r.card.rarity === 'legendary_rare'));
        setRevealing(true);

        // 卡片落定后，依次翻牌
        const dropDelay = 600 + results.length * 110 + 400;
        const flipTimer = setTimeout(() => {
          results.forEach((r, idx) => {
            const t = setTimeout(() => {
              setFlippedIndices((prev) => (prev.includes(idx) ? prev : [...prev, idx]));
              if (['legendary_rare', 'legendary', 'epic'].includes(r.card.rarity)) {
                fireConfetti(r.card.rarity);
              }
            }, idx * 180);
            drawTimeoutsRef.current.push(t);
          });
          const ctrlT = setTimeout(() => setControlsShown(true), results.length * 180 + 800);
          drawTimeoutsRef.current.push(ctrlT);
        }, dropDelay);
        drawTimeoutsRef.current.push(flipTimer);

        await fetchInventory();
      } catch (err) {
        console.error('Draw failed', err);
        alert('网络错误，请稍后重试');
      } finally {
        drawInFlightRef.current = false;
        setDrawing(false);
        setStagePulling(false);
      }
    },
    [drawing, drawsAvailable, fetchInventory, clearDrawTimeouts, syncDrawsAvailable, startDrawCooldown],
  );

  const handleAgain = useCallback(() => {
    if (
      repeatDrawQueuedRef.current ||
      drawInFlightRef.current ||
      drawing ||
      drawCooldownUntilRef.current > Date.now() ||
      drawCooldownRemaining > 0 ||
      drawsAvailable < lastDrawCount
    ) return;
    repeatDrawQueuedRef.current = true;
    closeReveal();
    const t = setTimeout(() => {
      repeatDrawQueuedRef.current = false;
      void handleDraw(lastDrawCount);
    }, 300);
    drawTimeoutsRef.current.push(t);
  }, [drawing, drawCooldownRemaining, drawsAvailable, lastDrawCount, closeReveal, handleDraw]);

  // ESC 关闭弹层 / 抽卡记录 / 抽卡规则弹窗
  useEffect(() => {
    if (!revealing && !showRecords && !showRules) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showRules) setShowRules(false);
      else if (showRecords) setShowRecords(false);
      else if (revealing && controlsShown) closeReveal();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [revealing, showRecords, showRules, controlsShown, closeReveal]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-blue-500" />
        <p className="text-blue-400 font-medium tracking-widest animate-pulse">通灵中…</p>
      </div>
    );
  }

  return (
    <div className="gacha-page">
      {/* 紫色 mesh 背景 */}
      <div className="gacha-mesh-bg" aria-hidden />
      {/* 全屏漂浮粒子 */}
      <div className="gacha-stardust" aria-hidden>
        <span style={{ top: '8%', left: '5%', fontSize: 14 }}>✦</span>
        <span style={{ top: '18%', left: '92%', fontSize: 11, animationDelay: '1s' }}>✦</span>
        <span style={{ top: '38%', left: '3%', fontSize: 16, animationDelay: '2.5s' }}>✧</span>
        <span style={{ top: '60%', left: '96%', fontSize: 12, animationDelay: '0.7s' }}>✧</span>
        <span style={{ top: '78%', left: '8%', fontSize: 13, animationDelay: '1.8s' }}>✦</span>
        <span style={{ top: '88%', left: '88%', fontSize: 15, animationDelay: '3s' }}>✧</span>
        <span style={{ top: '28%', left: '50%', fontSize: 10, animationDelay: '1.2s' }}>✦</span>
        <span style={{ top: '68%', left: '45%', fontSize: 11, animationDelay: '2.2s' }}>✧</span>
      </div>

      {/* === 顶部导航栏 === */}
      <header className="gacha-topbar">
        <Link href="/cards" className="exit-btn">
          <span className="arrow">
            <ArrowLeft size={14} strokeWidth={2.4} />
          </span>
          EXIT
        </Link>

        <div className="pity-group">
          <div className="pity-pill epic">
            <span className="crown">
              <Crown size={13} fill="currentColor" strokeWidth={0} />
            </span>
            <span className="label">史诗保底</span>
            <span className="num">{pityRemain.epic}抽</span>
          </div>
          <div className="pity-pill legend">
            <span className="crown">
              <Crown size={13} fill="currentColor" strokeWidth={0} />
            </span>
            <span className="label">传说保底</span>
            <span className="num">{pityRemain.legendary}抽</span>
          </div>
          <div className="pity-pill rare">
            <span className="crown">
              <Crown size={13} fill="currentColor" strokeWidth={0} />
            </span>
            <span className="label">传稀保底</span>
            <span className="num">{pityRemain.legendary_rare}抽</span>
          </div>
        </div>

        <div className="gacha-topbar-actions">
          <button
            type="button"
            className="nav-icon-btn"
            onClick={() => setShowRecords(true)}
            aria-label="查看抽卡记录"
            title="抽卡记录"
          >
            <History size={16} strokeWidth={2.4} />
            {recentDrawsView.length > 0 && <span className="nav-dot">{recentDrawsView.length}</span>}
          </button>
          <button
            type="button"
            className="nav-icon-btn rules-btn"
            onClick={() => setShowRules(true)}
            aria-label="查看抽卡规则"
            title="抽卡规则"
          >
            <BookOpen size={16} strokeWidth={2.4} />
          </button>
          <Link href="/store" className="credits-pill" title="去商店兑换抽卡次数">
            <span className="star-ico">
              <Star size={14} fill="currentColor" strokeWidth={0} />
            </span>
            <span>CREDITS</span>
            <span className="num">{drawsAvailable}</span>
            <span className="bolt">
              <Zap size={14} fill="currentColor" strokeWidth={0} />
            </span>
          </Link>
        </div>
      </header>

      <main className="gacha-container">
        {/* 卡池横幅 */}
        <div className="pool-banner">
          <div className="pool-left">
            <div className="pool-icon">
              <BookOpen size={22} strokeWidth={2.4} />
            </div>
            <div className="pool-info">
              <h3>
                Lucky 综合卡池
                <span className="hot">HOT</span>
              </h3>
              <p>
                包含 {ALBUMS.length} 套主题卡册 · {totalCards} 张精美卡牌等你收集
              </p>
            </div>
          </div>
          <div className="pool-progress">
            <span className="dot" />
            已收集 {ownedCount} / {totalCards}
          </div>
        </div>

        {/* === 主舞台 === */}
        <div className="stage">
          <button
            type="button"
            className={`gacha-card ${stagePulling ? 'pulling' : ''} ${drawing ? 'is-drawing' : ''} ${drawCoolingDown ? 'is-cooling' : ''}`}
            onClick={() => void handleDraw(1)}
            disabled={drawing || drawCoolingDown || drawsAvailable < 1}
            aria-label="点击抽一次"
          >
            <div className="card-stars" aria-hidden>
              <span style={{ top: '18%', left: '14%', fontSize: 12 }}>✦</span>
              <span style={{ top: '24%', right: '18%', fontSize: 14, animationDelay: '0.6s' }}>✧</span>
              <span style={{ top: '60%', left: '10%', fontSize: 10, animationDelay: '1.2s' }}>✦</span>
              <span style={{ top: '70%', right: '14%', fontSize: 13, animationDelay: '1.8s' }}>✧</span>
              <span style={{ bottom: '30%', left: '20%', fontSize: 11, animationDelay: '0.4s' }}>✦</span>
            </div>
            <div className="card-inner">
              <div className="card-top">
                <span className="card-rune">LUCKY ✦ POOL</span>
                <span className="card-corner">
                  <Sparkles size={18} strokeWidth={2} />
                </span>
              </div>
              <div className="card-emblem">
                <span className="emblem-star">
                  <Star size={70} fill="currentColor" strokeWidth={0} />
                </span>
              </div>
              <div className="card-bottom">
                <div className="card-tap">
                  {drawing ? 'DRAWING…' : drawCoolingDown ? `COOLDOWN ${drawCooldownRemaining}s` : 'TAP TO OPEN'}
                </div>
                <div className="card-hint">
                  {drawCoolingDown ? '卡牌能量正在重置，稍等一下再抽' : '点击或抽卡按钮揭晓你的命运'}
                </div>
              </div>
            </div>
          </button>
        </div>

        {/* === 操作按钮 === */}
        <div className="action-bar">
          <button
            type="button"
            className="draw-btn single"
            onClick={() => void handleDraw(1)}
            disabled={drawing || drawCoolingDown || drawsAvailable < 1}
          >
            <span className="shine" />
            <span className="ico">
              <Star size={18} fill="currentColor" strokeWidth={0} />
            </span>
            {drawCoolingDown ? '冷却中' : '单抽'}
            <span className="cost">{drawCoolingDown ? `${drawCooldownRemaining}s` : '−1'}</span>
          </button>
          <button
            type="button"
            className="draw-btn multi"
            onClick={() => void handleDraw(5)}
            disabled={drawing || drawCoolingDown || drawsAvailable < 5}
          >
            <span className="shine" />
            <span className="ico">
              <Zap size={18} fill="currentColor" strokeWidth={0} />
            </span>
            {drawCoolingDown ? '冷却中' : '五连抽'}
            <span className="cost">{drawCoolingDown ? `${drawCooldownRemaining}s` : '−5'}</span>
          </button>
        </div>

      </main>

      {/* === 抽卡结果弹层 === */}
      {revealing && (
        <div
          className={`reveal-overlay show ${hasSSR ? 'has-ssr' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label="抽卡结果"
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.r-card') || target.closest('.reveal-controls') || target.closest('.reveal-tip')) return;
            if (controlsShown) closeReveal();
            else flipAll();
          }}
        >
          <div className="reveal-burst" />
          <div className="reveal-cards">
            {revealResults.map((result, i) => {
              const meta = RARITY_META[result.card.rarity];
              const total = revealResults.length;
              const span = total > 1 ? 18 : 0;
              const rot = total > 1 ? -span / 2 + (span * i) / (total - 1) : 0;
              const flipped = flippedIndices.includes(i);
              // 用 React inline style 直接控制延迟与最终旋转角度，
              // 不再依赖 --i / --rot CSS 自定义属性，避免传值不一致或单位推断问题
              const cardStyle: React.CSSProperties = {
                animationDelay: `${i * 110}ms`,
              };
              // 通过 ref 在挂载时把 --rot 写到元素上（CSS keyframe 100% 用 var(--rot,0deg)）
              const cardRef = (el: HTMLDivElement | null) => {
                if (el) el.style.setProperty('--rot', `${rot}deg`);
              };
              return (
                <div
                  key={`${result.card.id}-${i}`}
                  ref={cardRef}
                  className={`r-card ${meta.themeClass} ${flipped ? 'flipped' : ''}`}
                  style={cardStyle}
                >
                  <div className="r-card-inner">
                    <div className="r-card-back">
                      <div className="back-mark">
                        <Star size={28} fill="currentColor" strokeWidth={0} />
                      </div>
                      <div className="back-rune">LUCKY ✦ POOL</div>
                    </div>
                    <div className="r-card-front">
                      <span className="gleam" />
                      <div className="rarity-tag">{meta.short}</div>
                      <div className="r-image">
                        <Image
                          src={result.card.thumbnailImage ?? result.card.image}
                          alt={result.card.name}
                          fill
                          sizes="156px"
                          className="object-cover"
                          priority
                        />
                      </div>
                      <div className="r-name">{result.card.name}</div>
                      {result.isDuplicate ? (
                        <div className="r-tag-bottom dup">
                          <RefreshCw size={11} strokeWidth={2.6} />+{result.fragmentsAdded ?? 0} 碎片
                        </div>
                      ) : (
                        <div className="r-tag-bottom new">
                          <Sparkles size={11} fill="currentColor" strokeWidth={0} />
                          NEW · {meta.stars}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {!controlsShown && (
            <div className="reveal-tip">
              <Star size={14} fill="currentColor" strokeWidth={0} />
              点击屏幕揭晓 / 自动翻牌中…
            </div>
          )}

          {controlsShown && (
            <div className="reveal-controls show">
              <button
                type="button"
                className="reveal-btn again"
                onClick={handleAgain}
                disabled={drawing || drawCoolingDown || drawsAvailable < lastDrawCount}
              >
                <RefreshCw size={14} strokeWidth={2.6} />
                {drawCoolingDown ? '冷却中' : '再抽一次'}
                <span className="cost">{drawCoolingDown ? `${drawCooldownRemaining}s` : `−${lastDrawCount}`}</span>
              </button>
              <button type="button" className="reveal-btn confirm" onClick={closeReveal}>
                <Check size={14} strokeWidth={3} />
                确定
              </button>
            </div>
          )}
        </div>
      )}

      {/* === 抽卡规则弹窗 === */}
      {showRules && (
        <div
          className="rules-modal-mask"
          role="dialog"
          aria-modal="true"
          aria-label="抽卡规则"
          onClick={() => setShowRules(false)}
        >
          <div className="draw-rules-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dr-header">
              <div className="dr-title">
                <span className="dr-title-icon">
                  <BookOpen size={20} strokeWidth={2.4} />
                </span>
                <div>
                  <h3>抽卡规则</h3>
                  <p>抽卡次数、概率、保底与重复卡说明</p>
                </div>
              </div>
              <button
                type="button"
                className="dr-close"
                onClick={() => setShowRules(false)}
                aria-label="关闭"
              >
                <X size={18} strokeWidth={2.4} />
              </button>
            </div>

            <div className="dr-body">
              <section className="dr-card">
                <h4>抽卡消耗</h4>
                <p>单抽消耗 1 次抽卡次数，五连抽消耗 5 次。抽卡次数不足时按钮会自动置灰，可通过商店兑换补充次数。</p>
              </section>

              <section className="dr-card">
                <h4>稀有度概率</h4>
                <div className="dr-rate-grid">
                  {RARITY_RATE_ORDER.map((r) => {
                    const meta = RARITY_META[r];
                    return (
                      <div key={r} className={`dr-rate ${meta.rateClass}`}>
                        <span className="dr-rate-name">{meta.short} · {meta.cn}</span>
                        <strong>{displayRules.rarityProbabilities[r]}%</strong>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="dr-rule-grid">
                <div className="dr-card">
                  <h4>保底机制</h4>
                  <p>
                    {displayRules.pityThresholds.epic} 抽内至少出现史诗，
                    {displayRules.pityThresholds.legendary} 抽内至少出现传说，
                    {displayRules.pityThresholds.legendary_rare} 抽内至少出现传说稀有。
                  </p>
                </div>
                <div className="dr-card">
                  <h4>重复卡处理</h4>
                  <p>抽到已拥有卡牌时会自动转化为碎片，碎片可用于兑换缺失卡牌，帮助补齐图鉴收藏进度。</p>
                </div>
              </section>

              <section className="dr-card accent">
                <h4>抽卡记录</h4>
                <p>导航栏左侧记录按钮会显示最近 10 次真实抽卡结果，包含获得时间、新卡状态与重复卡碎片数量。</p>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* === 抽卡记录弹窗（紫色玻璃态，与抽卡界面同主题） === */}
      {showRecords && (
        <div
          className="records-modal-mask"
          role="dialog"
          aria-modal="true"
          aria-label="抽卡记录"
          onClick={() => setShowRecords(false)}
        >
          <div className="records-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rm-header">
              <div className="rm-title">
                <span className="rm-title-icon">
                  <BookOpen size={20} strokeWidth={2.4} />
                </span>
                <div>
                  <h3>抽卡记录</h3>
                  <p>显示最近 10 次的真实抽卡结果</p>
                </div>
              </div>
              <span className="rm-count">
                <span className="rm-count-num">{recentDrawsView.length}</span>
                <span className="rm-count-total"> / 10</span>
              </span>
              <button
                type="button"
                className="rm-close"
                onClick={() => setShowRecords(false)}
                aria-label="关闭"
              >
                <X size={18} strokeWidth={2.4} />
              </button>
            </div>

            <div className="rm-body">
              {recentDrawsView.length === 0 ? (
                <div className="rm-empty">
                  <div className="rm-empty-icon">
                    <Sparkles size={28} strokeWidth={2} />
                  </div>
                  <div className="rm-empty-text">还没有抽卡记录</div>
                  <div className="rm-empty-sub">关闭弹窗后点击「单抽 / 五连抽」开启你的第一抽</div>
                </div>
              ) : (
                <ul className="rm-list">
                  {recentDrawsView.map(({ entry, card }, idx) => {
                    const meta = RARITY_META[card.rarity];
                    return (
                      <li
                        key={`${entry.timestamp}-${idx}`}
                        className={`rm-item rm-${meta.themeClass}`}
                      >
                        <div className="rm-index">#{idx + 1}</div>
                        <div className="rm-thumb">
                          <Image
                            src={card.thumbnailImage ?? card.image}
                            alt={card.name}
                            fill
                            sizes="64px"
                            className="object-cover"
                          />
                        </div>
                        <div className="rm-info">
                          <div className="rm-info-top">
                            <span className="rm-name" title={card.name}>
                              {card.name}
                            </span>
                            <span className={`rm-rarity rm-${meta.themeClass}`}>{meta.short}</span>
                          </div>
                          <div className="rm-info-bottom">
                            <span className="rm-time">
                              <span className="rm-time-exact">{formatExactTime(entry.timestamp)}</span>
                              <span className="rm-time-rel">{formatRelativeTime(entry.timestamp)}</span>
                            </span>
                          </div>
                        </div>
                        <div className="rm-tail">
                          {entry.isDuplicate ? (
                            <span className="rm-status dup">
                              <RefreshCw size={11} strokeWidth={2.6} />+{entry.fragmentsAdded} 碎片
                            </span>
                          ) : (
                            <span className="rm-status new">
                              <Sparkles size={11} fill="currentColor" strokeWidth={0} />
                              NEW · {meta.stars}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .gacha-page {
          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
          color: #0f172a;
          min-height: 100vh;
          padding-bottom: 80px;
          position: relative;
          --c-purple: #3b82f6;
          --c-violet: #1d4ed8;
          --c-pink: #ec4899;
          --c-amber: #fbbf24;
          --grad-purple: linear-gradient(135deg, #60a5fa, #3b82f6);
          --grad-violet: linear-gradient(135deg, #93c5fd, #3b82f6 50%, #1d4ed8);
          --grad-gold: linear-gradient(135deg, #fde047, #f59e0b 50%, #ea580c);
          --grad-pink: linear-gradient(135deg, #fb7185, #ec4899);
          --grad-cosmic: linear-gradient(135deg, #0c1e4d 0%, #1e3a8a 35%, #2563eb 70%, #6366f1 100%);
          --text-main: #0f172a;
          --text-light: #64748b;
          /* 稀有度专属：SR(史诗) 仍保留紫色语义 */
          --rarity-sr: #8b5cf6;
          --grad-rarity-sr: linear-gradient(135deg, #a78bfa, #8b5cf6);
        }
        .gacha-page * { box-sizing: border-box; }
        .gacha-page a { color: inherit; text-decoration: none; }
        .gacha-page button { font-family: inherit; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }

        /* === 蓝色 mesh 背景 === */
        .gacha-page .gacha-mesh-bg {
          position: fixed;
          inset: 0;
          z-index: -2;
          pointer-events: none;
          background-color: #f0f7ff;
          background-image:
            radial-gradient(circle at 15% 50%, rgba(199, 210, 254, 0.95) 0%, transparent 50%),
            radial-gradient(circle at 85% 30%, rgba(186, 230, 253, 0.85) 0%, transparent 50%),
            radial-gradient(circle at 50% 90%, rgba(165, 243, 252, 0.78) 0%, transparent 55%),
            radial-gradient(circle at 50% 10%, rgba(219, 234, 254, 0.85) 0%, transparent 50%);
          filter: blur(60px);
          animation: gacha-fluid 15s infinite alternate ease-in-out;
        }
        @keyframes gacha-fluid {
          0% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.05) rotate(2deg); }
          100% { transform: scale(1.1) rotate(-2deg); }
        }

        /* 全屏漂浮粒子 */
        .gacha-page .gacha-stardust { position: fixed; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; }
        .gacha-page .gacha-stardust span {
          position: absolute;
          color: rgba(59, 130, 246, 0.35);
          animation: gacha-drift 8s ease-in-out infinite;
        }
        @keyframes gacha-drift {
          0%, 100% { transform: translateY(0) scale(1); opacity: 0.3; }
          50% { transform: translateY(-30px) scale(1.4); opacity: 0.9; }
        }

        /* === 顶部导航栏 === */
        .gacha-page .gacha-topbar {
          position: relative;
          z-index: 100;
          display: grid;
          grid-template-columns: minmax(150px, 1fr) auto minmax(220px, 1fr);
          align-items: center;
          justify-content: center;
          gap: 16px;
          padding: 16px 36px;
          padding-top: max(16px, env(safe-area-inset-top));
          background:
            linear-gradient(135deg, rgba(219, 234, 254, 0.94), rgba(239, 246, 255, 0.86)),
            radial-gradient(circle at 20% 0%, rgba(147, 197, 253, 0.45), transparent 42%);
          backdrop-filter: blur(24px) saturate(1.6);
          -webkit-backdrop-filter: blur(24px) saturate(1.6);
          border-bottom: 1px solid rgba(96, 165, 250, 0.32);
          box-shadow: 0 16px 36px rgba(37, 99, 235, 0.08);
        }

        .gacha-page .exit-btn {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 9px 18px 9px 9px;
          background: rgba(255, 255, 255, 0.82);
          border: 1px solid rgba(96, 165, 250, 0.35);
          border-radius: 999px;
          backdrop-filter: blur(10px);
          transition: all 0.2s;
          font-weight: 800;
          font-size: 13px;
          color: #1d4ed8;
          letter-spacing: 1px;
          box-shadow: 0 10px 22px rgba(37, 99, 235, 0.1);
          grid-column: 1;
          justify-self: start;
        }
        .gacha-page .exit-btn:hover { background: #fff; transform: translateY(-2px); box-shadow: 0 14px 28px rgba(37, 99, 235, 0.18); }
        .gacha-page .exit-btn .arrow {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: linear-gradient(135deg, #60a5fa, #2563eb);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
        }

        .gacha-page .pity-group {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          flex-wrap: nowrap;
          grid-column: 2;
          justify-self: center;
        }
        .gacha-page .pity-pill {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          padding: 7px 16px 7px 9px;
          background: rgba(255, 255, 255, 0.82);
          border: 1px solid rgba(147, 197, 253, 0.4);
          border-radius: 999px;
          backdrop-filter: blur(10px);
          font-size: 12.5px;
          font-weight: 700;
          color: var(--text-main);
          white-space: nowrap;
          box-shadow: 0 8px 18px rgba(37, 99, 235, 0.08);
          transition: all 0.25s;
        }
        .gacha-page .pity-pill:hover { transform: translateY(-2px); background: #fff; box-shadow: 0 14px 28px rgba(37, 99, 235, 0.15); }
        .gacha-page .pity-pill .crown {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          flex-shrink: 0;
        }
        .gacha-page .pity-pill.epic .crown { background: var(--grad-rarity-sr); box-shadow: 0 4px 10px rgba(140, 90, 245, 0.4); }
        .gacha-page .pity-pill.legend .crown { background: var(--grad-gold); box-shadow: 0 4px 10px rgba(251, 191, 36, 0.4); }
        .gacha-page .pity-pill.rare .crown { background: var(--grad-pink); box-shadow: 0 4px 10px rgba(236, 72, 153, 0.35); }
        .gacha-page .pity-pill .label { color: var(--text-light); font-weight: 700; font-size: 11.5px; letter-spacing: 0.3px; }
        .gacha-page .pity-pill .num { font-weight: 900; font-size: 14px; letter-spacing: -0.3px; }
        .gacha-page .pity-pill.epic .num { color: var(--rarity-sr); }
        .gacha-page .pity-pill.legend .num { color: #d97706; }
        .gacha-page .pity-pill.rare .num { color: var(--c-pink); }

        .gacha-page .gacha-topbar-actions {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          flex-shrink: 0;
          grid-column: 3;
          justify-self: end;
        }

        .gacha-page .nav-icon-btn {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.78);
          border: 1px solid rgba(255, 255, 255, 0.96);
          color: var(--c-violet);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          backdrop-filter: blur(12px);
          box-shadow: 0 8px 18px rgba(30, 64, 175, 0.08);
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
        }
        .gacha-page .nav-icon-btn:hover {
          background: #fff;
          color: #1d4ed8;
          transform: translateY(-2px);
          box-shadow: 0 14px 28px rgba(59, 130, 246, 0.18);
        }
        .gacha-page .nav-icon-btn.rules-btn {
          background:
            linear-gradient(#fff, #fff) padding-box,
            linear-gradient(135deg, rgba(59, 130, 246, 0.48), rgba(139, 92, 246, 0.45)) border-box;
          border: 1px solid transparent;
        }
        .gacha-page .nav-dot {
          position: absolute;
          top: -3px;
          right: -3px;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 999px;
          background: var(--grad-pink);
          color: #fff;
          border: 2px solid #fff;
          font-size: 10px;
          font-weight: 900;
          line-height: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 6px 12px rgba(236, 72, 153, 0.36);
        }

        /* 积分胶囊 */
        .gacha-page .credits-pill {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 8px 8px 8px 18px;
          background: linear-gradient(135deg, #ffffff 0%, #eff6ff 100%);
          border: 1px solid rgba(255, 255, 255, 0.95);
          border-radius: 999px;
          font-size: 14px;
          font-weight: 900;
          color: var(--text-main);
          cursor: pointer;
          box-shadow: 0 10px 24px rgba(59, 130, 246, 0.18), inset 0 1px 0 rgba(255, 255, 255, 1);
          letter-spacing: 0.5px;
          transition: all 0.25s;
        }
        .gacha-page .credits-pill:hover { transform: translateY(-2px); box-shadow: 0 14px 32px rgba(59, 130, 246, 0.28); }
        .gacha-page .credits-pill .star-ico {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: var(--grad-purple);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          box-shadow: 0 4px 10px rgba(59, 130, 246, 0.45);
        }
        .gacha-page .credits-pill .num {
          font-weight: 900;
          font-size: 17px;
          background: var(--grad-purple);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          letter-spacing: -0.3px;
        }
        .gacha-page .credits-pill .bolt {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: var(--grad-gold);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          box-shadow: 0 6px 12px rgba(251, 191, 36, 0.45);
          margin-left: 2px;
        }

        /* === 主容器 === */
        .gacha-page .gacha-container {
          max-width: 1280px;
          margin: 0 auto;
          padding: 28px 36px 80px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
        }

        /* === 卡池横幅 === */
        .gacha-page .pool-banner {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 14px 22px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.55));
          border: 1px solid rgba(255, 255, 255, 0.95);
          border-radius: 22px;
          backdrop-filter: blur(20px);
          box-shadow: 0 24px 48px rgba(30, 64, 175, 0.18), inset 0 1px 0 rgba(255, 255, 255, 1);
        }
        .gacha-page .pool-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
        .gacha-page .pool-icon {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: var(--grad-violet);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          flex-shrink: 0;
          box-shadow: 0 8px 16px rgba(59, 130, 246, 0.35);
          position: relative;
        }
        .gacha-page .pool-icon::after {
          content: '';
          position: absolute;
          inset: -3px;
          border-radius: 17px;
          background: var(--grad-violet);
          opacity: 0.3;
          filter: blur(8px);
          z-index: -1;
        }
        .gacha-page .pool-info h3 {
          font-size: 16px;
          font-weight: 900;
          color: var(--text-main);
          letter-spacing: -0.3px;
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .gacha-page .pool-info h3 .hot {
          font-size: 10px;
          font-weight: 800;
          padding: 2px 8px;
          border-radius: 999px;
          background: var(--grad-pink);
          color: #fff;
          letter-spacing: 0.5px;
          box-shadow: 0 4px 10px rgba(236, 72, 153, 0.35);
        }
        .gacha-page .pool-info p {
          font-size: 12.5px;
          color: var(--text-light);
          margin: 2px 0 0;
          font-weight: 600;
        }
        .gacha-page .pool-progress {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          background: rgba(59, 130, 246, 0.1);
          border: 1px solid rgba(59, 130, 246, 0.25);
          border-radius: 999px;
          color: var(--c-violet);
          font-weight: 800;
          font-size: 12.5px;
          white-space: nowrap;
        }
        .gacha-page .pool-progress .dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--c-purple);
          box-shadow: 0 0 8px var(--c-purple);
          animation: gacha-pulse-dot 1.5s ease-in-out infinite;
        }
        @keyframes gacha-pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.3); }
        }

        /* === 主舞台 === */
        .gacha-page .stage {
          position: relative;
          width: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 28px 0 12px;
        }
        .gacha-page .stage::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 620px;
          height: 620px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(96, 165, 250, 0.55), rgba(99, 102, 241, 0.22) 45%, transparent 70%);
          filter: blur(40px);
          animation: gacha-halo 4.5s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes gacha-halo {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.85; }
          50% { transform: translate(-50%, -50%) scale(1.15); opacity: 1; }
        }
        .gacha-page .stage::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 520px;
          height: 520px;
          border-radius: 50%;
          border: 1.5px dashed rgba(59, 130, 246, 0.35);
          animation: gacha-spin 30s linear infinite;
          pointer-events: none;
        }
        @keyframes gacha-spin { to { transform: translate(-50%, -50%) rotate(360deg); } }

        /* 主卡片 */
        .gacha-page .gacha-card {
          position: relative;
          width: 320px;
          aspect-ratio: 5 / 7;
          border-radius: 28px;
          background: var(--grad-cosmic);
          box-shadow:
            0 30px 60px rgba(30, 64, 175, 0.45),
            0 0 0 1.5px rgba(255, 255, 255, 0.18),
            inset 0 1px 0 rgba(255, 255, 255, 0.3);
          overflow: hidden;
          cursor: pointer;
          transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
          z-index: 2;
          padding: 0;
          border: none;
          color: #fff;
        }
        .gacha-page .gacha-card:hover:not(:disabled) {
          transform: translateY(-6px) scale(1.02);
          box-shadow:
            0 40px 80px rgba(30, 64, 175, 0.55),
            0 0 0 1.5px rgba(255, 255, 255, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.4);
        }
        .gacha-page .gacha-card:disabled { cursor: not-allowed; opacity: 0.85; }
        .gacha-page .gacha-card.pulling {
          transform: rotateY(180deg) scale(0.85);
          box-shadow: 0 0 80px rgba(254, 240, 138, 0.7), 0 30px 60px rgba(30, 64, 175, 0.5);
          transition: transform 0.45s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.45s;
        }
        .gacha-page .gacha-card::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image: radial-gradient(rgba(255, 255, 255, 0.18) 1.2px, transparent 1.2px);
          background-size: 18px 18px;
          opacity: 0.7;
          pointer-events: none;
        }
        .gacha-page .gacha-card::after {
          content: '';
          position: absolute;
          top: -30%;
          left: -30%;
          width: 80%;
          height: 80%;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(251, 191, 36, 0.35), transparent 60%);
          filter: blur(40px);
          pointer-events: none;
          animation: gacha-card-glow 5s ease-in-out infinite;
        }
        @keyframes gacha-card-glow {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.7; }
          50% { transform: translate(20px, 30px) scale(1.15); opacity: 1; }
        }

        .gacha-page .gacha-card .card-stars span {
          position: absolute;
          color: rgba(255, 255, 255, 0.85);
          animation: gacha-twinkle 2.4s ease-in-out infinite;
        }
        @keyframes gacha-twinkle {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.4); }
        }

        .gacha-page .card-inner {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          padding: 28px;
          z-index: 2;
        }
        .gacha-page .card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          color: rgba(255, 255, 255, 0.85);
        }
        .gacha-page .card-rune {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.25);
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 1.5px;
          backdrop-filter: blur(8px);
          color: #fde047;
        }
        .gacha-page .card-corner { font-size: 18px; color: rgba(255, 255, 255, 0.55); }

        .gacha-page .card-emblem {
          position: relative;
          width: 158px;
          height: 158px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.95);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow:
            0 20px 50px rgba(0, 0, 0, 0.35),
            inset 0 -8px 16px rgba(96, 165, 250, 0.28);
        }
        .gacha-page .card-emblem::before {
          content: '';
          position: absolute;
          inset: -16px;
          border-radius: 50%;
          border: 2px solid rgba(255, 255, 255, 0.3);
          animation: gacha-ring 2.6s ease-in-out infinite;
        }
        .gacha-page .card-emblem::after {
          content: '';
          position: absolute;
          inset: -36px;
          border-radius: 50%;
          border: 1px solid rgba(255, 255, 255, 0.18);
          animation: gacha-ring 2.6s ease-in-out infinite 0.6s;
        }
        @keyframes gacha-ring {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.4; }
        }
        .gacha-page .emblem-star {
          color: #2563eb;
          filter: drop-shadow(0 4px 8px rgba(59, 130, 246, 0.5));
          animation: gacha-star-spin 6s ease-in-out infinite;
          display: flex;
        }
        @keyframes gacha-star-spin {
          0%, 100% { transform: rotate(-6deg) scale(1); }
          50% { transform: rotate(6deg) scale(1.05); }
        }

        .gacha-page .card-bottom { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; }
        .gacha-page .card-tap {
          font-size: 24px;
          font-weight: 900;
          letter-spacing: 4px;
          background: linear-gradient(135deg, #fde047, #fb923c);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          text-shadow: 0 0 30px rgba(251, 191, 36, 0.45);
          animation: gacha-tap 1.6s ease-in-out infinite;
        }
        @keyframes gacha-tap {
          0%, 100% { opacity: 1; transform: translateY(0); }
          50% { opacity: 0.55; transform: translateY(-2px); }
        }
        .gacha-page .card-hint { font-size: 11px; color: rgba(255, 255, 255, 0.55); font-weight: 600; letter-spacing: 2px; }

        /* === 操作按钮 === */
        .gacha-page .action-bar { display: flex; gap: 16px; margin-top: 16px; position: relative; z-index: 3; }
        .gacha-page .draw-btn {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 12px;
          padding: 16px 30px 16px 18px;
          border-radius: 999px;
          border: none;
          cursor: pointer;
          font-size: 16px;
          font-weight: 900;
          color: #fff;
          letter-spacing: 1px;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          min-width: 180px;
          justify-content: center;
        }
        .gacha-page .draw-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .gacha-page .draw-btn .shine {
          position: absolute;
          inset: 0;
          border-radius: inherit;
          overflow: hidden;
          pointer-events: none;
        }
        .gacha-page .draw-btn .shine::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
          transform: translateX(-100%);
          transition: transform 0.7s;
        }
        .gacha-page .draw-btn:hover:not(:disabled) .shine::before { transform: translateX(100%); }
        .gacha-page .draw-btn .ico {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.22);
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(8px);
          flex-shrink: 0;
        }
        .gacha-page .draw-btn .cost {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 9px;
          background: rgba(255, 255, 255, 0.22);
          border-radius: 999px;
          font-size: 11.5px;
          font-weight: 800;
          backdrop-filter: blur(8px);
          margin-left: 4px;
        }
        .gacha-page .draw-btn:hover:not(:disabled) { transform: translateY(-3px); }
        .gacha-page .draw-btn:active:not(:disabled) { transform: translateY(-1px) scale(0.98); }
        .gacha-page .draw-btn.single { background: var(--grad-violet); box-shadow: 0 14px 28px rgba(59, 130, 246, 0.45); }
        .gacha-page .draw-btn.single:hover:not(:disabled) { box-shadow: 0 18px 36px rgba(59, 130, 246, 0.55); }
        .gacha-page .draw-btn.multi { background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #ea580c 100%); box-shadow: 0 14px 28px rgba(245, 158, 11, 0.45); }
        .gacha-page .draw-btn.multi:hover:not(:disabled) { box-shadow: 0 18px 36px rgba(245, 158, 11, 0.55); }
        .gacha-page .draw-btn.multi::after {
          content: '必出 R+';
          position: absolute;
          top: -12px;
          right: -14px;
          padding: 4px 11px;
          background: linear-gradient(135deg, #f43f5e, #ec4899);
          color: #fff;
          font-size: 10.5px;
          font-weight: 900;
          border-radius: 999px;
          letter-spacing: 1px;
          white-space: nowrap;
          box-shadow: 0 6px 14px rgba(244, 63, 94, 0.5);
          transform: rotate(8deg);
          border: 2px solid #fff;
          z-index: 2;
        }

        /* === 抽卡结果弹层 === */
        .reveal-overlay {
          position: fixed;
          inset: 0;
          background: radial-gradient(circle at 50% 50%, rgba(124, 58, 237, 0.4) 0%, rgba(30, 27, 75, 0.85) 40%, rgba(15, 23, 42, 0.97) 100%);
          backdrop-filter: blur(24px);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 30px;
          z-index: 200;
          overflow: hidden;
          padding: 24px;
          animation: gacha-overlay-in 0.4s ease;
        }
        @keyframes gacha-overlay-in { from { opacity: 0; } to { opacity: 1; } }

        .reveal-overlay.has-ssr::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at center, rgba(254, 240, 138, 0.85), rgba(251, 146, 60, 0.4) 30%, transparent 65%);
          animation: gacha-ssr-flash 1.2s ease-out;
          pointer-events: none;
          z-index: 1;
        }
        @keyframes gacha-ssr-flash {
          0% { opacity: 0; transform: scale(0.3); }
          30% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.4); }
        }

        .reveal-burst {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 600px;
          height: 600px;
          margin: -300px 0 0 -300px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(96, 165, 250, 0.4), transparent 60%);
          filter: blur(20px);
          animation: gacha-burst 4s ease-in-out infinite;
          pointer-events: none;
          z-index: 1;
        }
        @keyframes gacha-burst {
          0%, 100% { transform: scale(1); opacity: 0.7; }
          50% { transform: scale(1.2); opacity: 1; }
        }

        .reveal-cards {
          position: relative;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
          max-width: 95vw;
          z-index: 3;
        }

        .r-card {
          --rot: 0deg;
          --glow: rgba(96, 165, 250, 0.55);
          position: relative;
          width: 156px;
          aspect-ratio: 5 / 7;
          perspective: 1200px;
          transform: rotate(var(--rot, 0deg));
          animation: gacha-drop-in 0.85s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }
        @keyframes gacha-drop-in {
          0% { opacity: 0; transform: translateY(-180px) rotate(-30deg) scale(0.6); }
          55% { opacity: 1; transform: translateY(14px) rotate(8deg) scale(1.04); }
          80% { transform: translateY(-6px) rotate(-2deg) scale(1); }
          100% { opacity: 1; transform: translateY(0) rotate(var(--rot, 0deg)) scale(1); }
        }

        .r-card-inner {
          position: relative;
          width: 100%;
          height: 100%;
          transform-style: preserve-3d;
          transition: transform 0.9s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .r-card.flipped .r-card-inner { transform: rotateY(180deg); }

        .r-card-back, .r-card-front {
          position: absolute;
          inset: 0;
          border-radius: 18px;
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          box-shadow: 0 18px 36px rgba(0, 0, 0, 0.45);
        }

        .r-card-back {
          background: linear-gradient(135deg, #0c1e4d 0%, #1e3a8a 35%, #2563eb 70%, #6366f1 100%);
          border: 1.5px solid rgba(255, 255, 255, 0.18);
          color: #fde047;
        }
        .r-card-back::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image: radial-gradient(rgba(255, 255, 255, 0.18) 1px, transparent 1px);
          background-size: 14px 14px;
          opacity: 0.7;
        }
        .r-card-back::after {
          content: '';
          position: absolute;
          top: -25%;
          left: -25%;
          width: 70%;
          height: 70%;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(251, 191, 36, 0.4), transparent 60%);
          filter: blur(30px);
        }
        .r-card-back .back-mark {
          position: relative;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.95);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #1e3a8a;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
          z-index: 1;
        }
        .r-card-back .back-rune {
          position: relative;
          margin-top: 14px;
          font-size: 9px;
          font-weight: 900;
          letter-spacing: 3px;
          color: rgba(253, 224, 71, 0.85);
          z-index: 1;
        }

        .r-card-front {
          transform: rotateY(180deg);
          justify-content: space-between;
          padding: 12px 10px;
          color: #fff;
        }
        .r-card-front::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image: radial-gradient(rgba(255, 255, 255, 0.12) 1px, transparent 1px);
          background-size: 12px 12px;
          pointer-events: none;
        }
        .r-card-front::after {
          content: '';
          position: absolute;
          top: -30%;
          right: -30%;
          width: 90%;
          height: 90%;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255, 255, 255, 0.4), transparent 65%);
          filter: blur(25px);
          pointer-events: none;
        }

        .r-card-front .r-image {
          position: relative;
          width: 78%;
          aspect-ratio: 1;
          border-radius: 14px;
          overflow: hidden;
          background: rgba(0, 0, 0, 0.18);
          border: 2px solid rgba(255, 255, 255, 0.4);
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
          z-index: 2;
        }

        /* 五档稀有度配色 */
        .r-card.r-mythic { --glow: rgba(244, 114, 182, 0.85); }
        .r-card.r-mythic .r-card-front {
          background: linear-gradient(160deg, #fbcfe8 0%, #ec4899 50%, #9d174d 100%);
          border: 1.5px solid rgba(251, 207, 232, 0.7);
        }
        .r-card.r-ssr { --glow: rgba(251, 191, 36, 0.85); }
        .r-card.r-ssr .r-card-front {
          background: linear-gradient(160deg, #fde047 0%, #f97316 50%, #c2410c 100%);
          border: 1.5px solid rgba(254, 240, 138, 0.7);
        }
        .r-card.r-sr { --glow: rgba(167, 139, 250, 0.7); }
        .r-card.r-sr .r-card-front {
          background: linear-gradient(160deg, #c4b5fd 0%, #8b5cf6 50%, #5b21b6 100%);
          border: 1.5px solid rgba(196, 181, 253, 0.7);
        }
        .r-card.r-r { --glow: rgba(96, 165, 250, 0.6); }
        .r-card.r-r .r-card-front {
          background: linear-gradient(160deg, #93c5fd 0%, #3b82f6 60%, #1e40af 100%);
          border: 1.5px solid rgba(147, 197, 253, 0.6);
        }
        .r-card.r-n { --glow: rgba(148, 163, 184, 0.4); }
        .r-card.r-n .r-card-front {
          background: linear-gradient(160deg, #cbd5e1 0%, #64748b 60%, #334155 100%);
          border: 1.5px solid rgba(203, 213, 225, 0.5);
        }

        .r-card.flipped { animation: gacha-card-settle 0.6s ease-out 0.3s both; }
        @keyframes gacha-card-settle {
          0% { filter: drop-shadow(0 0 0 transparent); }
          50% { filter: drop-shadow(0 0 30px var(--glow)) drop-shadow(0 0 60px var(--glow)); }
          100% { filter: drop-shadow(0 0 18px var(--glow)); }
        }

        .r-card.r-mythic .r-card-front .gleam,
        .r-card.r-ssr .r-card-front .gleam,
        .r-card.r-sr .r-card-front .gleam {
          position: absolute;
          inset: 0;
          background: linear-gradient(115deg, transparent 30%, rgba(255, 255, 255, 0.55) 50%, transparent 70%);
          transform: translateX(-110%);
          pointer-events: none;
          z-index: 3;
        }
        .r-card.flipped.r-mythic .r-card-front .gleam,
        .r-card.flipped.r-ssr .r-card-front .gleam,
        .r-card.flipped.r-sr .r-card-front .gleam {
          animation: gacha-gleam 1.4s ease-out 0.6s;
        }
        @keyframes gacha-gleam {
          0% { transform: translateX(-110%); }
          100% { transform: translateX(110%); }
        }

        .r-card.r-mythic::before,
        .r-card.r-ssr::before {
          content: '';
          position: absolute;
          inset: -10px;
          border-radius: 22px;
          background: conic-gradient(from 0deg, transparent, #fde047, transparent 30%, transparent 50%, #fb923c, transparent 80%);
          opacity: 0;
          z-index: -1;
          filter: blur(8px);
        }
        .r-card.flipped.r-mythic::before,
        .r-card.flipped.r-ssr::before {
          animation: gacha-halo-spin 3s linear infinite, gacha-halo-fade 0.8s ease 0.4s forwards;
        }
        @keyframes gacha-halo-spin { to { transform: rotate(360deg); } }
        @keyframes gacha-halo-fade { to { opacity: 1; } }

        .r-card-front .rarity-tag {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 10px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.25);
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 2px;
          backdrop-filter: blur(6px);
          position: relative;
          z-index: 2;
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.35);
        }
        .r-card-front .r-name {
          font-size: 13px;
          font-weight: 900;
          letter-spacing: 1px;
          text-align: center;
          position: relative;
          z-index: 2;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
          color: #fff;
          padding: 0 6px;
          max-width: 100%;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .r-card-front .r-tag-bottom {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 10px;
          border-radius: 999px;
          font-size: 10.5px;
          font-weight: 900;
          letter-spacing: 1px;
          position: relative;
          z-index: 2;
          color: #fff;
          backdrop-filter: blur(6px);
          border: 1px solid rgba(255, 255, 255, 0.3);
        }
        .r-card-front .r-tag-bottom.new { background: rgba(0, 0, 0, 0.25); }
        .r-card-front .r-tag-bottom.dup { background: rgba(255, 255, 255, 0.92); color: #1e293b; }

        .reveal-tip {
          position: relative;
          z-index: 3;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 22px;
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid rgba(255, 255, 255, 0.22);
          border-radius: 999px;
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 1px;
          backdrop-filter: blur(10px);
          animation: gacha-tip-blink 1.6s ease-in-out infinite;
        }
        @keyframes gacha-tip-blink { 50% { opacity: 0.55; } }

        .reveal-controls {
          display: flex;
          gap: 14px;
          position: relative;
          z-index: 3;
          opacity: 0;
          transform: translateY(20px);
          transition: all 0.5s ease;
        }
        .reveal-controls.show { opacity: 1; transform: translateY(0); }
        .reveal-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 12px 26px;
          border-radius: 999px;
          border: none;
          cursor: pointer;
          font-family: inherit;
          font-size: 14px;
          font-weight: 900;
          letter-spacing: 1px;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .reveal-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .reveal-btn.again {
          background: linear-gradient(135deg, #93c5fd, #3b82f6 50%, #1d4ed8);
          color: #fff;
          box-shadow: 0 14px 28px rgba(59, 130, 246, 0.45);
        }
        .reveal-btn.again:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 18px 36px rgba(59, 130, 246, 0.55); }
        .reveal-btn.again .cost {
          padding: 2px 8px;
          background: rgba(255, 255, 255, 0.22);
          border-radius: 999px;
          font-size: 11px;
          margin-left: 4px;
        }
        .reveal-btn.confirm { background: rgba(255, 255, 255, 0.95); color: #1e293b; }
        .reveal-btn.confirm:hover:not(:disabled) { transform: translateY(-2px); background: #fff; }

        /* === 抽卡规则弹窗 === */
        .rules-modal-mask {
          position: fixed;
          inset: 0;
          z-index: 210;
          background:
            radial-gradient(circle at 50% 46%, rgba(96, 165, 250, 0.4) 0%, rgba(67, 56, 202, 0.55) 42%, rgba(15, 23, 42, 0.86) 100%);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 22px;
          animation: rules-fade-in 0.2s ease;
        }
        @keyframes rules-fade-in { from { opacity: 0; } to { opacity: 1; } }

        .draw-rules-modal {
          width: min(760px, 100%);
          max-height: min(86vh, 760px);
          border-radius: 28px;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(239, 246, 255, 0.9)),
            radial-gradient(circle at 18% 0%, rgba(191, 219, 254, 0.75), transparent 38%),
            radial-gradient(circle at 100% 16%, rgba(221, 214, 254, 0.7), transparent 40%);
          border: 1px solid rgba(255, 255, 255, 0.92);
          box-shadow: 0 30px 70px rgba(15, 23, 42, 0.28), inset 0 1px 0 rgba(255, 255, 255, 1);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          animation: rules-pop 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes rules-pop {
          from { opacity: 0; transform: translateY(18px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .draw-rules-modal .dr-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 22px 26px;
          border-bottom: 1px solid rgba(59, 130, 246, 0.1);
        }
        .draw-rules-modal .dr-title {
          display: flex;
          align-items: center;
          gap: 14px;
          min-width: 0;
        }
        .draw-rules-modal .dr-title-icon {
          width: 46px;
          height: 46px;
          border-radius: 16px;
          background: var(--grad-violet);
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-shadow: 0 14px 26px rgba(59, 130, 246, 0.34);
        }
        .draw-rules-modal .dr-title h3 {
          margin: 0;
          font-size: 20px;
          font-weight: 900;
          color: var(--text-main);
          letter-spacing: -0.4px;
        }
        .draw-rules-modal .dr-title p {
          margin: 3px 0 0;
          font-size: 12px;
          color: var(--text-light);
          font-weight: 600;
        }
        .draw-rules-modal .dr-close {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: none;
          background: rgba(15, 23, 42, 0.06);
          color: var(--text-light);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
          flex-shrink: 0;
        }
        .draw-rules-modal .dr-close:hover {
          background: rgba(59, 130, 246, 0.12);
          color: #1d4ed8;
          transform: rotate(90deg);
        }

        .draw-rules-modal .dr-body {
          padding: 22px 26px 26px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .draw-rules-modal .dr-card {
          padding: 16px 18px;
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.72);
          border: 1px solid rgba(219, 234, 254, 0.92);
          box-shadow: 0 12px 24px rgba(30, 64, 175, 0.06);
        }
        .draw-rules-modal .dr-card.accent {
          background: linear-gradient(135deg, rgba(219, 234, 254, 0.82), rgba(243, 232, 255, 0.72));
          border-color: rgba(147, 197, 253, 0.55);
        }
        .draw-rules-modal h4 {
          margin: 0 0 8px;
          font-size: 14px;
          font-weight: 900;
          color: var(--text-main);
        }
        .draw-rules-modal p {
          margin: 0;
          font-size: 13px;
          line-height: 1.75;
          color: var(--text-light);
          font-weight: 600;
        }
        .draw-rules-modal .dr-rule-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        .draw-rules-modal .dr-rate-grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 10px;
        }
        .draw-rules-modal .dr-rate {
          min-height: 72px;
          padding: 12px 10px;
          border-radius: 16px;
          background: rgba(255, 255, 255, 0.78);
          border: 1px solid rgba(226, 232, 240, 0.9);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 8px;
        }
        .draw-rules-modal .dr-rate-name {
          font-size: 11px;
          color: var(--text-light);
          font-weight: 800;
          white-space: nowrap;
        }
        .draw-rules-modal .dr-rate strong {
          font-size: 18px;
          font-weight: 900;
          letter-spacing: -0.4px;
          color: var(--text-main);
        }
        .draw-rules-modal .dr-rate.t-mythic strong { background: var(--grad-pink); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .draw-rules-modal .dr-rate.t-ssr strong { background: var(--grad-gold); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .draw-rules-modal .dr-rate.t-sr strong { background: var(--grad-rarity-sr); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .draw-rules-modal .dr-rate.t-r strong { color: #2563eb; }
        .draw-rules-modal .dr-rate.t-n strong { color: #64748b; }

        @media (max-width: 620px) {
          .rules-modal-mask { padding: 12px; }
          .draw-rules-modal { border-radius: 22px; max-height: 88vh; }
          .draw-rules-modal .dr-header { padding: 18px; }
          .draw-rules-modal .dr-title-icon { width: 40px; height: 40px; border-radius: 14px; }
          .draw-rules-modal .dr-title h3 { font-size: 17px; }
          .draw-rules-modal .dr-body { padding: 16px; }
          .draw-rules-modal .dr-rule-grid { grid-template-columns: 1fr; }
          .draw-rules-modal .dr-rate-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }

        /* === 抽卡记录弹窗 === */
        .records-modal-mask {
          position: fixed;
          inset: 0;
          z-index: 210;
          background:
            radial-gradient(circle at 50% 50%, rgba(124, 58, 237, 0.45) 0%, rgba(30, 27, 75, 0.78) 45%, rgba(15, 23, 42, 0.92) 100%);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          animation: rm-mask-in 0.25s ease;
        }
        @keyframes rm-mask-in { from { opacity: 0; } to { opacity: 1; } }

        .records-modal {
          width: min(560px, 100%);
          max-height: min(82vh, 760px);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(245, 243, 255, 0.94));
          border: 1px solid rgba(255, 255, 255, 0.95);
          border-radius: 28px;
          box-shadow: 0 30px 60px rgba(30, 64, 175, 0.45), inset 0 1px 0 rgba(255, 255, 255, 1);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          position: relative;
          animation: rm-pop 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes rm-pop {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .records-modal::before {
          content: '';
          position: absolute;
          top: -40%;
          right: -20%;
          width: 360px;
          height: 360px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(96, 165, 250, 0.28), transparent 60%);
          filter: blur(40px);
          pointer-events: none;
        }

        .records-modal .rm-header {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 22px 24px;
          border-bottom: 1px solid rgba(59, 130, 246, 0.12);
          background: linear-gradient(135deg, rgba(243, 232, 255, 0.6), rgba(224, 231, 255, 0.4));
          flex-shrink: 0;
          position: relative;
          z-index: 1;
        }
        .records-modal .rm-title {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
          min-width: 0;
        }
        .records-modal .rm-title-icon {
          width: 42px;
          height: 42px;
          border-radius: 13px;
          background: linear-gradient(135deg, #60a5fa, #2563eb);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 16px rgba(59, 130, 246, 0.35);
          flex-shrink: 0;
        }
        .records-modal .rm-title h3 {
          font-size: 18px;
          font-weight: 900;
          color: #0f172a;
          margin: 0;
          letter-spacing: -0.4px;
        }
        .records-modal .rm-title p {
          font-size: 12px;
          color: #64748b;
          margin: 2px 0 0;
          font-weight: 500;
        }
        .records-modal .rm-count {
          font-size: 12px;
          font-weight: 800;
          padding: 5px 12px;
          border-radius: 999px;
          background: rgba(59, 130, 246, 0.12);
          color: #1e3a8a;
          flex-shrink: 0;
        }
        .records-modal .rm-count-num { font-size: 14px; }
        .records-modal .rm-count-total { color: rgba(59, 130, 246, 0.55); }
        .records-modal .rm-close {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: rgba(15, 23, 42, 0.05);
          border: none;
          color: #64748b;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          flex-shrink: 0;
        }
        .records-modal .rm-close:hover {
          background: rgba(59, 130, 246, 0.18);
          color: #1e3a8a;
          transform: rotate(90deg);
        }

        .records-modal .rm-body {
          padding: 14px 18px 22px;
          overflow-y: auto;
          flex: 1;
          position: relative;
          z-index: 1;
        }
        .records-modal .rm-body::-webkit-scrollbar { width: 6px; }
        .records-modal .rm-body::-webkit-scrollbar-thumb {
          background: rgba(59, 130, 246, 0.3);
          border-radius: 6px;
        }

        .records-modal .rm-empty {
          padding: 60px 20px;
          text-align: center;
          color: #94a3b8;
        }
        .records-modal .rm-empty-icon {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.22), rgba(96, 165, 250, 0.15));
          color: #3b82f6;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 16px;
        }
        .records-modal .rm-empty-text {
          font-size: 15px;
          font-weight: 800;
          color: #475569;
          margin-bottom: 6px;
        }
        .records-modal .rm-empty-sub {
          font-size: 12.5px;
          color: #94a3b8;
        }

        .records-modal .rm-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .records-modal .rm-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.85);
          border: 1px solid rgba(59, 130, 246, 0.15);
          border-radius: 16px;
          transition: all 0.25s ease;
        }
        .records-modal .rm-item:hover {
          background: #fff;
          transform: translateX(3px);
          box-shadow: 0 12px 24px rgba(30, 64, 175, 0.12);
          border-color: rgba(59, 130, 246, 0.3);
        }

        .records-modal .rm-index {
          font-size: 11px;
          font-weight: 900;
          color: rgba(59, 130, 246, 0.55);
          letter-spacing: 0.5px;
          min-width: 26px;
          text-align: center;
          flex-shrink: 0;
        }

        .records-modal .rm-thumb {
          position: relative;
          width: 52px;
          height: 64px;
          border-radius: 9px;
          overflow: hidden;
          background: #eff6ff;
          border: 2px solid #fff;
          box-shadow: 0 4px 8px rgba(15, 23, 42, 0.08);
          flex-shrink: 0;
        }
        .records-modal .rm-r-mythic .rm-thumb { border-color: #fbcfe8; box-shadow: 0 4px 12px rgba(236, 72, 153, 0.32); }
        .records-modal .rm-r-ssr .rm-thumb { border-color: #fde68a; box-shadow: 0 4px 12px rgba(251, 191, 36, 0.3); }
        .records-modal .rm-r-sr .rm-thumb { border-color: #ddd6fe; box-shadow: 0 4px 10px rgba(140, 90, 245, 0.24); }
        .records-modal .rm-r-r .rm-thumb { border-color: #bfdbfe; box-shadow: 0 4px 10px rgba(59, 130, 246, 0.2); }
        .records-modal .rm-r-n .rm-thumb { border-color: #e2e8f0; }

        .records-modal .rm-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .records-modal .rm-info-top {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .records-modal .rm-name {
          font-size: 14px;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: -0.2px;
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .records-modal .rm-rarity {
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 1px;
          padding: 2px 8px;
          border-radius: 999px;
          flex-shrink: 0;
          color: #fff;
        }
        .records-modal .rm-rarity.rm-r-mythic { background: var(--grad-pink); }
        .records-modal .rm-rarity.rm-r-ssr { background: var(--grad-gold); }
        .records-modal .rm-rarity.rm-r-sr { background: var(--grad-rarity-sr); }
        .records-modal .rm-rarity.rm-r-r { background: linear-gradient(135deg, #60a5fa, #3b82f6); }
        .records-modal .rm-rarity.rm-r-n { background: linear-gradient(135deg, #94a3b8, #64748b); }

        .records-modal .rm-info-bottom {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11.5px;
          color: #64748b;
          font-weight: 600;
        }
        .records-modal .rm-time {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .records-modal .rm-time-exact {
          font-weight: 800;
          color: #475569;
          letter-spacing: 0.2px;
        }
        .records-modal .rm-time-rel {
          padding: 1px 8px;
          background: rgba(59, 130, 246, 0.1);
          color: #1e3a8a;
          border-radius: 999px;
          font-weight: 700;
          font-size: 10.5px;
        }

        .records-modal .rm-tail {
          flex-shrink: 0;
        }
        .records-modal .rm-status {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          font-weight: 800;
          padding: 4px 10px;
          border-radius: 999px;
          letter-spacing: 0.3px;
          white-space: nowrap;
        }
        .records-modal .rm-status.new {
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.18), rgba(99, 102, 241, 0.18));
          color: #1e3a8a;
          border: 1px solid rgba(59, 130, 246, 0.25);
        }
        .records-modal .rm-status.dup {
          background: linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(245, 158, 11, 0.18));
          color: #b45309;
          border: 1px solid rgba(251, 191, 36, 0.3);
        }

        @media (max-width: 560px) {
          .records-modal-mask { padding: 12px; }
          .records-modal { border-radius: 22px; max-height: 88vh; }
          .records-modal .rm-header { padding: 18px 18px; gap: 10px; }
          .records-modal .rm-title h3 { font-size: 16px; }
          .records-modal .rm-title-icon { width: 38px; height: 38px; }
          .records-modal .rm-body { padding: 12px 14px 18px; }
          .records-modal .rm-item { padding: 10px 12px; gap: 10px; }
          .records-modal .rm-index { display: none; }
          .records-modal .rm-thumb { width: 44px; height: 56px; }
          .records-modal .rm-name { font-size: 13px; }
          .records-modal .rm-info-bottom { flex-wrap: wrap; gap: 5px; }
          .records-modal .rm-time-rel { font-size: 10px; }
        }


        /* === 响应式 === */
        @media (max-width: 1080px) {
          .gacha-page .gacha-topbar {
            grid-template-columns: auto 1fr auto;
            padding: 14px 22px;
          }
          .gacha-page .pity-group {
            grid-column: 1 / -1;
            grid-row: 2;
            width: 100%;
            justify-content: center;
            flex-wrap: wrap;
          }
          .gacha-page .gacha-topbar-actions {
            grid-column: 3;
            grid-row: 1;
          }
          .gacha-page .gacha-container { padding: 22px 22px 80px; }
        }

        @media (max-width: 720px) {
          .gacha-page .gacha-topbar {
            grid-template-columns: auto 1fr;
            padding: 12px 14px;
            gap: 10px;
          }
          .gacha-page .gacha-topbar-actions {
            grid-column: 2;
            grid-row: 1;
            justify-self: end;
          }
          .gacha-page .pity-group {
            grid-column: 1 / -1;
            grid-row: 2;
          }
          .gacha-page .exit-btn { padding: 7px 14px 7px 7px; font-size: 12px; }
          .gacha-page .exit-btn .arrow { width: 26px; height: 26px; }
          .gacha-page .gacha-topbar-actions { gap: 6px; }
          .gacha-page .nav-icon-btn { width: 34px; height: 34px; }
          .gacha-page .credits-pill { padding: 6px 6px 6px 14px; font-size: 12px; }
          .gacha-page .credits-pill .star-ico { width: 24px; height: 24px; }
          .gacha-page .credits-pill .num { font-size: 15px; }
          .gacha-page .credits-pill .bolt { width: 26px; height: 26px; }
          .gacha-page .pity-pill { padding: 6px 12px 6px 7px; font-size: 11px; gap: 7px; }
          .gacha-page .pity-pill .crown { width: 22px; height: 22px; }
          .gacha-page .pity-pill .label { font-size: 10.5px; }
          .gacha-page .pity-pill .num { font-size: 12.5px; }

          .gacha-page .pool-banner { padding: 12px 14px; border-radius: 18px; flex-wrap: wrap; gap: 12px; }
          .gacha-page .pool-icon { width: 38px; height: 38px; border-radius: 12px; }
          .gacha-page .pool-info h3 { font-size: 14px; }

          .gacha-page .gacha-card { width: 270px; }
          .gacha-page .stage::before { width: 460px; height: 460px; }
          .gacha-page .stage::after { width: 380px; height: 380px; }

          .gacha-page .action-bar { flex-direction: column; width: 100%; max-width: 320px; gap: 12px; }
          .gacha-page .draw-btn { width: 100%; min-width: auto; padding: 14px 22px 14px 14px; font-size: 15px; }

          .reveal-cards { gap: 8px; }
          .r-card { width: 108px; }
          .r-card-back .back-mark { width: 44px; height: 44px; }
          .r-card-front .r-name { font-size: 11px; }
        }

        @media (max-width: 420px) {
          .gacha-page .gacha-topbar { gap: 8px; }
          .gacha-page .gacha-topbar-actions { gap: 5px; }
          .gacha-page .nav-icon-btn { width: 32px; height: 32px; }
          .gacha-page .credits-pill { gap: 7px; padding-left: 10px; }
          .gacha-page .credits-pill > span:not(.star-ico):not(.num):not(.bolt) { display: none; }
          .gacha-page .pity-group { gap: 6px; }
          .gacha-page .pity-pill .label { display: none; }
          .gacha-page .pity-pill { padding: 5px 10px 5px 5px; }
          .gacha-page .gacha-card { width: 240px; border-radius: 24px; }
          .gacha-page .card-emblem { width: 130px; height: 130px; }
          .gacha-page .card-tap { font-size: 20px; letter-spacing: 3px; }
          .r-card { width: 88px; }
          .reveal-tip { font-size: 11px; padding: 8px 16px; }
        }

        /* === 手机端重排 v2：参考排行榜/游戏中心 === */
        @media (max-width: 720px) {
          /* 顶栏：fixed 全宽磨砂，不随页面滚动 */
          .gacha-page .gacha-topbar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 100;
            width: 100%;
            margin: 0;
            padding: 10px 14px;
            padding-top: max(10px, env(safe-area-inset-top));
            gap: 8px;
            grid-template-columns: auto 1fr;
            border: 0;
            border-radius: 0;
            border-bottom: 1px solid rgba(186, 230, 253, 0.7);
            background: rgba(240, 247, 255, 0.88);
            backdrop-filter: blur(24px) saturate(1.6);
            -webkit-backdrop-filter: blur(24px) saturate(1.6);
            box-shadow: 0 8px 20px rgba(37, 99, 235, 0.06);
          }
          .gacha-page .exit-btn {
            padding: 6px 12px 6px 5px;
            font-size: 11.5px;
            letter-spacing: 0.5px;
            gap: 6px;
          }
          .gacha-page .exit-btn .arrow {
            width: 24px;
            height: 24px;
            flex: 0 0 auto;
          }
          .gacha-page .exit-btn .arrow svg { width: 12px; height: 12px; }
          .gacha-page .gacha-topbar-actions {
            grid-column: 2;
            grid-row: 1;
            justify-self: end;
            gap: 6px;
          }
          .gacha-page .nav-icon-btn {
            width: 34px;
            height: 34px;
            border-radius: 12px;
          }
          .gacha-page .nav-icon-btn svg { width: 15px; height: 15px; }
          .gacha-page .pity-group {
            grid-column: 1 / -1;
            grid-row: 2;
            width: 100%;
            gap: 6px;
            flex-wrap: wrap;
            justify-content: center;
          }
          .gacha-page .credits-pill {
            padding: 5px 6px 5px 12px;
            font-size: 11.5px;
            gap: 8px;
          }
          .gacha-page .credits-pill .star-ico {
            width: 22px;
            height: 22px;
          }
          .gacha-page .credits-pill .num { font-size: 14px; }
          .gacha-page .credits-pill .bolt { width: 24px; height: 24px; }
          .gacha-page .pity-pill {
            padding: 5px 11px 5px 6px;
            font-size: 10.5px;
            gap: 6px;
          }
          .gacha-page .pity-pill .crown { width: 20px; height: 20px; }
          .gacha-page .pity-pill .label { font-size: 10px; }
          .gacha-page .pity-pill .num { font-size: 12px; }
        }

        @media (max-width: 640px) {
          .gacha-page .gacha-container {
            padding: max(108px, calc(96px + env(safe-area-inset-top))) 14px max(80px, calc(28px + env(safe-area-inset-bottom)));
            gap: 16px;
          }

          /* 卡池横幅紧凑 */
          .gacha-page .pool-banner {
            padding: 12px 14px;
            border-radius: 18px;
            flex-wrap: wrap;
            gap: 10px;
          }
          .gacha-page .pool-icon { width: 38px; height: 38px; border-radius: 12px; }
          .gacha-page .pool-info h3 { font-size: 14px; }

          /* 抽卡舞台 */
          .gacha-page .gacha-card { width: 260px; }
          .gacha-page .stage::before { width: 420px; height: 420px; }
          .gacha-page .stage::after { width: 340px; height: 340px; }

          /* 抽卡按钮全宽纵向 */
          .gacha-page .action-bar {
            flex-direction: column;
            width: 100%;
            max-width: 100%;
            gap: 10px;
            margin-top: 14px;
          }
          .gacha-page .draw-btn {
            width: 100%;
            min-width: auto;
            padding: 13px 18px 13px 14px;
            font-size: 14px;
            border-radius: 16px;
            gap: 10px;
          }
          .gacha-page .draw-btn .ico { width: 36px; height: 36px; }
          .gacha-page .draw-btn .cost { font-size: 11.5px; }

          /* 揭晓卡片：保留 flex wrap，避免破坏 drop-in 动画，仅缩小卡片尺寸 */
          .reveal-cards {
            gap: 8px;
            max-width: 100vw;
            padding: 0 8px;
          }
          .r-card {
            width: 118px;
          }
          .r-card-back .back-mark { width: 40px; height: 40px; }
          .r-card-front .r-name { font-size: 11px; }
        }

        @media (max-width: 480px) {
          .gacha-page .gacha-topbar {
            padding: 9px 12px;
            padding-top: max(9px, env(safe-area-inset-top));
          }
          .gacha-page .exit-btn { padding: 5px 10px 5px 5px; font-size: 11px; }
          .gacha-page .exit-btn .arrow { width: 22px; height: 22px; }
          .gacha-page .nav-icon-btn { width: 32px; height: 32px; border-radius: 11px; }
          .gacha-page .nav-icon-btn svg { width: 14px; height: 14px; }
          .gacha-page .credits-pill { padding: 5px 5px 5px 10px; font-size: 11px; gap: 7px; }
          .gacha-page .credits-pill .star-ico { width: 20px; height: 20px; }
          .gacha-page .credits-pill .num { font-size: 13px; }
          .gacha-page .credits-pill .bolt { width: 22px; height: 22px; }

          .gacha-page .gacha-container { padding: max(100px, calc(88px + env(safe-area-inset-top))) 12px max(72px, calc(24px + env(safe-area-inset-bottom))); gap: 14px; }

          .gacha-page .pool-banner { padding: 10px 12px; border-radius: 16px; }
          .gacha-page .pool-icon { width: 34px; height: 34px; border-radius: 11px; }
          .gacha-page .pool-info h3 { font-size: 13px; }

          .gacha-page .gacha-card { width: 230px; border-radius: 22px; }
          .gacha-page .card-emblem { width: 120px; height: 120px; }
          .gacha-page .card-tap { font-size: 18px; letter-spacing: 2.5px; }

          .gacha-page .draw-btn { padding: 12px 14px; font-size: 13px; }
          .gacha-page .draw-btn .ico { width: 32px; height: 32px; }

          .reveal-cards { gap: 6px; padding: 0 6px; }
          .r-card { width: 104px; }
          .reveal-tip { font-size: 11px; padding: 7px 14px; }
        }
      `}</style>
    </div>
  );
}
