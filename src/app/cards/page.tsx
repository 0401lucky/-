'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  Album,
  ArrowRight,
  BookOpen,
  ChevronRight,
  CheckCircle2,
  Gift,
  Home,
  Loader2,
  Sparkles,
  Star,
  Trophy,
  X,
} from 'lucide-react';
import { ALBUMS, CARDS, getCardsByAlbum } from '@/lib/cards/config';
import {
  CARD_DRAW_PRICE,
  EXCHANGE_PRICES,
  FRAGMENT_VALUES,
  PITY_THRESHOLDS,
  RARITY_PROBABILITIES,
} from '@/lib/cards/constants';
import type { UserCards } from '@/lib/cards/draw-types';
import type { Rarity } from '@/lib/cards/types';
import type { PublicAchievement } from '@/lib/profile-achievements';

interface AuthMeResponse {
  success: boolean;
  user?: {
    id: number;
    username: string;
    displayName: string;
    isAdmin: boolean;
  };
}

interface ProfileSettingsResponse {
  success: boolean;
  data?: {
    displayName: string | null;
    avatarUrl: string | null;
    equippedAchievement?: PublicAchievement | null;
  };
}

interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
  customDisplayName: string | null;
  customAvatarUrl: string | null;
  equippedAchievement: PublicAchievement | null;
}

interface CardRulesConfig {
  rarityProbabilities: Record<Rarity, number>;
  pityThresholds: Record<'rare' | 'epic' | 'legendary' | 'legendary_rare', number>;
  cardDrawPrice: number;
  fragmentValues: Record<Rarity, number>;
  exchangePrices: Record<Rarity, number>;
}

// 三套卡册的主题色映射，按 album.id 区分视觉风格
const ALBUM_THEME: Record<string, 's1' | 's2' | 'special'> = {
  'animal-s1': 's1',
  'animal-s2': 's2',
  tarot: 'special',
};

// 各主题在卡册封面上的装饰 emoji（左右两条）
const ALBUM_DECO: Record<'s1' | 's2' | 'special', { left: string[]; badge: string }> = {
  s1: { left: ['🌸', '🍃', '🌸'], badge: '🌿' },
  s2: { left: ['❄️', '🌟', '❄️'], badge: '❄️' },
  special: { left: ['🌙', '⭐', '🌙'], badge: '✨' },
};

// 稀有度展示顺序与中文标签（用于规则弹窗）
const RARITY_DISPLAY: Array<{ key: Rarity; label: string; color: string }> = [
  { key: 'legendary_rare', label: '传说稀有', color: '#ec4899' },
  { key: 'legendary', label: '传说', color: '#f59e0b' },
  { key: 'epic', label: '史诗', color: '#8b5cf6' },
  { key: 'rare', label: '稀有', color: '#3b82f6' },
  { key: 'common', label: '普通', color: '#64748b' },
];

export default function CardsAlbumsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [cardData, setCardData] = useState<UserCards | null>(null);
  // 进度条入场动画开关：先渲染 0%，挂载后切到真实百分比
  const [animateProgress, setAnimateProgress] = useState(false);
  // 图鉴规则弹窗显示状态
  const [showRules, setShowRules] = useState(false);
  const [cardRules, setCardRules] = useState<CardRulesConfig | null>(null);
  const displayRules: CardRulesConfig = cardRules ?? {
    rarityProbabilities: RARITY_PROBABILITIES,
    pityThresholds: PITY_THRESHOLDS,
    cardDrawPrice: CARD_DRAW_PRICE,
    fragmentValues: FRAGMENT_VALUES,
    exchangePrices: EXCHANGE_PRICES,
  };

  // ESC 键关闭弹窗
  useEffect(() => {
    if (!showRules) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowRules(false);
    };
    window.addEventListener('keydown', onKey);
    // 弹窗打开时禁用 body 滚动
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [showRules]);

  // ----- 数据加载 -----
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const authRes = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!authRes.ok) {
          router.push('/login?redirect=/cards');
          return;
        }
        const authJson = (await authRes.json()) as AuthMeResponse;
        if (!authJson.success || !authJson.user) {
          router.push('/login?redirect=/cards');
          return;
        }
        if (cancelled) return;

        setUser({
          id: authJson.user.id,
          username: authJson.user.username,
          displayName: authJson.user.displayName,
          isAdmin: authJson.user.isAdmin,
          customDisplayName: null,
          customAvatarUrl: null,
          equippedAchievement: null,
        });
      } catch (err) {
        console.error('Failed to check auth', err);
        if (!cancelled) router.push('/login?redirect=/cards');
        return;
      } finally {
        if (!cancelled) setLoading(false);
      }

      if (cancelled) return;

      // 并行获取库存与自定义资料；任一失败不阻塞页面
      const [inventoryRes, profileRes, rulesRes] = await Promise.allSettled([
        fetch('/api/cards/inventory', { cache: 'no-store' }),
        fetch('/api/profile/settings', { cache: 'no-store' }),
        fetch('/api/cards/rules', { cache: 'no-store' }),
      ]);

      if (cancelled) return;

      if (inventoryRes.status === 'fulfilled' && inventoryRes.value.ok) {
        const json = await inventoryRes.value.json().catch(() => null);
        if (json?.success && json.data) {
          setCardData(json.data as UserCards);
        }
      }

      if (profileRes.status === 'fulfilled' && profileRes.value.ok) {
        const json = (await profileRes.value.json().catch(() => null)) as ProfileSettingsResponse | null;
        if (json?.success && json.data) {
          setUser((prev) =>
            prev
              ? {
                  ...prev,
                  customDisplayName: json.data?.displayName ?? null,
                  customAvatarUrl: json.data?.avatarUrl ?? null,
                  equippedAchievement: json.data?.equippedAchievement ?? null,
                }
              : prev,
          );
        }
      }

      if (rulesRes.status === 'fulfilled' && rulesRes.value.ok) {
        const json = await rulesRes.value.json().catch(() => null);
        if (json?.success && json.data) {
          setCardRules(json.data as CardRulesConfig);
        }
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // 加载完毕后触发进度条动画
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => setAnimateProgress(true), 250);
    return () => clearTimeout(t);
  }, [loading]);

  // ----- 派生数据（全部基于真实数据计算） -----
  const totalCards = useMemo(() => CARDS.length, []);
  const totalReward = useMemo(() => ALBUMS.reduce((sum, a) => sum + a.reward, 0), []);

  const ownedCount = cardData ? cardData.inventory.length : 0;
  const collectionRate = totalCards > 0 ? (ownedCount / totalCards) * 100 : 0;

  const completedCount = useMemo(() => {
    if (!cardData) return 0;
    const inventorySet = new Set(cardData.inventory);
    return ALBUMS.filter((a) => {
      const cards = getCardsByAlbum(a.id);
      return cards.length > 0 && cards.every((c) => inventorySet.has(c.id));
    }).length;
  }, [cardData]);

  const seasonCount = useMemo(() => {
    const seasons = new Set(ALBUMS.map((a) => a.season || a.id));
    return seasons.size;
  }, []);

  // 显示用：未加载完成时主要数字显示 '—'
  const fragmentDisplay = cardData ? cardData.fragments.toLocaleString() : '—';
  const ownedDisplay = cardData ? ownedCount.toLocaleString() : '—';
  const completedDisplay = cardData ? completedCount.toString() : '—';
  const collectionRateDisplay = cardData ? `${collectionRate.toFixed(1)}%` : '—';

  // 用户显示
  const displayName = user?.customDisplayName ?? user?.displayName ?? user?.username ?? '';
  const avatarUrl = user?.customAvatarUrl ?? null;
  const initial = (displayName[0] || '?').toUpperCase();
  const navAchievement = user?.equippedAchievement ?? null;
  const navRoleLabel = user?.isAdmin ? '管理员' : '用户';

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-blue-500" />
        <p className="text-stone-400 font-medium animate-pulse">正在读取卡册...</p>
      </div>
    );
  }

  return (
    <div className="cards-page">
      {/* 蓝色系流动 mesh 背景层（z-index: -1，覆盖项目原本的暖橙背景） */}
      <div className="cards-mesh-bg" aria-hidden />

      {/* === 顶部导航栏 === */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            <Album size={22} strokeWidth={2.4} />
          </div>
          卡牌图鉴
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className="btn-icon rules-trigger"
            onClick={() => setShowRules(true)}
            aria-label="查看图鉴规则"
            title="图鉴规则"
          >
            <BookOpen size={16} strokeWidth={2.4} />
          </button>
          <Link href="/cards/draw" className="btn-icon draw-trigger" aria-label="去抽卡" title="去抽卡">
            <Gift size={16} strokeWidth={2.4} />
          </Link>
          <Link href="/" className="btn-icon" aria-label="返回首页" title="返回首页">
            <Home size={16} strokeWidth={2} />
          </Link>
          <Link href="/profile" className="user-profile" aria-label="查看个人主页">
            <div className="avatar">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt={displayName} className="avatar-img" />
              ) : (
                initial
              )}
            </div>
            <div className="user-info">
              <h4>{displayName || '未登录'}</h4>
              <p className="nav-achievement-line" title={navAchievement?.desc ?? navRoleLabel}>
                {navAchievement ? (
                  <span className="nav-achievement">
                    <span className="nav-achievement-emoji" aria-hidden>{navAchievement.emoji}</span>
                    <span className="nav-achievement-name">{navAchievement.name}</span>
                  </span>
                ) : (
                  <span className="nav-achievement empty">{navRoleLabel}</span>
                )}
              </p>
            </div>
          </Link>
        </div>
      </header>

      <main className="cards-container">
        {/* === Hero 横幅 === */}
        <section className="collection-hero">
          <div className="stars" aria-hidden>
            <span className="star" style={{ top: '12%', left: '8%', fontSize: 13 }}>✦</span>
            <span className="star" style={{ top: '32%', left: '38%', fontSize: 11, animationDelay: '0.8s' }}>✦</span>
            <span className="star" style={{ top: '68%', left: '18%', fontSize: 14, animationDelay: '1.4s' }}>✦</span>
            <span className="star" style={{ top: '78%', left: '50%', fontSize: 10, animationDelay: '0.4s' }}>✦</span>
            <span className="star" style={{ top: '22%', left: '58%', fontSize: 12, animationDelay: '2s' }}>✦</span>
          </div>

          <div className="float-cards" aria-hidden>
            <div className="fc-card fc-1">
              <div className="fc-glow" />
              🐼
            </div>
            <div className="fc-card fc-2">
              <div className="fc-glow" />
              🐶
            </div>
            <div className="fc-card fc-3">
              <div className="fc-glow" />
              🔮
            </div>
          </div>

          <div className="hero-content">
            <div className="hero-badge">
              <Star size={12} fill="currentColor" strokeWidth={0} />
              LUCKY 卡牌图鉴
            </div>
            <h1 className="hero-title">
              我的<span className="glow">卡册收藏</span>
            </h1>
            <p className="hero-sub">
              探索各种主题卡册，收集卡牌解锁专属奖励。每套卡册都有独特的故事等你发现，开启属于您的收藏之旅。
            </p>

            <div className="fragment-card">
              <div className="fragment-icon">
                <Sparkles size={22} fill="currentColor" strokeWidth={0} />
              </div>
              <div className="fragment-info">
                <div className="fragment-label">我的碎片</div>
                <div className="fragment-value">
                  {fragmentDisplay}
                  <span className="unit">片</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* === 页头 === */}
        <div className="page-header">
          <div className="header-left">
            <h2 className="section-title">
              <span className="title-icon">
                <BookOpen size={22} strokeWidth={2.4} />
              </span>
              全部卡册
            </h2>
            <p className="header-subtitle">收集所有卡牌即可解锁完成奖励，每套卡册都包含独特的故事和精美插画。</p>
          </div>
        </div>

        {/* === 数据概览 === */}
        <section className="stats-grid">
          <div className="stat-card t-purple">
            <div className="stat-head">
              <div className="stat-icon">
                <BookOpen size={18} strokeWidth={2.4} />
              </div>
              <div className="stat-label">卡册总数</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{ALBUMS.length}</span>
              <span className="stat-unit">套主题</span>
            </div>
            <div className="stat-trend purple">
              <Sparkles size={11} strokeWidth={2.4} />共 {seasonCount} 个季度
            </div>
          </div>

          <div className="stat-card t-blue">
            <div className="stat-head">
              <div className="stat-icon">
                <CheckCircle2 size={18} strokeWidth={2.4} />
              </div>
              <div className="stat-label">已收集</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{ownedDisplay}</span>
              <span className="stat-unit">/ {totalCards} 张</span>
            </div>
            <div className="stat-trend flat">
              <ArrowRight size={11} strokeWidth={3} />收集率 {collectionRateDisplay}
            </div>
          </div>

          <div className="stat-card t-amber">
            <div className="stat-head">
              <div className="stat-icon">
                <Star size={18} fill="currentColor" strokeWidth={0} />
              </div>
              <div className="stat-label">可获得积分</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{totalReward.toLocaleString()}</span>
              <span className="stat-unit">积分</span>
            </div>
            <div className="stat-trend amber">
              <Sparkles size={11} strokeWidth={2.4} />集齐解锁
            </div>
          </div>

          <div className="stat-card t-pink">
            <div className="stat-head">
              <div className="stat-icon">
                <Trophy size={18} strokeWidth={2.4} />
              </div>
              <div className="stat-label">已完成卡册</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{completedDisplay}</span>
              <span className="stat-unit">/ {ALBUMS.length} 套</span>
            </div>
            <div className="stat-trend up">
              <ArrowRight size={11} strokeWidth={3} />
              {cardData
                ? completedCount > 0
                  ? `已完成 ${completedCount} 套`
                  : '继续收集'
                : '加载中...'}
            </div>
          </div>
        </section>

        {/* === 卡册网格 === */}
        <section className="albums-grid">
          {ALBUMS.map((album, index) => {
            const theme = ALBUM_THEME[album.id] ?? 's1';
            const deco = ALBUM_DECO[theme];
            const cards = getCardsByAlbum(album.id);
            const total = cards.length;
            const owned = cardData
              ? cards.filter((c) => cardData.inventory.includes(c.id)).length
              : 0;
            const percent = total > 0 ? Math.round((owned / total) * 100) : 0;
            const isComplete = total > 0 && owned === total;

            return (
              <Link
                key={album.id}
                href={`/cards/${album.id}`}
                className={`album-card ${theme} ${isComplete ? 'completed' : ''}`}
              >
                <div className="album-cover">
                  <span className="album-badge">
                    {deco.badge} {album.season ?? '系列'}
                  </span>
                  <span className={`album-progress-badge ${owned > 0 ? 'has-progress' : ''}`}>
                    {cardData ? `${owned} / ${total}` : `— / ${total}`}
                  </span>
                  <div className="cover-deco left" aria-hidden>
                    {deco.left.map((emoji, i) => (
                      <span key={`l-${i}`}>{emoji}</span>
                    ))}
                  </div>
                  <div className="cover-deco right" aria-hidden>
                    {deco.left.map((emoji, i) => (
                      <span key={`r-${i}`}>{emoji}</span>
                    ))}
                  </div>
                  <div className="cover-main-image">
                    <Image
                      src={album.coverImage}
                      alt={album.name}
                      width={140}
                      height={140}
                      sizes="140px"
                      priority={index === 0}
                      className="cover-img"
                    />
                  </div>
                </div>
                <div className="album-body">
                  <div className="album-title-row">
                    <h3 className="album-title">{album.name}</h3>
                    <span className="album-arrow">
                      <ChevronRight size={14} strokeWidth={2.5} />
                    </span>
                  </div>
                  <p className="album-desc">{album.description}</p>

                  <div className="album-progress-section">
                    <div className="album-progress-text">
                      <span className="album-progress-label">收集进度</span>
                      <span className="album-progress-num">
                        <span className="got">{cardData ? owned : '—'}</span>{' '}
                        <span className="total">/ {total}</span>
                      </span>
                    </div>
                    <div className="album-progress-track">
                      <div
                        className="album-progress-bar"
                        style={{ width: `${animateProgress ? percent : 0}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="album-reward">
                  <div className="reward-label">
                    <span className="ico">
                      <Star size={13} fill="currentColor" strokeWidth={0} />
                    </span>
                    完成奖励
                  </div>
                  <div className="reward-value">
                    {album.reward.toLocaleString()}
                    <span className="unit">积分</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </section>
      </main>

      {/* === 图鉴规则弹窗 === */}
      {showRules && (
        <div
          className="rules-mask"
          role="dialog"
          aria-modal="true"
          aria-label="图鉴规则"
          onClick={() => setShowRules(false)}
        >
          <div className="rules-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rules-header">
              <div className="rules-title">
                <span className="rules-title-icon">
                  <BookOpen size={20} strokeWidth={2.4} />
                </span>
                <div>
                  <h3>图鉴规则</h3>
                  <p>抽卡概率、保底机制与碎片兑换说明</p>
                </div>
              </div>
              <button
                type="button"
                className="rules-close"
                onClick={() => setShowRules(false)}
                aria-label="关闭"
              >
                <X size={18} strokeWidth={2.4} />
              </button>
            </div>

            <div className="rules-body">
              <section className="rules-section">
                <h4 className="rules-section-title">
                  <span className="dot dot-purple" />
                  抽卡概率
                </h4>
                <p className="rules-section-desc">
                  单次抽卡消耗 <strong>{displayRules.cardDrawPrice.toLocaleString()}</strong> 积分，按下列概率随机产出。
                </p>
                <div className="rules-grid">
                  {RARITY_DISPLAY.map((r) => (
                    <div key={r.key} className="rules-row">
                      <span className="rules-label" style={{ color: r.color }}>
                        ● {r.label}
                      </span>
                      <span className="rules-value">{displayRules.rarityProbabilities[r.key]}%</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rules-section">
                <h4 className="rules-section-title">
                  <span className="dot dot-amber" />
                  保底机制
                </h4>
                <p className="rules-section-desc">连续抽卡未出对应稀有度时，达到阈值必出。</p>
                <div className="rules-grid">
                  <div className="rules-row">
                    <span className="rules-label">稀有保底</span>
                    <span className="rules-value">每 {displayRules.pityThresholds.rare} 抽必出</span>
                  </div>
                  <div className="rules-row">
                    <span className="rules-label">史诗保底</span>
                    <span className="rules-value">每 {displayRules.pityThresholds.epic} 抽必出</span>
                  </div>
                  <div className="rules-row">
                    <span className="rules-label">传说保底</span>
                    <span className="rules-value">每 {displayRules.pityThresholds.legendary} 抽必出</span>
                  </div>
                  <div className="rules-row">
                    <span className="rules-label">传说稀有保底</span>
                    <span className="rules-value">每 {displayRules.pityThresholds.legendary_rare} 抽必出</span>
                  </div>
                </div>
              </section>

              <section className="rules-section">
                <h4 className="rules-section-title">
                  <span className="dot dot-green" />
                  重复卡碎片转换
                </h4>
                <p className="rules-section-desc">抽到已拥有的卡牌会自动转换为对应碎片。</p>
                <div className="rules-grid">
                  {RARITY_DISPLAY.map((r) => (
                    <div key={`f-${r.key}`} className="rules-row">
                      <span className="rules-label" style={{ color: r.color }}>
                        {r.label}
                      </span>
                      <span className="rules-value">+{displayRules.fragmentValues[r.key]} 碎片</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rules-section">
                <h4 className="rules-section-title">
                  <span className="dot dot-pink" />
                  碎片兑换价格
                </h4>
                <p className="rules-section-desc">在卡册详情页可使用碎片兑换指定稀有度的随机卡牌。</p>
                <div className="rules-grid">
                  {RARITY_DISPLAY.map((r) => (
                    <div key={`e-${r.key}`} className="rules-row">
                      <span className="rules-label" style={{ color: r.color }}>
                        {r.label}
                      </span>
                      <span className="rules-value">{displayRules.exchangePrices[r.key]} 碎片</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rules-section">
                <h4 className="rules-section-title">
                  <span className="dot dot-blue" />
                  集齐奖励
                </h4>
                <p className="rules-section-desc">完整收集卡册中所有卡牌后可一次性领取丰厚积分奖励。</p>
                <div className="rules-grid">
                  {ALBUMS.map((a) => (
                    <div key={a.id} className="rules-row">
                      <span className="rules-label">{a.name}</span>
                      <span className="rules-value">{a.reward.toLocaleString()} 积分</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {/*
        使用 style jsx global 避免 styled-jsx scope hash 不下沉到 next/link 渲染的 a 标签；
        全部选择器使用 .cards-page 前缀防止污染其他页面。
      */}
      <style jsx global>{`
        .cards-page {
          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
          color: #0f172a;
          min-height: 100vh;
          padding-bottom: 96px;
          position: relative;
          --c-green: #10b981;
          --c-purple: #6366f1;
          --c-orange: #f97316;
          --c-pink: #ec4899;
          --c-blue: #3b82f6;
          --c-sky: #0ea5e9;
          --c-cyan: #06b6d4;
          --c-indigo: #6366f1;
          --c-amber: #fbbf24;
          --grad-primary: linear-gradient(135deg, #3b82f6, #6366f1);
          --grad-gold: linear-gradient(135deg, #fde047, #f59e0b 50%, #ea580c);
          --grad-green: linear-gradient(135deg, #38bdf8, #0ea5e9);
          --grad-blue: linear-gradient(135deg, #60a5fa, #3b82f6);
          --grad-purple: linear-gradient(135deg, #818cf8, #6366f1);
          --grad-amber: linear-gradient(135deg, #fde047, #fbbf24);
          --text-main: #0f172a;
          --text-light: #64748b;
        }

        .cards-page * {
          box-sizing: border-box;
        }

        /* 链接默认样式重置 */
        .cards-page a {
          color: inherit;
          text-decoration: none;
        }

        /* === 蓝色流动 Mesh 背景 === */
        .cards-page .cards-mesh-bg {
          position: fixed;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          background-color: #f0f7ff;
          background-image:
            radial-gradient(circle at 15% 50%, rgba(199, 210, 254, 0.85) 0%, transparent 50%),
            radial-gradient(circle at 85% 30%, rgba(186, 230, 253, 0.85) 0%, transparent 50%),
            radial-gradient(circle at 50% 90%, rgba(165, 243, 252, 0.78) 0%, transparent 50%),
            radial-gradient(circle at 50% 10%, rgba(219, 234, 254, 0.85) 0%, transparent 50%);
          filter: blur(60px);
          animation: cards-fluid 15s infinite alternate ease-in-out;
        }

        @keyframes cards-fluid {
          0% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.05) rotate(2deg); }
          100% { transform: scale(1.1) rotate(-2deg); }
        }

        /* === 顶部导航栏 === */
        .cards-page .topbar {
          position: sticky;
          top: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
          padding: 16px 48px;
          background: rgba(248, 250, 252, 0.65);
          backdrop-filter: blur(24px) saturate(1.6);
          -webkit-backdrop-filter: blur(24px) saturate(1.6);
          border-bottom: 1px solid rgba(255, 255, 255, 0.8);
          padding-top: max(16px, env(safe-area-inset-top));
        }

        .cards-page .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: var(--text-main);
          flex-shrink: 0;
        }

        .cards-page .brand-icon {
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, #3b82f6, #6366f1);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          box-shadow: 0 8px 16px rgba(59, 130, 246, 0.32);
          position: relative;
        }

        .cards-page .brand-icon::after {
          content: '';
          position: absolute;
          inset: -3px;
          border-radius: 15px;
          background: linear-gradient(135deg, #3b82f6, #6366f1);
          opacity: 0.3;
          filter: blur(8px);
          z-index: -1;
        }

        .cards-page .topbar-right {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }

        .cards-page .btn-icon {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.9);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--text-light);
          backdrop-filter: blur(10px);
          transition: all 0.2s;
          flex-shrink: 0;
          cursor: pointer;
          text-decoration: none;
        }

        .cards-page .btn-icon svg {
          width: 16px;
          height: 16px;
        }

        .cards-page .btn-icon:hover {
          background: #fff;
          color: var(--c-blue);
          transform: translateY(-2px);
          box-shadow: 0 8px 16px rgba(0, 0, 0, 0.05);
        }

        .cards-page .rules-trigger,
        .cards-page .draw-trigger {
          color: #1d4ed8;
          background:
            linear-gradient(#fff, #fff) padding-box,
            linear-gradient(135deg, rgba(59, 130, 246, 0.5), rgba(99, 102, 241, 0.45)) border-box;
          border: 1px solid transparent;
        }

        .cards-page .rules-trigger:hover,
        .cards-page .draw-trigger:hover {
          color: #1e40af;
          box-shadow: 0 14px 26px rgba(59, 130, 246, 0.16);
        }

        .cards-page .user-profile {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 5px 16px 5px 5px;
          background: #ffffff;
          border-radius: 999px;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.04);
          cursor: pointer;
          transition: transform 0.2s;
          text-decoration: none;
        }

        .cards-page .user-profile:hover {
          transform: scale(1.02);
        }

        .cards-page .avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #475569;
          font-weight: 800;
          font-size: 14px;
          flex-shrink: 0;
          overflow: hidden;
          text-transform: uppercase;
        }

        .cards-page .avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: inherit;
          display: block;
        }

        .cards-page .user-info h4 {
          font-size: 13px;
          font-weight: 700;
          line-height: 1.2;
          margin: 0;
          color: var(--text-main);
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cards-page .user-info p {
          font-size: 11px;
          color: var(--text-light);
          margin: 1px 0 0;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          max-width: 150px;
        }

        .cards-page .user-info .nav-achievement-line {
          width: 100%;
          min-width: 0;
        }

        .cards-page .nav-achievement {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
          color: #1d4ed8;
          font-weight: 800;
        }

        .cards-page .nav-achievement.empty {
          color: var(--text-light);
          font-weight: 700;
        }

        .cards-page .nav-achievement-emoji {
          flex: 0 0 auto;
          font-size: 11px;
          line-height: 1;
        }

        .cards-page .nav-achievement-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* === 主容器 === */
        .cards-page .cards-container {
          max-width: 1500px;
          margin: 0 auto;
          padding: 28px 48px 96px;
          display: flex;
          flex-direction: column;
          gap: 26px;
        }

        /* === Hero 横幅 === */
        .cards-page .collection-hero {
          position: relative;
          padding: 44px 48px;
          border-radius: 36px;
          background:
            /* 左上角暗化蒙层（保证标题可读） */
            linear-gradient(
              to bottom right,
              rgba(12, 30, 77, 0.72) 0%,
              rgba(12, 30, 77, 0.32) 32%,
              transparent 55%
            ),
            /* 右上角暗化蒙层（保证浮动卡片与碎片卡可读） */
            linear-gradient(
              to bottom left,
              rgba(12, 30, 77, 0.58) 0%,
              rgba(12, 30, 77, 0.22) 30%,
              transparent 55%
            ),
            /* 主图 */
            url('/images-optimized/ui/cards/hero.webp') center 45% / cover no-repeat,
            /* 兜底渐变（图片未加载时呈现原配色） */
            linear-gradient(135deg, #0c1e4d 0%, #1e3a8a 35%, #2563eb 70%, #3b82f6 100%);
          color: #fff;
          overflow: hidden;
          box-shadow: 0 30px 60px rgba(30, 58, 138, 0.4);
        }

        .cards-page .collection-hero::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            radial-gradient(circle at 50% 100%, rgba(99, 102, 241, 0.30), transparent 60%);
          pointer-events: none;
        }

        .cards-page .collection-hero::after {
          content: '';
          position: absolute;
          top: -40%;
          right: -10%;
          width: 480px;
          height: 480px;
          background: radial-gradient(circle, rgba(125, 211, 252, 0.18), transparent 60%);
          filter: blur(60px);
          pointer-events: none;
          animation: cards-glow-pulse 4.5s ease-in-out infinite;
          mix-blend-mode: screen;
        }

        @keyframes cards-glow-pulse {
          0%, 100% { transform: scale(1); opacity: 0.65; }
          50% { transform: scale(1.18); opacity: 1; }
        }

        .cards-page .stars {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
        }
        .cards-page .star {
          position: absolute;
          color: rgba(255, 255, 255, 0.7);
          animation: cards-twinkle 3s ease-in-out infinite;
        }

        @keyframes cards-twinkle {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }

        .cards-page .float-cards {
          position: absolute;
          top: 50%;
          right: 5%;
          transform: translateY(-50%);
          width: 220px;
          height: 200px;
          z-index: 1;
        }

        .cards-page .fc-card {
          position: absolute;
          width: 92px;
          height: 130px;
          border-radius: 14px;
          border: 2.5px solid rgba(255, 255, 255, 0.9);
          box-shadow:
            0 20px 40px rgba(0, 0, 0, 0.45),
            0 0 0 1px rgba(0, 0, 0, 0.15);
          backdrop-filter: blur(12px);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 38px;
        }

        .cards-page .fc-card.fc-1 {
          top: 30px;
          left: 10px;
          background: linear-gradient(135deg, rgba(56, 189, 248, 0.85), rgba(14, 165, 233, 0.7));
          transform: rotate(-12deg);
          animation: cards-float-1 5s ease-in-out infinite;
        }

        .cards-page .fc-card.fc-2 {
          top: 10px;
          left: 70px;
          background: linear-gradient(135deg, rgba(96, 165, 250, 0.85), rgba(59, 130, 246, 0.7));
          transform: rotate(0deg);
          animation: cards-float-2 5s ease-in-out infinite 0.4s;
          z-index: 2;
        }

        .cards-page .fc-card.fc-3 {
          top: 30px;
          left: 130px;
          background: linear-gradient(135deg, rgba(129, 140, 248, 0.85), rgba(99, 102, 241, 0.7));
          transform: rotate(12deg);
          animation: cards-float-3 5s ease-in-out infinite 0.8s;
        }

        @keyframes cards-float-1 {
          0%, 100% { transform: rotate(-12deg) translateY(0); }
          50% { transform: rotate(-15deg) translateY(-8px); }
        }

        @keyframes cards-float-2 {
          0%, 100% { transform: rotate(0deg) translateY(0); }
          50% { transform: rotate(2deg) translateY(-12px); }
        }

        @keyframes cards-float-3 {
          0%, 100% { transform: rotate(12deg) translateY(0); }
          50% { transform: rotate(15deg) translateY(-8px); }
        }

        .cards-page .fc-card .fc-glow {
          position: absolute;
          inset: 6px;
          border-radius: 10px;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.2), transparent);
        }

        .cards-page .hero-content {
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          gap: 16px;
          max-width: 60%;
        }

        .cards-page .hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          background: rgba(125, 211, 252, 0.22);
          border: 1px solid rgba(125, 211, 252, 0.45);
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          color: #bae6fd;
          letter-spacing: 1px;
          backdrop-filter: blur(10px);
          width: fit-content;
        }

        .cards-page .hero-title {
          font-size: 48px;
          font-weight: 900;
          letter-spacing: -1.5px;
          line-height: 1.05;
          margin: 0;
          color: #fff;
          text-shadow: 0 2px 18px rgba(0, 0, 0, 0.55);
        }

        .cards-page .hero-title .glow {
          background: linear-gradient(135deg, #7dd3fc, #38bdf8);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          text-shadow: 0 2px 14px rgba(0, 0, 0, 0.6), 0 0 40px rgba(56, 189, 248, 0.4);
          filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5));
        }

        .cards-page .hero-sub {
          font-size: 15px;
          color: rgba(255, 255, 255, 0.92);
          line-height: 1.6;
          max-width: 540px;
          margin: 0;
          text-shadow: 0 1px 6px rgba(0, 0, 0, 0.45);
        }

        .cards-page .fragment-card {
          margin-top: 8px;
          display: inline-flex;
          align-items: center;
          gap: 16px;
          padding: 14px 22px;
          background: rgba(12, 30, 77, 0.55);
          border: 1px solid rgba(255, 255, 255, 0.32);
          border-radius: 18px;
          backdrop-filter: blur(22px);
          width: fit-content;
          box-shadow: 0 14px 32px rgba(0, 0, 0, 0.35);
        }

        .cards-page .fragment-icon {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: linear-gradient(135deg, #7dd3fc, #38bdf8);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          box-shadow: 0 8px 16px rgba(56, 189, 248, 0.45);
          flex-shrink: 0;
        }

        .cards-page .fragment-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .cards-page .fragment-label {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
        }

        .cards-page .fragment-value {
          font-size: 26px;
          font-weight: 900;
          line-height: 1;
          background: linear-gradient(135deg, #e0f2fe, #7dd3fc);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          letter-spacing: -0.5px;
        }

        .cards-page .fragment-value .unit {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 700;
          margin-left: 4px;
          -webkit-text-fill-color: rgba(255, 255, 255, 0.7);
          background: none;
        }

        /* === 页头 === */
        .cards-page .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 16px;
          flex-wrap: wrap;
        }

        .cards-page .header-left .section-title {
          font-size: 30px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 14px;
          color: var(--text-main);
          margin: 0 0 6px;
          letter-spacing: -0.7px;
        }

        .cards-page .section-title .title-icon {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: linear-gradient(135deg, #3b82f6, #6366f1);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          box-shadow: 0 12px 24px rgba(59, 130, 246, 0.35);
          position: relative;
        }

        .cards-page .section-title .title-icon::after {
          content: '';
          position: absolute;
          inset: -4px;
          border-radius: 18px;
          background: linear-gradient(135deg, #3b82f6, #6366f1);
          opacity: 0.3;
          filter: blur(10px);
          z-index: -1;
        }

        .cards-page .header-subtitle {
          font-size: 14px;
          color: var(--text-light);
          line-height: 1.6;
          max-width: 640px;
          margin: 0;
        }

        /* === 数据概览 === */
        .cards-page .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 18px;
        }

        .cards-page .stat-card {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.55));
          backdrop-filter: blur(30px);
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 24px;
          padding: 22px 24px;
          box-shadow: 0 24px 48px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 1);
          position: relative;
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .cards-page .stat-card::before {
          content: '';
          position: absolute;
          top: -50%;
          right: -30%;
          width: 200px;
          height: 200px;
          border-radius: 50%;
          opacity: 0.3;
          filter: blur(40px);
          transition: opacity 0.3s;
        }

        .cards-page .stat-card.t-purple::before { background: rgba(99, 102, 241, 0.5); }
        .cards-page .stat-card.t-blue::before { background: rgba(59, 130, 246, 0.4); }
        .cards-page .stat-card.t-amber::before { background: rgba(14, 165, 233, 0.45); }
        .cards-page .stat-card.t-pink::before { background: rgba(56, 189, 248, 0.4); }

        .cards-page .stat-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 24px 48px rgba(15, 23, 42, 0.08);
        }
        .cards-page .stat-card:hover::before { opacity: 0.55; }

        .cards-page .stat-head {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 14px;
          position: relative;
          z-index: 1;
        }

        .cards-page .stat-icon {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #fff;
          position: relative;
          flex-shrink: 0;
        }

        .cards-page .stat-icon::after {
          content: '';
          position: absolute;
          inset: -3px;
          border-radius: 14px;
          opacity: 0.25;
          filter: blur(8px);
          z-index: -1;
        }

        .cards-page .stat-card.t-purple .stat-icon { color: var(--c-indigo); box-shadow: 0 8px 16px rgba(99, 102, 241, 0.3); }
        .cards-page .stat-card.t-purple .stat-icon::after { background: var(--c-indigo); }
        .cards-page .stat-card.t-blue .stat-icon { color: var(--c-blue); box-shadow: 0 8px 16px rgba(59, 130, 246, 0.25); }
        .cards-page .stat-card.t-blue .stat-icon::after { background: var(--c-blue); }
        .cards-page .stat-card.t-amber .stat-icon { color: var(--c-sky); box-shadow: 0 8px 16px rgba(14, 165, 233, 0.3); }
        .cards-page .stat-card.t-amber .stat-icon::after { background: var(--c-sky); }
        .cards-page .stat-card.t-pink .stat-icon { color: var(--c-cyan); box-shadow: 0 8px 16px rgba(6, 182, 212, 0.25); }
        .cards-page .stat-card.t-pink .stat-icon::after { background: var(--c-cyan); }

        .cards-page .stat-label {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-light);
        }

        .cards-page .stat-value-row {
          display: flex;
          align-items: baseline;
          gap: 6px;
          position: relative;
          z-index: 1;
        }

        .cards-page .stat-value {
          font-size: 32px;
          font-weight: 900;
          color: var(--text-main);
          letter-spacing: -1px;
          line-height: 1;
        }

        .cards-page .stat-card.t-purple .stat-value {
          background: linear-gradient(135deg, #6366f1, #4f46e5);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .cards-page .stat-card.t-amber .stat-value {
          background: linear-gradient(135deg, #38bdf8, #0284c7);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .cards-page .stat-unit {
          font-size: 13px;
          color: var(--text-light);
          font-weight: 700;
        }

        .cards-page .stat-trend {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          margin-top: 8px;
          font-size: 11.5px;
          font-weight: 800;
          position: relative;
          z-index: 1;
        }

        .cards-page .stat-trend.up { color: var(--c-blue); }
        .cards-page .stat-trend.flat { color: var(--text-light); }
        .cards-page .stat-trend.amber { color: #0369a1; }
        .cards-page .stat-trend.purple { color: var(--c-indigo); }

        /* === 卡册网格 === */
        .cards-page .albums-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px;
        }

        .cards-page .album-card {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.68));
          backdrop-filter: blur(30px);
          border: 1px solid rgba(255, 255, 255, 0.95);
          border-radius: 32px;
          overflow: hidden;
          box-shadow: 0 24px 48px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 1);
          position: relative;
          display: flex;
          flex-direction: column;
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          cursor: pointer;
          color: inherit;
          text-decoration: none;
        }

        .cards-page .album-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 36px 72px rgba(15, 23, 42, 0.12);
        }

        .cards-page .album-cover {
          position: relative;
          aspect-ratio: 16 / 11;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.5s ease;
        }

        .cards-page .album-card.s1 .album-cover {
          background:
            radial-gradient(ellipse at 30% 30%, rgba(207, 250, 254, 0.7), transparent 60%),
            radial-gradient(ellipse at 70% 80%, rgba(165, 243, 252, 0.6), transparent 60%),
            linear-gradient(135deg, #cffafe 0%, #a5f3fc 50%, #67e8f9 100%);
        }

        .cards-page .album-card.s2 .album-cover {
          background:
            radial-gradient(ellipse at 30% 30%, rgba(219, 234, 254, 0.6), transparent 60%),
            radial-gradient(ellipse at 70% 80%, rgba(165, 180, 252, 0.5), transparent 60%),
            linear-gradient(135deg, #dbeafe 0%, #bfdbfe 50%, #93c5fd 100%);
        }

        .cards-page .album-card.special .album-cover {
          background:
            radial-gradient(ellipse at 30% 30%, rgba(224, 231, 255, 0.7), transparent 60%),
            radial-gradient(ellipse at 70% 80%, rgba(165, 180, 252, 0.55), transparent 60%),
            linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 40%, #a5b4fc 100%);
        }

        .cards-page .album-card:hover .album-cover {
          transform: scale(1.03);
        }

        .cards-page .album-cover::before {
          content: '';
          position: absolute;
          top: -20%;
          left: -20%;
          width: 60%;
          height: 60%;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255, 255, 255, 0.6), transparent);
          filter: blur(30px);
          pointer-events: none;
        }

        .cards-page .cover-deco {
          position: absolute;
          top: 12%;
          bottom: 12%;
          width: 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-around;
          opacity: 0.45;
          z-index: 2;
        }

        .cards-page .cover-deco.left { left: 14px; }
        .cards-page .cover-deco.right { right: 14px; }

        .cards-page .cover-deco span {
          font-size: 14px;
        }

        .cards-page .cover-main-image {
          position: relative;
          z-index: 3;
          display: flex;
          align-items: center;
          justify-content: center;
          filter: drop-shadow(0 12px 24px rgba(0, 0, 0, 0.18));
          animation: cards-cover-float 4s ease-in-out infinite;
        }

        .cards-page .cover-main-image .cover-img {
          width: 140px;
          height: 140px;
          object-fit: contain;
          border-radius: 16px;
        }

        @keyframes cards-cover-float {
          0%, 100% { transform: translateY(0) rotate(-1deg); }
          50% { transform: translateY(-6px) rotate(1deg); }
        }

        .cards-page .album-badge {
          position: absolute;
          top: 18px;
          left: 18px;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 13px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.5px;
          backdrop-filter: blur(10px);
          z-index: 4;
          box-shadow: 0 6px 12px rgba(15, 23, 42, 0.08);
        }

        .cards-page .album-card.s1 .album-badge {
          background: rgba(255, 255, 255, 0.85);
          color: #0e7490;
          border: 1px solid rgba(6, 182, 212, 0.35);
        }

        .cards-page .album-card.s2 .album-badge {
          background: rgba(255, 255, 255, 0.85);
          color: #1d4ed8;
          border: 1px solid rgba(59, 130, 246, 0.3);
        }

        .cards-page .album-card.special .album-badge {
          background: rgba(255, 255, 255, 0.85);
          color: #4338ca;
          border: 1px solid rgba(99, 102, 241, 0.35);
        }

        .cards-page .album-progress-badge {
          position: absolute;
          top: 18px;
          right: 18px;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 12px;
          background: rgba(15, 23, 42, 0.7);
          color: #fff;
          border-radius: 999px;
          font-size: 11.5px;
          font-weight: 800;
          backdrop-filter: blur(10px);
          z-index: 4;
        }

        .cards-page .album-progress-badge.has-progress {
          background: linear-gradient(135deg, #38bdf8, #2563eb);
          color: #fff;
          box-shadow: 0 6px 12px rgba(59, 130, 246, 0.45);
        }

        .cards-page .album-body {
          padding: 24px 26px 0;
          display: flex;
          flex-direction: column;
          gap: 14px;
          flex: 1;
        }

        .cards-page .album-title-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }

        .cards-page .album-title {
          font-size: 22px;
          font-weight: 900;
          color: var(--text-main);
          letter-spacing: -0.5px;
          line-height: 1.25;
          margin: 0;
        }

        .cards-page .album-arrow {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: rgba(15, 23, 42, 0.05);
          color: var(--text-light);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          flex-shrink: 0;
        }

        .cards-page .album-card:hover .album-arrow {
          background: linear-gradient(135deg, #3b82f6, #6366f1);
          color: #fff;
          transform: translateX(4px);
          box-shadow: 0 8px 16px rgba(59, 130, 246, 0.35);
        }

        .cards-page .album-desc {
          font-size: 13.5px;
          color: var(--text-light);
          font-weight: 500;
          line-height: 1.5;
          margin: 0;
        }

        .cards-page .album-progress-section {
          margin-top: 4px;
        }

        .cards-page .album-progress-text {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .cards-page .album-progress-label {
          font-size: 12.5px;
          font-weight: 700;
          color: var(--text-light);
        }

        .cards-page .album-progress-num {
          font-size: 14px;
          font-weight: 900;
          letter-spacing: -0.3px;
          color: var(--text-main);
        }

        .cards-page .album-progress-num .got { font-weight: 900; }
        .cards-page .album-card.s1 .album-progress-num .got { color: var(--c-cyan); }
        .cards-page .album-card.s2 .album-progress-num .got { color: var(--c-blue); }
        .cards-page .album-card.special .album-progress-num .got { color: var(--c-indigo); }
        .cards-page .album-progress-num .total { color: var(--text-light); font-weight: 700; }

        .cards-page .album-progress-track {
          height: 8px;
          background: rgba(15, 23, 42, 0.06);
          border-radius: 999px;
          overflow: hidden;
          position: relative;
        }

        .cards-page .album-progress-bar {
          height: 100%;
          border-radius: 999px;
          position: relative;
          transition: width 1.2s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .cards-page .album-progress-bar::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.6), transparent);
          animation: cards-shimmer 2.5s linear infinite;
        }

        @keyframes cards-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }

        .cards-page .album-card.s1 .album-progress-bar {
          background: linear-gradient(135deg, #67e8f9, #06b6d4);
          box-shadow: 0 0 12px rgba(6, 182, 212, 0.45);
        }
        .cards-page .album-card.s2 .album-progress-bar {
          background: var(--grad-blue);
          box-shadow: 0 0 12px rgba(59, 130, 246, 0.4);
        }
        .cards-page .album-card.special .album-progress-bar {
          background: linear-gradient(135deg, #818cf8, #4f46e5);
          box-shadow: 0 0 12px rgba(99, 102, 241, 0.45);
        }

        .cards-page .album-reward {
          margin: 18px 26px 26px;
          padding: 14px 18px;
          border-radius: 18px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          position: relative;
          overflow: hidden;
          background: linear-gradient(135deg, rgba(219, 234, 254, 0.7), rgba(186, 230, 253, 0.5));
          border: 1px solid rgba(59, 130, 246, 0.25);
        }

        .cards-page .album-reward::before {
          content: '';
          position: absolute;
          top: -40%;
          right: -10%;
          width: 140px;
          height: 140px;
          border-radius: 50%;
          background: rgba(59, 130, 246, 0.22);
          filter: blur(30px);
          pointer-events: none;
        }

        .cards-page .reward-label {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 13px;
          font-weight: 800;
          color: #1e3a8a;
          letter-spacing: 0.3px;
          position: relative;
          z-index: 1;
        }

        .cards-page .reward-label .ico {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: linear-gradient(135deg, #38bdf8, #2563eb);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          box-shadow: 0 4px 8px rgba(59, 130, 246, 0.4);
        }

        .cards-page .reward-value {
          font-size: 18px;
          font-weight: 900;
          background: linear-gradient(135deg, #2563eb, #4f46e5);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          letter-spacing: -0.3px;
          position: relative;
          z-index: 1;
          display: inline-flex;
          align-items: baseline;
          gap: 4px;
        }

        .cards-page .reward-value .unit {
          font-size: 12px;
          font-weight: 800;
          color: #1e3a8a;
          -webkit-text-fill-color: #1e3a8a;
          background: none;
        }

        .cards-page .album-card.completed .album-cover::after {
          content: '✓';
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 80px;
          font-weight: 900;
          color: #fff;
          background: rgba(59, 130, 246, 0.42);
          backdrop-filter: blur(2px);
          z-index: 5;
        }

        /* === 图鉴规则弹窗 === */
        .cards-page .rules-mask {
          position: fixed;
          inset: 0;
          z-index: 200;
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          animation: rules-fade-in 0.2s ease-out;
        }

        @keyframes rules-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .cards-page .rules-modal {
          width: min(640px, 100%);
          max-height: min(80vh, 720px);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(255, 255, 255, 0.92));
          border: 1px solid rgba(255, 255, 255, 1);
          border-radius: 28px;
          box-shadow: 0 30px 60px rgba(15, 23, 42, 0.25), inset 0 1px 0 rgba(255, 255, 255, 1);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          animation: rules-pop-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes rules-pop-in {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        .cards-page .rules-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 22px 26px;
          border-bottom: 1px solid rgba(15, 23, 42, 0.06);
          background: linear-gradient(135deg, rgba(219, 234, 254, 0.7), rgba(199, 210, 254, 0.5));
        }

        .cards-page .rules-title {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .cards-page .rules-title-icon {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: linear-gradient(135deg, #3b82f6, #6366f1);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 12px 24px rgba(59, 130, 246, 0.35);
          flex-shrink: 0;
        }

        .cards-page .rules-title h3 {
          font-size: 20px;
          font-weight: 900;
          color: var(--text-main);
          margin: 0;
          letter-spacing: -0.5px;
        }

        .cards-page .rules-title p {
          font-size: 12px;
          color: var(--text-light);
          margin: 2px 0 0;
          font-weight: 500;
        }

        .cards-page .rules-close {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: rgba(15, 23, 42, 0.05);
          border: none;
          color: var(--text-light);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          flex-shrink: 0;
        }

        .cards-page .rules-close:hover {
          background: rgba(15, 23, 42, 0.1);
          color: var(--text-main);
          transform: rotate(90deg);
        }

        .cards-page .rules-body {
          padding: 22px 26px 26px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 22px;
        }

        .cards-page .rules-body::-webkit-scrollbar {
          width: 6px;
        }
        .cards-page .rules-body::-webkit-scrollbar-thumb {
          background: rgba(15, 23, 42, 0.1);
          border-radius: 6px;
        }

        .cards-page .rules-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .cards-page .rules-section-title {
          font-size: 15px;
          font-weight: 800;
          color: var(--text-main);
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          letter-spacing: -0.2px;
        }

        .cards-page .rules-section-title .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .cards-page .dot-purple { background: var(--c-indigo); box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18); }
        .cards-page .dot-amber { background: var(--c-sky); box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.22); }
        .cards-page .dot-green { background: var(--c-cyan); box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.18); }
        .cards-page .dot-pink { background: #818cf8; box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.22); }
        .cards-page .dot-blue { background: var(--c-blue); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18); }

        .cards-page .rules-section-desc {
          font-size: 12.5px;
          color: var(--text-light);
          line-height: 1.6;
          margin: 0 0 4px;
        }

        .cards-page .rules-section-desc strong {
          color: var(--text-main);
          font-weight: 800;
        }

        .cards-page .rules-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
        }

        .cards-page .rules-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 14px;
          background: rgba(248, 250, 252, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 12px;
          font-size: 13px;
        }

        .cards-page .rules-label {
          color: var(--text-light);
          font-weight: 700;
        }

        .cards-page .rules-value {
          color: var(--text-main);
          font-weight: 800;
        }

        @media (max-width: 640px) {
          .cards-page .rules-mask { padding: 12px; }
          .cards-page .rules-modal { border-radius: 22px; max-height: 88vh; }
          .cards-page .rules-header { padding: 18px 20px; }
          .cards-page .rules-body { padding: 18px 20px 22px; gap: 18px; }
          .cards-page .rules-title h3 { font-size: 18px; }
          .cards-page .rules-grid { grid-template-columns: 1fr; }
        }

        /* === 响应式 === */
        @media (max-width: 1280px) {
          .cards-page .topbar { padding: 14px 32px; }
          .cards-page .cards-container { padding: 24px 32px 80px; }
          .cards-page .albums-grid { grid-template-columns: repeat(2, 1fr); }
          .cards-page .stats-grid { grid-template-columns: repeat(2, 1fr); }
          .cards-page .hero-title { font-size: 40px; }
          .cards-page .float-cards { width: 180px; }
          .cards-page .fc-card { width: 76px; height: 108px; font-size: 30px; }
        }

        @media (max-width: 992px) {
          .cards-page .topbar { padding: 12px 24px; gap: 12px; }
          .cards-page .cards-container { padding: 20px 24px 80px; gap: 22px; }

          .cards-page .collection-hero { padding: 32px 26px; border-radius: 30px; }
          .cards-page .hero-content { max-width: 100%; }
          .cards-page .hero-title { font-size: 32px; }
          .cards-page .float-cards { display: none; }

          .cards-page .header-left .section-title { font-size: 26px; }
          .cards-page .section-title .title-icon { width: 38px; height: 38px; }

          .cards-page .user-info { display: none; }
        }

        @media (max-width: 720px) {
          .cards-page .albums-grid { grid-template-columns: 1fr; }
        }

        @media (max-width: 640px) {
          .cards-page .topbar { padding: 10px 14px; gap: 8px; }
          .cards-page .brand { font-size: 17px; gap: 9px; }
          .cards-page .brand-icon { width: 34px; height: 34px; border-radius: 11px; }
          .cards-page .topbar-right { gap: 6px; }
          .cards-page .btn-icon { width: 34px; height: 34px; }
          .cards-page .user-profile { padding: 4px; }
          .cards-page .avatar { width: 32px; height: 32px; font-size: 12px; }

          .cards-page .cards-container { padding: 16px 14px 100px; gap: 18px; }

          .cards-page .collection-hero { padding: 24px 18px; border-radius: 24px; }
          .cards-page .hero-badge { font-size: 11px; padding: 5px 11px; }
          .cards-page .hero-title { font-size: 26px; letter-spacing: -1px; }
          .cards-page .hero-sub { font-size: 13px; }
          .cards-page .fragment-card { padding: 12px 16px; gap: 14px; }
          .cards-page .fragment-icon { width: 38px; height: 38px; }
          .cards-page .fragment-value { font-size: 22px; }

          .cards-page .header-left .section-title { font-size: 22px; gap: 10px; }
          .cards-page .header-subtitle { font-size: 13px; }

          .cards-page .stats-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
          .cards-page .stat-card { padding: 18px; border-radius: 20px; }
          .cards-page .stat-value { font-size: 24px; }

          .cards-page .album-body { padding: 20px 22px 0; }
          .cards-page .album-title { font-size: 19px; }
          .cards-page .album-reward { margin: 16px 22px 22px; padding: 12px 16px; }
          .cards-page .cover-main-image .cover-img { width: 110px; height: 110px; }
        }

        /* === 手机端重排 v2：参考排行榜/游戏中心 === */
        @media (max-width: 640px) {
          .cards-page .cards-mesh-bg {
            opacity: 0.72;
            filter: blur(42px);
          }

          /* 顶栏：fixed 全宽磨砂，不随页面滚动 */
          .cards-page .topbar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 100;
            width: 100%;
            margin: 0;
            padding: 10px 12px;
            padding-top: max(10px, env(safe-area-inset-top));
            gap: 6px;
            border: 0;
            border-radius: 0;
            border-bottom: 1px solid rgba(186, 230, 253, 0.7);
            background: rgba(240, 247, 255, 0.85);
            backdrop-filter: blur(24px) saturate(1.6);
            -webkit-backdrop-filter: blur(24px) saturate(1.6);
            box-shadow: 0 8px 20px rgba(37, 99, 235, 0.06);
          }
          .cards-page .brand {
            min-width: 0;
            gap: 8px;
            font-size: 15.5px;
            letter-spacing: 0;
          }
          .cards-page .brand-icon {
            width: 32px;
            height: 32px;
            border-radius: 12px;
            flex: 0 0 auto;
          }
          .cards-page .brand-icon svg { width: 16px; height: 16px; }
          .cards-page .topbar-right { gap: 5px; min-width: 0; }
          .cards-page .topbar .btn-icon {
            width: 34px;
            height: 34px;
            border-radius: 12px;
            flex: 0 0 auto;
            background: rgba(255, 255, 255, 0.92);
          }
          .cards-page .topbar .btn-icon svg { width: 14px; height: 14px; }
          .cards-page .user-profile {
            width: 34px;
            height: 34px;
            justify-content: center;
            padding: 0;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.92);
          }
          .cards-page .user-profile .avatar {
            width: 30px;
            height: 30px;
            border-radius: 10px;
            font-size: 11px;
          }

          /* 容器：给 fixed topbar 让出空间 */
          .cards-page .cards-container {
            padding: max(72px, calc(60px + env(safe-area-inset-top))) 12px max(80px, calc(28px + env(safe-area-inset-bottom)));
            gap: 14px;
          }

          /* Hero 紧凑 */
          .cards-page .collection-hero {
            padding: 20px 16px;
            border-radius: 22px;
          }
          .cards-page .hero-badge {
            font-size: 10.5px;
            padding: 5px 10px;
            letter-spacing: 0;
          }
          .cards-page .hero-title {
            font-size: 24px;
            line-height: 1.15;
            letter-spacing: -0.5px;
          }
          .cards-page .hero-sub { font-size: 12.5px; line-height: 1.6; }
          .cards-page .fragment-card {
            padding: 10px 14px;
            gap: 12px;
            border-radius: 16px;
          }
          .cards-page .fragment-icon { width: 36px; height: 36px; border-radius: 12px; }
          .cards-page .fragment-icon svg { width: 18px; height: 18px; }
          .cards-page .fragment-value { font-size: 20px; }
          .cards-page .fragment-value .unit { font-size: 11px; }

          /* 页头 */
          .cards-page .page-header { gap: 10px; align-items: flex-start; }
          .cards-page .header-left .section-title {
            font-size: 18px;
            gap: 8px;
          }
          .cards-page .section-title .title-icon { width: 32px; height: 32px; border-radius: 10px; }
          .cards-page .header-subtitle { font-size: 12px; line-height: 1.55; }

          /* Stats grid */
          .cards-page .stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }
          .cards-page .stat-card {
            padding: 14px 12px;
            border-radius: 18px;
            min-height: 0;
          }
          .cards-page .stat-icon { width: 32px; height: 32px; border-radius: 10px; }
          .cards-page .stat-icon svg { width: 16px; height: 16px; }
          .cards-page .stat-label { font-size: 10.5px; }
          .cards-page .stat-value { font-size: 20px; }

          /* Albums grid 单列紧凑 */
          .cards-page .albums-grid {
            grid-template-columns: 1fr;
            gap: 14px;
          }
          .cards-page .album-card { border-radius: 24px; }
          .cards-page .album-cover {
            min-height: 140px;
            padding: 18px 16px 14px;
          }
          .cards-page .cover-main-image .cover-img {
            width: 88px;
            height: 88px;
          }
          .cards-page .album-badge {
            top: 12px;
            right: 12px;
            padding: 4px 9px;
            font-size: 10.5px;
          }
          .cards-page .album-body {
            padding: 16px 18px 0;
            gap: 8px;
          }
          .cards-page .album-title-row { gap: 10px; }
          .cards-page .album-title { font-size: 17px; letter-spacing: -0.3px; }
          .cards-page .album-arrow { width: 28px; height: 28px; }
          .cards-page .album-desc { font-size: 12.5px; line-height: 1.55; }
          .cards-page .album-progress-section { gap: 6px; }
          .cards-page .album-progress-label { font-size: 11px; }
          .cards-page .album-progress-num { font-size: 13px; }
          .cards-page .album-progress-track { height: 6px; }
          .cards-page .album-reward {
            margin: 12px 18px 16px;
            padding: 10px 14px;
            border-radius: 14px;
            font-size: 12px;
            gap: 8px;
          }
        }

        @media (max-width: 480px) {
          .cards-page .topbar {
            padding: 9px 10px;
            padding-top: max(9px, env(safe-area-inset-top));
            gap: 5px;
          }
          .cards-page .brand { font-size: 14.5px; gap: 7px; }
          .cards-page .brand-icon { width: 30px; height: 30px; border-radius: 11px; }
          .cards-page .brand-icon svg { width: 15px; height: 15px; }
          .cards-page .topbar .btn-icon { width: 32px; height: 32px; border-radius: 11px; }
          .cards-page .topbar .btn-icon svg { width: 14px; height: 14px; }
          .cards-page .user-profile { width: 32px; height: 32px; border-radius: 11px; }
          .cards-page .user-profile .avatar { width: 28px; height: 28px; border-radius: 9px; font-size: 10.5px; }

          .cards-page .cards-container { padding: max(68px, calc(56px + env(safe-area-inset-top))) 10px max(72px, calc(24px + env(safe-area-inset-bottom))); }

          .cards-page .collection-hero { padding: 18px 14px; border-radius: 20px; }
          .cards-page .hero-title { font-size: 22px; }

          .cards-page .stat-card { padding: 12px 10px; border-radius: 16px; }
          .cards-page .stat-icon { width: 28px; height: 28px; }
          .cards-page .stat-icon svg { width: 14px; height: 14px; }
          .cards-page .stat-value { font-size: 18px; }

          .cards-page .cover-main-image .cover-img { width: 78px; height: 78px; }
          .cards-page .album-title { font-size: 16px; }
          .cards-page .album-desc { font-size: 12px; }
        }
      `}</style>
    </div>
  );
}
