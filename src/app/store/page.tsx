'use client';

import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ArrowDownLeft,
  BadgeCheck,
  BookOpen,
  CalendarPlus,
  Coins,
  Flame,
  Gift,
  Home,
  Image as ImageIcon,
  Info,
  Loader2,
  Lock,
  Minus,
  PackageOpen,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  Ticket,
  Trophy,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  MIN_TOPUP_DOLLARS,
  MIN_WITHDRAW_POINTS,
  POINTS_PER_DOLLAR,
  WITHDRAW_FEE_TIERS,
  previewTopup,
  previewWithdraw,
} from '@/lib/wallet-rules';
import type { PublicAchievement } from '@/lib/profile-achievements';

// ============================================================================
// 类型
// ============================================================================
type StoreItemType = 'lottery_spin' | 'quota_direct' | 'card_draw' | 'makeup_card';

interface StoreItem {
  id: string;
  name: string;
  description: string;
  type: StoreItemType;
  categoryId?: string;
  pointsCost: number;
  value: number;
  dailyLimit?: number;
}

interface StoreCategory {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  enabled: boolean;
}

interface Project {
  id: string;
  name: string;
  description: string;
  maxClaims: number;
  claimedCount: number;
  codesCount: number;
  status: 'active' | 'paused' | 'exhausted';
  rewardType?: 'code' | 'direct';
  directPoints?: number;
  directDollars?: number;
  newUserOnly?: boolean;
  pinned?: boolean;
  pinnedAt?: number;
  createdAt: number;
}

// 多人抽奖（融入"免费福利"分组）
interface RafflePrize {
  id: string;
  name: string;
  dollars: number;
  quantity: number;
}

interface RaffleItem {
  id: string;
  title: string;
  description: string;
  prizes: RafflePrize[];
  triggerType: 'threshold' | 'manual';
  threshold: number;
  status: 'active' | 'ended' | 'draft' | 'cancelled';
  participantsCount: number;
  winnersCount: number;
  drawnAt?: number;
  createdAt: number;
}

interface AuthMeUser {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

interface MyProfile {
  displayName: string | null;
  avatarUrl: string | null;
  equippedAchievement: PublicAchievement | null;
}

type FilterKey = string;

// ============================================================================
// 辅助
// ============================================================================
function getStoreItemTheme(type: StoreItemType): string {
  if (type === 'card_draw') return 't-blue';
  if (type === 'quota_direct') return 't-green';
  if (type === 'makeup_card') return 't-green';
  return 't-cyan';
}

function getStoreItemTagClass(type: StoreItemType): string {
  if (type === 'card_draw') return 'cat-card';
  if (type === 'quota_direct') return 'cat-topup';
  if (type === 'makeup_card') return 'cat-makeup';
  return 'cat-lottery';
}

function getStoreItemTagLabel(type: StoreItemType): string {
  if (type === 'card_draw') return '卡牌';
  if (type === 'quota_direct') return '直充';
  if (type === 'makeup_card') return '补签';
  return '抽奖';
}

function getStoreItemIcon(type: StoreItemType): ReactNode {
  if (type === 'card_draw') return <ImageIcon strokeWidth={2.2} />;
  if (type === 'quota_direct') return <Wallet strokeWidth={2.2} />;
  if (type === 'makeup_card') return <CalendarPlus strokeWidth={2.2} />;
  return <Ticket strokeWidth={2.2} />;
}

function getActionButtonClass(type: StoreItemType): string {
  if (type === 'card_draw') return 'ic-action-btn blue';
  if (type === 'quota_direct') return 'ic-action-btn green';
  if (type === 'makeup_card') return 'ic-action-btn green';
  return 'ic-action-btn cyan';
}

function getDefaultCategoryId(type: StoreItemType): string {
  if (type === 'card_draw') return 'card';
  if (type === 'makeup_card') return 'makeup';
  return 'lottery';
}

function isUnlimitedItem(item: StoreItem): boolean {
  return (item.dailyLimit ?? 0) <= 0;
}

function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN');
}

function getInitial(name: string): string {
  return (name?.[0] ?? '?').toUpperCase();
}

interface ProfileUpdatedDetail {
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
}

// ============================================================================
// 主组件
// ============================================================================
function StoreContent() {
  const [user, setUser] = useState<AuthMeUser | null>(null);
  const [myProfile, setMyProfile] = useState<MyProfile | null>(null);

  const [items, setItems] = useState<StoreItem[]>([]);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [balance, setBalance] = useState(0);
  const [dailyLimit, setDailyLimit] = useState(0);
  const [dailyEarned, setDailyEarned] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [raffles, setRaffles] = useState<RaffleItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [exchanging, setExchanging] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [filter, setFilter] = useState<FilterKey>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const [quantityItem, setQuantityItem] = useState<StoreItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [rulesOpen, setRulesOpen] = useState(false);

  // 提现充值
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletTab, setWalletTab] = useState<'withdraw' | 'topup'>('withdraw');
  const [withdrawInput, setWithdrawInput] = useState<string>(String(MIN_WITHDRAW_POINTS));
  const [topupInput, setTopupInput] = useState<string>(String(MIN_TOPUP_DOLLARS));
  const [walletSubmitting, setWalletSubmitting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  // ---------- 数据加载 ----------
  const fetchAll = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setMessage(null);

    try {
      const [meRes, profileRes, storeRes, projectsRes, rafflesRes] = await Promise.all([
        fetch('/api/auth/me', { cache: 'no-store' }),
        fetch('/api/profile/settings', { cache: 'no-store' }),
        fetch('/api/store', { cache: 'no-store' }),
        fetch('/api/projects', { cache: 'no-store' }),
        fetch('/api/raffle?active=true', { cache: 'no-store' }),
      ]);

      const [meJson, profileJson, storeJson, projectsJson, rafflesJson] = await Promise.all([
        meRes.json().catch(() => ({ success: false })),
        profileRes.json().catch(() => ({ success: false })),
        storeRes.json().catch(() => ({ success: false })),
        projectsRes.json().catch(() => ({ success: false })),
        rafflesRes.json().catch(() => ({ success: false })),
      ]);

      if (meJson?.success && meJson.user) {
        setUser(meJson.user as AuthMeUser);
      }

      if (profileJson?.success && profileJson.data) {
        setMyProfile({
          displayName: profileJson.data.displayName ?? null,
          avatarUrl: profileJson.data.avatarUrl ?? null,
          equippedAchievement: profileJson.data.equippedAchievement ?? null,
        });
      } else {
        setMyProfile(null);
      }

      if (storeJson?.success && storeJson.data) {
        // "账户直充" 已下线，前台不展示该类型商品
        const rawItems = (storeJson.data.items as StoreItem[]) ?? [];
        setItems(rawItems
          .filter((it) => it.type !== 'quota_direct')
          .map((it) => ({ ...it, categoryId: it.categoryId ?? getDefaultCategoryId(it.type) })));
        setCategories(((storeJson.data.categories as StoreCategory[]) ?? [])
          .filter((category) => category.enabled)
          .sort((a, b) => a.sortOrder - b.sortOrder));
        setBalance(Number(storeJson.data.balance) || 0);
        setDailyLimit(Number(storeJson.data.dailyLimit) || 0);
        setDailyEarned(Number(storeJson.data.dailyEarned) || 0);
      }

      if (projectsJson?.success && Array.isArray(projectsJson.projects)) {
        setProjects(projectsJson.projects as Project[]);
      }

      if (rafflesJson?.success && Array.isArray(rafflesJson.raffles)) {
        // 仅展示进行中的抽奖项目
        const activeRaffles = (rafflesJson.raffles as RaffleItem[]).filter(
          (r) => r.status === 'active',
        );
        setRaffles(activeRaffles);
      }
    } catch (err) {
      console.error('Fetch store data error:', err);
      setMessage({ type: 'error', text: '加载失败，请稍后重试' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const handleProfileUpdated = (event: Event) => {
      const detail = (event as CustomEvent<ProfileUpdatedDetail>).detail;
      if (!detail) return;

      setMyProfile((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          displayName: Object.prototype.hasOwnProperty.call(detail, 'displayName')
            ? detail.displayName ?? null
            : prev.displayName,
          avatarUrl: Object.prototype.hasOwnProperty.call(detail, 'avatarUrl')
            ? detail.avatarUrl ?? null
            : prev.avatarUrl,
          equippedAchievement: Object.prototype.hasOwnProperty.call(detail, 'equippedAchievement')
            ? detail.equippedAchievement ?? null
            : prev.equippedAchievement,
        };
      });
    };

    window.addEventListener('lucky:profile-updated', handleProfileUpdated);
    return () => window.removeEventListener('lucky:profile-updated', handleProfileUpdated);
  }, []);

  const triggerRefresh = () => {
    if (refreshing) return;
    setRefreshSpin(true);
    void fetchAll(true).finally(() => {
      setTimeout(() => setRefreshSpin(false), 600);
    });
  };

  // ---------- 兑换 ----------
  const handleExchange = async (itemId: string, qty = 1) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;

    const safeQty = Number.isSafeInteger(qty) ? qty : Math.floor(Number(qty));
    const quantityValue = Number.isFinite(safeQty) ? Math.max(1, safeQty) : 1;
    const totalCost = item.pointsCost * quantityValue;

    if (balance < totalCost) {
      setMessage({ type: 'error', text: '积分不足' });
      return;
    }

    setExchanging(itemId);
    setMessage(null);

    try {
      const res = await fetch('/api/store/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, quantity: quantityValue }),
      });
      const data = await res.json();

      if (data.success) {
        const drawsAvailable = data.data?.drawsAvailable;
        const successText = typeof drawsAvailable === 'number'
          ? `${data.message || '兑换成功！'}，当前剩余 ${drawsAvailable} 次卡牌抽卡`
          : data.message || '兑换成功！';
        setMessage({ type: 'success', text: successText });
        setBalance(data.data?.newBalance ?? balance);
        setQuantityItem(null);
        setQuantity(1);
        void fetchAll(true);
      } else {
        setMessage({ type: 'error', text: data.message || data.error || '兑换失败' });
      }
    } catch {
      setMessage({ type: 'error', text: '网络错误' });
    } finally {
      setExchanging(null);
    }
  };

  const openQuantitySelector = (item: StoreItem) => {
    if (balance < item.pointsCost) return;
    setQuantityItem(item);
    setQuantity(1);
  };

  // ---------- 提现 / 充值 ----------
  const withdrawValue = useMemo(() => Number.parseInt(withdrawInput, 10), [withdrawInput]);
  const topupValue = useMemo(() => Number.parseInt(topupInput, 10), [topupInput]);
  const withdrawPreview = useMemo(
    () =>
      previewWithdraw(
        Number.isFinite(withdrawValue) && Number.isInteger(withdrawValue) ? withdrawValue : 0,
      ),
    [withdrawValue],
  );
  const topupPreview = useMemo(
    () =>
      previewTopup(
        Number.isFinite(topupValue) && Number.isInteger(topupValue) ? topupValue : 0,
      ),
    [topupValue],
  );

  const closeWallet = () => {
    if (walletSubmitting) return;
    setWalletOpen(false);
    setWalletError(null);
  };

  const handleWithdraw = async () => {
    setWalletError(null);
    if (!withdrawPreview.ok) {
      setWalletError(withdrawPreview.message ?? '请检查输入');
      return;
    }
    if (balance < withdrawPreview.deducted) {
      setWalletError('积分余额不足');
      return;
    }

    setWalletSubmitting(true);
    try {
      const res = await fetch('/api/store/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: withdrawPreview.deducted }),
      });
      const data = await res.json().catch(() => ({ success: false }));
      if (data?.success) {
        setMessage({ type: 'success', text: data.message ?? '提现成功' });
        if (typeof data.data?.newBalance === 'number') setBalance(data.data.newBalance);
        setWalletOpen(false);
        void fetchAll(true);
      } else {
        setWalletError(data?.message ?? '提现失败');
      }
    } catch {
      setWalletError('网络错误');
    } finally {
      setWalletSubmitting(false);
    }
  };

  const handleTopup = async () => {
    setWalletError(null);
    if (!topupPreview.ok) {
      setWalletError(topupPreview.message ?? '请检查输入');
      return;
    }

    setWalletSubmitting(true);
    try {
      const res = await fetch('/api/store/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dollars: topupPreview.spentDollars }),
      });
      const data = await res.json().catch(() => ({ success: false }));
      if (data?.success) {
        setMessage({ type: 'success', text: data.message ?? '充值成功' });
        if (typeof data.data?.newBalance === 'number') setBalance(data.data.newBalance);
        setWalletOpen(false);
        void fetchAll(true);
      } else {
        setWalletError(data?.message ?? '充值失败');
      }
    } catch {
      setWalletError('网络错误');
    } finally {
      setWalletSubmitting(false);
    }
  };

  useEffect(() => {
    if (!quantityItem) return;
    const maxAffordable = Math.max(1, Math.floor(balance / quantityItem.pointsCost));
    setQuantity((q) => Math.min(Math.max(1, q), maxAffordable));
  }, [balance, quantityItem]);

  const maxAffordableQuantity = quantityItem
    ? Math.max(1, Math.floor(balance / quantityItem.pointsCost))
    : 1;
  const clampedQuantity = quantityItem ? Math.min(Math.max(1, quantity), maxAffordableQuantity) : 1;
  const totalCost = quantityItem ? quantityItem.pointsCost * clampedQuantity : 0;
  const canAffordTotal = quantityItem ? balance >= totalCost : false;
  const isExchangingQuantityItem = quantityItem ? exchanging === quantityItem.id : false;
  const quantityThemeClass = quantityItem
    ? getStoreItemTheme(quantityItem.type).replace('t-', 'qty-theme-')
    : 'qty-theme-cyan';

  // ---------- 派生数据：筛选/分组 ----------
  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === 'active'),
    [projects],
  );

  // 多人抽奖（融入免费福利分组）
  const activeRaffles = useMemo(
    () => raffles.filter((r) => r.status === 'active'),
    [raffles],
  );

  // 免费福利总数 = 进行中项目 + 进行中抽奖
  const welfareCount = activeProjects.length + activeRaffles.length;

  const categoryItems = useMemo(() => {
    const map: Record<string, StoreItem[]> = {};
    for (const item of items) {
      const categoryId = item.categoryId ?? getDefaultCategoryId(item.type);
      if (!map[categoryId]) map[categoryId] = [];
      map[categoryId].push(item);
    }
    return map;
  }, [items]);

  const visibleCategories = useMemo(() => {
    if (categories.length > 0) return categories;
    return [
      { id: 'lottery', name: '抽奖兑换', color: '#06b6d4', sortOrder: 1, enabled: true },
      { id: 'card', name: '卡牌兑换', color: '#3b82f6', sortOrder: 2, enabled: true },
      { id: 'makeup', name: '签到兑换', color: '#22c55e', sortOrder: 3, enabled: true },
    ];
  }, [categories]);

  // 今日剩余可获取的游戏积分（受 dailyPointsLimit 管控的部分）
  const dailyRemaining = useMemo(
    () => Math.max(0, dailyLimit - dailyEarned),
    [dailyLimit, dailyEarned],
  );

  const filteredProjects = useMemo(() => {
    if (filter !== 'all' && filter !== 'welfare') return [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return activeProjects;
    return activeProjects.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        (p.description ?? '').toLowerCase().includes(term),
    );
  }, [activeProjects, filter, searchTerm]);

  const filteredRaffles = useMemo(() => {
    if (filter !== 'all' && filter !== 'welfare') return [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return activeRaffles;
    return activeRaffles.filter(
      (r) =>
        r.title.toLowerCase().includes(term) ||
        (r.description ?? '').toLowerCase().includes(term),
    );
  }, [activeRaffles, filter, searchTerm]);

  const filteredItems = useMemo(() => {
    let pool: StoreItem[] = [];
    if (filter === 'all') pool = items;
    else if (filter === 'welfare') pool = [];
    else pool = categoryItems[filter] ?? [];

    const term = searchTerm.trim().toLowerCase();
    if (!term) return pool;
    return pool.filter(
      (it) =>
        it.name.toLowerCase().includes(term) ||
        (it.description ?? '').toLowerCase().includes(term),
    );
  }, [items, categoryItems, filter, searchTerm]);

  // ---------- 顶部用户展示（与个人主页保持一致） ----------
  const username = myProfile?.displayName || user?.displayName || user?.username || '游客';
  const meAvatarUrl = myProfile?.avatarUrl ?? null;
  const meInitial = getInitial(username);
  const navAchievement = myProfile?.equippedAchievement ?? null;
  const navRoleLabel = user?.isAdmin ? '管理员' : '用户';

  // ---------- 渲染 ----------
  if (loading) {
    return (
      <div className="lwf-loading">
        <Loader2 className="lwf-spin" />
        <style jsx>{`
          .lwf-loading {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f8fafc;
          }
        `}</style>
        <style jsx global>{`
          .lwf-loading .lwf-spin {
            width: 32px;
            height: 32px;
            color: #f97316;
            animation: lwfSpin 1s linear infinite;
          }
          @keyframes lwfSpin {
            from { transform: rotate(0); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="lucky-store">
      <div className="mesh-bg" />

      {/* 顶部导航栏：参考排行榜界面，仅保留 品牌(福利商店) + 首页按钮 + 用户胶囊 */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            <ShoppingBag />
          </div>
          福利商店
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className="btn-icon rules-trigger"
            onClick={() => setRulesOpen(true)}
            aria-label="查看商店规则"
            title="商店规则"
          >
            <BookOpen />
          </button>
          <Link href="/" className="btn-icon" aria-label="返回首页" title="返回首页">
            <Home />
          </Link>
          <Link href="/profile" className="user-profile">
            <div className="avatar">
              {meAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={meAvatarUrl} alt={username || 'avatar'} className="avatar-img" />
              ) : (
                meInitial
              )}
            </div>
            <div className="user-info">
              <h4>{username}</h4>
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

      <main className="container">
        {/* Hero */}
        <section className="store-hero">
          <div className="stars">
            <span className="star" style={{ top: '12%', left: '8%', fontSize: 13 }}>✦</span>
            <span className="star" style={{ top: '32%', left: '38%', fontSize: 11, animationDelay: '0.8s' }}>✦</span>
            <span className="star" style={{ top: '68%', left: '18%', fontSize: 14, animationDelay: '1.4s' }}>✦</span>
            <span className="star" style={{ top: '78%', left: '50%', fontSize: 10, animationDelay: '0.4s' }}>✦</span>
            <span className="star" style={{ top: '22%', left: '58%', fontSize: 12, animationDelay: '2s' }}>✦</span>
          </div>

          <div className="hero-content">
            <div className="hero-text">
              <div className="hero-badge">
                <Sparkles />
                LUCKY 福利商店 · 限时火热进行中
              </div>
              <h1 className="hero-title">
                专属<span className="glow">惊喜福利</span>与<br />积分超值兑换
              </h1>
              <p className="hero-sub">
                领取免费福利项目，或使用游戏积分兑换抽奖、卡牌等超值奖励，每一份都是为您准备的专属惊喜。
              </p>
            </div>

            <div className="hero-points-wrap">
              <div className="hero-points-card">
                <div className="hpc-star">
                  <Star fill="currentColor" strokeWidth={0} />
                </div>
                <div className="hpc-info">
                  <div className="hpc-label">当前可用积分余额</div>
                  <div className="hpc-value">
                    {formatNumber(balance)}
                    <span className="unit">积分</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 消息提示 */}
        {message && (
          <div className={`store-message ${message.type}`}>
            {message.type === 'success' ? <BadgeCheck /> : <Info />}
            <span>{message.text}</span>
            <button
              type="button"
              className="store-message-close"
              onClick={() => setMessage(null)}
              aria-label="关闭提示"
            >
              <X />
            </button>
          </div>
        )}

        {/* 页头 */}
        <div className="page-header">
          <div className="header-left">
            <h2 className="section-title">
              <span className="title-icon">
                <ShoppingBag strokeWidth={2.5} />
              </span>
              全部商品
            </h2>
            <p className="header-subtitle">
              浏览免费福利与积分兑换商品，找到您心仪的奖励，尽情享受属于您的专属权益。
            </p>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className={`btn-icon ${refreshSpin ? 'spinning' : ''}`}
              onClick={triggerRefresh}
              disabled={refreshing}
              aria-label="刷新"
            >
              <RefreshCw />
            </button>
          </div>
        </div>

        {/* 数据概览 */}
        <section className="stats-grid">
          <button
            type="button"
            className="stat-card t-amber stat-card-clickable"
            onClick={() => {
              setWalletTab('withdraw');
              setWalletOpen(true);
            }}
          >
            <div className="stat-head">
              <div className="stat-icon">
                <ArrowLeftRight strokeWidth={2.4} />
              </div>
              <div className="stat-label">提现充值</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{formatNumber(balance)}</span>
              <span className="stat-unit">积分</span>
            </div>
            <div className="stat-extra">
              <span>积分 ↔ 额度互转</span>
              <span className="stat-extra-cta">点击操作 →</span>
            </div>
          </button>

          <div className="stat-card t-orange">
            <div className="stat-head">
              <div className="stat-icon">
                <Gift strokeWidth={2.4} />
              </div>
              <div className="stat-label">免费福利</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{welfareCount}</span>
              <span className="stat-unit">项可领</span>
            </div>
          </div>

          <div className="stat-card t-purple">
            <div className="stat-head">
              <div className="stat-icon">
                <PackageOpen strokeWidth={2.4} />
              </div>
              <div className="stat-label">积分商品</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{items.length}</span>
              <span className="stat-unit">款上架</span>
            </div>
          </div>

          <div className="stat-card t-green">
            <div className="stat-head">
              <div className="stat-icon">
                <Coins strokeWidth={2.4} />
              </div>
              <div className="stat-label">今日剩余</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{formatNumber(dailyRemaining)}</span>
              <span className="stat-unit">积分可获取</span>
            </div>
          </div>
        </section>

        {/* 筛选栏 */}
        <div className="filter-bar">
          <div className="filter-tabs">
            <button
              type="button"
              className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              全部
              <span className="count">{welfareCount + items.length}</span>
            </button>
            <button
              type="button"
              className={`filter-tab ${filter === 'welfare' ? 'active' : ''}`}
              onClick={() => setFilter('welfare')}
            >
              免费福利
              <span className="count">{welfareCount}</span>
            </button>
            {visibleCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`filter-tab ${filter === category.id ? 'active' : ''}`}
                onClick={() => setFilter(category.id)}
                style={filter === category.id ? { borderColor: category.color, color: category.color } : undefined}
              >
                {category.name}
                <span className="count">{categoryItems[category.id]?.length ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="search-box">
            <Search />
            <input
              type="text"
              placeholder="搜索商品..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        {/* 免费福利分组（项目 + 多人抽奖） */}
        {(filteredProjects.length > 0 || filteredRaffles.length > 0) && (
          <>
            <div className="group-title">
              <h3>
                <span className="grp-icon free">
                  <Gift strokeWidth={2.4} />
                </span>
                免费福利项目
                <span className="grp-count">{filteredProjects.length + filteredRaffles.length} 项进行中</span>
              </h3>
            </div>
            <section className="items-grid">
              {filteredProjects.map((project) => {
                const remaining = Math.max(0, project.maxClaims - project.claimedCount);
                const progress = project.maxClaims > 0
                  ? Math.min(100, Math.round((project.claimedCount / project.maxClaims) * 100))
                  : 0;
                const reachLimit = project.maxClaims > 0 && remaining === 0;
                return (
                  <Link
                    key={`project-${project.id}`}
                    href={`/project/${project.id}`}
                    className="item-card t-orange"
                  >
                    {project.pinned && (
                      <span className="corner-tag hot">
                        <Flame size={11} />
                        HOT
                      </span>
                    )}
                    <div className="ic-head">
                      <div className="ic-icon">
                        <Gift strokeWidth={2.2} />
                      </div>
                      <div className="ic-title-area">
                        <div className="ic-title">{project.name}</div>
                        <div className="ic-tags">
                          <span className="ic-tag cat-welfare">福利</span>
                          {project.newUserOnly && (
                            <span className="ic-tag limit">仅限新人</span>
                          )}
                          {project.rewardType === 'direct' && (project.directPoints ?? project.directDollars) ? (
                            <span className="ic-tag limit">
                              直充 {(project.directPoints ?? project.directDollars ?? 0).toLocaleString('zh-CN')} 积分
                            </span>
                          ) : null}
                          <span className="ic-status active">
                            <span className="dot" />
                            进行中
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="ic-desc">{project.description || '暂无描述'}</div>

                    <div className="ic-progress-section">
                      <div className="ic-progress-text">
                        <span>
                          已领 <span className="num received">{formatNumber(project.claimedCount)}</span>
                        </span>
                        <span>
                          剩 <span className="num">{formatNumber(remaining)}</span>
                        </span>
                      </div>
                      <div className="ic-progress-track">
                        <div className="ic-progress-bar" style={{ width: `${progress}%` }} />
                      </div>
                    </div>

                    <div className="ic-foot">
                      <div className="ic-price">
                        <div className="ic-price-label">免费领取</div>
                        <div className="ic-price-row">
                          <span className="ic-price-num welfare-free-color">FREE</span>
                        </div>
                      </div>
                      <span className={`ic-action-btn ${reachLimit ? 'disabled' : 'orange'}`}>
                        {reachLimit ? '已领完' : '去领取'}
                        {!reachLimit && <ArrowLeft style={{ transform: 'rotate(180deg)' }} size={14} />}
                      </span>
                    </div>
                  </Link>
                );
              })}

              {filteredRaffles.map((raffle) => {
                // 多人抽奖卡片：作为免费福利的一种类型展示
                const totalPool = raffle.prizes.reduce(
                  (sum, p) => sum + (p.dollars || 0) * (p.quantity || 0),
                  0,
                );
                const totalQuantity = raffle.prizes.reduce(
                  (sum, p) => sum + (p.quantity || 0),
                  0,
                );
                const isThreshold = raffle.triggerType === 'threshold' && raffle.threshold > 0;
                // 阈值触发：参与人数/阈值；手动触发：粗略估算（参与即 60%）
                const progress = isThreshold
                  ? Math.min(100, Math.round((raffle.participantsCount / raffle.threshold) * 100))
                  : Math.min(100, raffle.participantsCount > 0 ? 60 : 8);
                const isHot = isThreshold && raffle.participantsCount / raffle.threshold >= 0.5;
                return (
                  <Link
                    key={`raffle-${raffle.id}`}
                    href={`/project/${raffle.id}?type=raffle`}
                    className="item-card t-pink"
                  >
                    {isHot && (
                      <span className="corner-tag hot">
                        <Flame size={11} />
                        HOT
                      </span>
                    )}
                    <div className="ic-head">
                      <div className="ic-icon">
                        <Users strokeWidth={2.2} />
                      </div>
                      <div className="ic-title-area">
                        <div className="ic-title">{raffle.title}</div>
                        <div className="ic-tags">
                          <span className="ic-tag cat-raffle">抽奖福利</span>
                          {isThreshold ? (
                            <span className="ic-tag limit">满 {raffle.threshold} 人开奖</span>
                          ) : (
                            <span className="ic-tag limit">手动开奖</span>
                          )}
                          <span className="ic-status active">
                            <span className="dot" />
                            进行中
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="ic-desc">{raffle.description || '邀请好友免费参与，奖池满额即开奖'}</div>

                    <div className="ic-progress-section">
                      <div className="ic-progress-text">
                        <span>
                          已参与 <span className="num received">{formatNumber(raffle.participantsCount)}</span>
                        </span>
                        <span>
                          {isThreshold ? (
                            <>差 <span className="num">{formatNumber(Math.max(0, raffle.threshold - raffle.participantsCount))}</span> 人</>
                          ) : (
                            <>奖品 <span className="num">{formatNumber(totalQuantity)}</span> 份</>
                          )}
                        </span>
                      </div>
                      <div className="ic-progress-track">
                        <div className="ic-progress-bar" style={{ width: `${progress}%` }} />
                      </div>
                    </div>

                    <div className="ic-foot">
                      <div className="ic-price">
                        <div className="ic-price-label">奖池总额</div>
                        <div className="ic-price-row">
                          <span className="ic-price-num raffle-free-color">${formatNumber(totalPool)}</span>
                        </div>
                      </div>
                      <span className="ic-action-btn pink">
                        <Trophy size={14} />
                        去参与
                      </span>
                    </div>
                  </Link>
                );
              })}
            </section>
          </>
        )}

        {/* 积分兑换分组 */}
        {filteredItems.length > 0 && (
          <>
            <div className="group-title">
              <h3>
                <span className="grp-icon points">
                  <Star fill="currentColor" strokeWidth={0} />
                </span>
                积分兑换商品
                <span className="grp-count">{filteredItems.length} 款上架</span>
              </h3>
            </div>
            <section className="items-grid">
              {filteredItems.map((item) => {
                const canAfford = balance >= item.pointsCost;
                const isExchanging = exchanging === item.id;
                const unlimited = isUnlimitedItem(item);
                const theme = getStoreItemTheme(item.type);
                const tagClass = getStoreItemTagClass(item.type);
                const tagLabel = getStoreItemTagLabel(item.type);
                // 优惠角标：单价 > 单次价值（即多份套餐通常会做折扣），简化为 value > 1 时挂标
                const isPremiumPack = item.value > 1;

                return (
                  <div
                    key={`store-${item.id}`}
                    className={`item-card ${theme}`}
                  >
                    {isPremiumPack && (
                      <span className="corner-tag discount">
                        <Sparkles size={11} />
                        优惠
                      </span>
                    )}
                    <div className="ic-head">
                      <div className="ic-icon">{getStoreItemIcon(item.type)}</div>
                      <div className="ic-title-area">
                        <div className="ic-title">{item.name}</div>
                        <div className="ic-tags">
                          <span className={`ic-tag ${tagClass}`}>{tagLabel}</span>
                          {item.dailyLimit && item.dailyLimit > 0 ? (
                            <span className="ic-tag limit">限购 {item.dailyLimit}</span>
                          ) : (
                            <span className="ic-tag limit">不限购</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="ic-desc">{item.description}</div>

                    <div className="ic-foot">
                      <div className="ic-price">
                        <div className="ic-price-label">价格</div>
                        <div className="ic-price-row">
                          <span className="ic-price-num points-color">{formatNumber(item.pointsCost)}</span>
                          <span className="ic-price-unit">积分</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        className={
                          !canAfford || isExchanging
                            ? 'ic-action-btn disabled'
                            : getActionButtonClass(item.type)
                        }
                        onClick={() => {
                          if (!canAfford || isExchanging) return;
                          if (unlimited) openQuantitySelector(item);
                          else void handleExchange(item.id);
                        }}
                        disabled={!canAfford || isExchanging}
                      >
                        {isExchanging ? (
                          <>
                            <Loader2 className="ic-action-spin" size={14} />
                            兑换中
                          </>
                        ) : !canAfford ? (
                          <>
                            <Lock size={13} />
                            积分不足
                          </>
                        ) : unlimited ? (
                          <>
                            选择数量
                            <Plus size={14} />
                          </>
                        ) : (
                          <>
                            立即兑换
                            <BadgeCheck size={14} />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>
          </>
        )}

        {/* 空状态 */}
        {filteredProjects.length === 0 && filteredRaffles.length === 0 && filteredItems.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">
              <PackageOpen />
            </div>
            <h3>没有匹配的商品</h3>
            <p>试试切换其它分类，或调整搜索关键词。</p>
          </div>
        )}
      </main>

      {/* 数量选择 modal */}
      {quantityItem && (
        <div className="lwf-modal-mask" role="dialog" aria-modal="true" aria-label="选择兑换数量">
          <div
            className="lwf-modal-backdrop"
            onClick={() => (isExchangingQuantityItem ? null : setQuantityItem(null))}
          />
          <div className={`lwf-modal qty-modal ${quantityThemeClass}`}>
            <div className="lwf-modal-header">
              <h3>
                <PackageOpen />
                选择兑换数量
              </h3>
              <button
                type="button"
                className="lwf-modal-close"
                onClick={() => (isExchangingQuantityItem ? null : setQuantityItem(null))}
                aria-label="关闭"
              >
                <X />
              </button>
            </div>
            <div className="lwf-modal-body">
              <p className="lwf-modal-tip">{quantityItem.name}</p>
              <div className="qty-row">
                <button
                  type="button"
                  className="qty-btn"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={isExchangingQuantityItem || clampedQuantity <= 1}
                  aria-label="减少"
                >
                  <Minus />
                </button>
                <input
                  type="number"
                  min={1}
                  max={maxAffordableQuantity}
                  value={clampedQuantity}
                  onChange={(e) => {
                    const n = Math.floor(Number(e.target.value));
                    if (!Number.isFinite(n)) return;
                    setQuantity(Math.min(Math.max(1, n), maxAffordableQuantity));
                  }}
                  className="qty-input"
                />
                <button
                  type="button"
                  className="qty-btn"
                  onClick={() => setQuantity((q) => Math.min(maxAffordableQuantity, q + 1))}
                  disabled={isExchangingQuantityItem || clampedQuantity >= maxAffordableQuantity}
                  aria-label="增加"
                >
                  <Plus />
                </button>
              </div>
              <div className="qty-summary">
                <span>总价</span>
                <strong>{formatNumber(totalCost)} 积分</strong>
              </div>
              <p className="qty-hint">最多可兑换 {maxAffordableQuantity} 份（按当前积分余额计算）</p>
            </div>
            <div className="lwf-modal-footer">
              <button
                type="button"
                className="lwf-btn-secondary"
                onClick={() => setQuantityItem(null)}
                disabled={isExchangingQuantityItem}
              >
                取消
              </button>
              <button
                type="button"
                className="lwf-btn-primary"
                onClick={() => handleExchange(quantityItem.id, clampedQuantity)}
                disabled={!canAffordTotal || isExchangingQuantityItem}
              >
                {isExchangingQuantityItem ? <Loader2 className="ic-action-spin" size={14} /> : <BadgeCheck size={14} />}
                确认兑换
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 规则弹窗 */}
      {rulesOpen && (
        <div className="lwf-modal-mask" role="dialog" aria-modal="true" aria-label="商店规则">
          <div className="lwf-modal-backdrop" onClick={() => setRulesOpen(false)} />
          <div className="lwf-modal lwf-modal-rules">
            <div className="lwf-modal-header">
              <h3>
                <BookOpen />
                商店规则
              </h3>
              <button
                type="button"
                className="lwf-modal-close"
                onClick={() => setRulesOpen(false)}
                aria-label="关闭"
              >
                <X />
              </button>
            </div>
            <div className="lwf-modal-body">
              <ul className="rules-list">
                <li>
                  <span className="rule-num">01</span>
                  <div>
                    <h4>积分获取</h4>
                    <p>积分可通过游戏游玩、签到、排行榜奖励等方式获得，每日游戏获取上限为 5,000 积分。</p>
                  </div>
                </li>
                <li>
                  <span className="rule-num">02</span>
                  <div>
                    <h4>积分兑换</h4>
                    <p>每件商品的限购规则以卡片显示为准；不限购商品可在弹窗中选择数量后一并兑换。</p>
                  </div>
                </li>
                <li>
                  <span className="rule-num">03</span>
                  <div>
                    <h4>免费福利</h4>
                    <p>福利项目按 <strong>先到先得</strong> 发放，部分项目仅限新人参与。点击卡片进入详情页确认领取。</p>
                  </div>
                </li>
                <li>
                  <span className="rule-num">04</span>
                  <div>
                    <h4>提现充值</h4>
                    <p>积分可与账户额度互转：<strong>10 积分 = $1 额度</strong>，充值无手续费；提现根据金额阶梯收取手续费，最低 10 积分起提，单次操作即时到账。</p>
                  </div>
                </li>
                <li>
                  <span className="rule-num">05</span>
                  <div>
                    <h4>问题反馈</h4>
                    <p>遇到兑换异常或额度未到账，请通过反馈墙提交工单，管理员会尽快处理。</p>
                  </div>
                </li>
              </ul>
            </div>
            <div className="lwf-modal-footer">
              <button type="button" className="lwf-btn-primary" onClick={() => setRulesOpen(false)}>
                知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 提现充值弹窗 */}
      {walletOpen && (
        <div className="lwf-modal-mask" role="dialog" aria-modal="true" aria-label="提现充值">
          <div className="lwf-modal-backdrop" onClick={closeWallet} />
          <div className="lwf-modal lwf-modal-wallet">
            <div className="lwf-modal-header">
              <h3>
                <ArrowLeftRight />
                提现 / 充值
              </h3>
              <button
                type="button"
                className="lwf-modal-close"
                onClick={closeWallet}
                aria-label="关闭"
                disabled={walletSubmitting}
              >
                <X />
              </button>
            </div>

            <div className="wallet-tabs">
              <button
                type="button"
                className={`wallet-tab ${walletTab === 'withdraw' ? 'active' : ''}`}
                onClick={() => {
                  setWalletTab('withdraw');
                  setWalletError(null);
                }}
                disabled={walletSubmitting}
              >
                <ArrowUpRight size={14} />
                积分提现
              </button>
              <button
                type="button"
                className={`wallet-tab ${walletTab === 'topup' ? 'active' : ''}`}
                onClick={() => {
                  setWalletTab('topup');
                  setWalletError(null);
                }}
                disabled={walletSubmitting}
              >
                <ArrowDownLeft size={14} />
                额度充值
              </button>
            </div>

            <div className="lwf-modal-body wallet-body">
              <div className="wallet-summary">
                <div>
                  <div className="wallet-summary-label">积分余额</div>
                  <div className="wallet-summary-value">
                    {formatNumber(balance)}
                    <span className="wallet-summary-unit">积分</span>
                  </div>
                </div>
                <div className="wallet-summary-divider" />
                <div>
                  <div className="wallet-summary-label">兑换比例</div>
                  <div className="wallet-summary-value">
                    {POINTS_PER_DOLLAR}
                    <span className="wallet-summary-unit">积分 = $1</span>
                  </div>
                </div>
              </div>

              {walletTab === 'withdraw' ? (
                <>
                  <label className="wallet-field-label" htmlFor="withdraw-points-input">
                    提现积分数（最低 {MIN_WITHDRAW_POINTS}）
                  </label>
                  <div className="wallet-field-row">
                    <input
                      id="withdraw-points-input"
                      type="number"
                      min={MIN_WITHDRAW_POINTS}
                      step={1}
                      value={withdrawInput}
                      onChange={(e) => setWithdrawInput(e.target.value.replace(/[^0-9]/g, ''))}
                      className="wallet-input"
                      placeholder={`${MIN_WITHDRAW_POINTS}`}
                    />
                    <button
                      type="button"
                      className="wallet-max-btn"
                      onClick={() => setWithdrawInput(String(Math.max(MIN_WITHDRAW_POINTS, balance)))}
                      disabled={walletSubmitting || balance < MIN_WITHDRAW_POINTS}
                    >
                      全部
                    </button>
                  </div>

                  <div className="wallet-preview">
                    {withdrawPreview.ok ? (
                      <>
                        <div className="wallet-preview-row">
                          <span>当前手续费率</span>
                          <strong>{(withdrawPreview.feeRate * 100).toFixed(0)}%</strong>
                        </div>
                        <div className="wallet-preview-row">
                          <span>手续费扣除</span>
                          <strong className="wallet-fee">
                            -{formatNumber(withdrawPreview.feePoints)} 积分
                          </strong>
                        </div>
                        <div className="wallet-preview-row">
                          <span>实际兑换</span>
                          <strong>{formatNumber(withdrawPreview.netPoints)} 积分</strong>
                        </div>
                        <div className="wallet-preview-row wallet-preview-final">
                          <span>到账额度</span>
                          <strong className="wallet-final">${withdrawPreview.dollars.toFixed(2)}</strong>
                        </div>
                      </>
                    ) : (
                      <div className="wallet-preview-empty">
                        {withdrawPreview.message || '请输入有效的积分数'}
                      </div>
                    )}
                  </div>

                  <div className="wallet-fee-table">
                    <div className="wallet-fee-table-title">手续费阶梯</div>
                    <div className="wallet-fee-rows">
                      {WITHDRAW_FEE_TIERS.map((tier, idx) => {
                        const next = WITHDRAW_FEE_TIERS[idx - 1];
                        const range = next
                          ? `${formatNumber(tier.min)} - ${formatNumber(next.min - 1)}`
                          : `${formatNumber(tier.min)}+`;
                        const active = withdrawPreview.ok && withdrawPreview.feeRate === tier.rate;
                        return (
                          <div key={tier.min} className={`wallet-fee-row ${active ? 'is-active' : ''}`}>
                            <span>{range} 积分</span>
                            <strong>{(tier.rate * 100).toFixed(0)}%</strong>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <label className="wallet-field-label" htmlFor="topup-dollars-input">
                    充值金额（美元，最低 ${MIN_TOPUP_DOLLARS}）
                  </label>
                  <div className="wallet-field-row">
                    <input
                      id="topup-dollars-input"
                      type="number"
                      min={MIN_TOPUP_DOLLARS}
                      step={1}
                      value={topupInput}
                      onChange={(e) => setTopupInput(e.target.value.replace(/[^0-9]/g, ''))}
                      className="wallet-input"
                      placeholder={`${MIN_TOPUP_DOLLARS}`}
                    />
                    <span className="wallet-input-suffix">$</span>
                  </div>

                  <div className="wallet-preview">
                    {topupPreview.ok ? (
                      <>
                        <div className="wallet-preview-row">
                          <span>消耗账户额度</span>
                          <strong>${topupPreview.spentDollars}</strong>
                        </div>
                        <div className="wallet-preview-row">
                          <span>手续费</span>
                          <strong className="wallet-fee-free">免手续费</strong>
                        </div>
                        <div className="wallet-preview-row wallet-preview-final">
                          <span>到账积分</span>
                          <strong className="wallet-final">+{formatNumber(topupPreview.pointsGained)} 积分</strong>
                        </div>
                      </>
                    ) : (
                      <div className="wallet-preview-empty">
                        {topupPreview.message || '请输入有效的金额'}
                      </div>
                    )}
                  </div>

                  <p className="wallet-hint">
                    充值会从您绑定的账户额度（new-api）中扣除，按 1:10 比例即时兑换为积分。
                  </p>
                </>
              )}

              {walletError && <div className="wallet-error">{walletError}</div>}
            </div>

            <div className="lwf-modal-footer">
              <button
                type="button"
                className="lwf-btn-secondary"
                onClick={closeWallet}
                disabled={walletSubmitting}
              >
                取消
              </button>
              {walletTab === 'withdraw' ? (
                <button
                  type="button"
                  className="lwf-btn-primary"
                  onClick={handleWithdraw}
                  disabled={walletSubmitting || !withdrawPreview.ok || balance < withdrawPreview.deducted}
                >
                  {walletSubmitting ? <Loader2 className="ic-action-spin" size={14} /> : <ArrowUpRight size={14} />}
                  确认提现
                </button>
              ) : (
                <button
                  type="button"
                  className="lwf-btn-primary"
                  onClick={handleTopup}
                  disabled={walletSubmitting || !topupPreview.ok}
                >
                  {walletSubmitting ? <Loader2 className="ic-action-spin" size={14} /> : <ArrowDownLeft size={14} />}
                  确认充值
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .lucky-store {
          --text-main: #0f172a;
          --text-light: #64748b;
          --card-bg: rgba(255, 255, 255, 0.7);
          --card-border: rgba(255, 255, 255, 1);
          --card-shadow: 0 24px 48px rgba(15, 23, 42, 0.06);

          --c-green: #10b981;
          --c-purple: #8b5cf6;
          --c-orange: #f97316;
          --c-red: #f43f5e;
          --c-blue: #3b82f6;
          --c-cyan: #06b6d4;
          --c-pink: #ec4899;
          --c-amber: #fbbf24;

          --grad-primary: linear-gradient(135deg, #ff7a00, #ff004c);
          --grad-gold: linear-gradient(135deg, #fde047, #f59e0b 50%, #ea580c);
          --grad-orange: linear-gradient(135deg, #fb923c, #f97316);
          --grad-pink: linear-gradient(135deg, #fb7185, #ec4899);
          --grad-blue: linear-gradient(135deg, #60a5fa, #3b82f6);
          --grad-cyan: linear-gradient(135deg, #22d3ee, #06b6d4);
          --grad-purple: linear-gradient(135deg, #a78bfa, #8b5cf6);
          --grad-green: linear-gradient(135deg, #34d399, #10b981);
          --grad-amber: linear-gradient(135deg, #fde047, #fbbf24);

          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
          background-color: #f8fafc;
          color: var(--text-main);
          min-height: 100vh;
          position: relative;
          isolation: isolate;
          -webkit-font-smoothing: antialiased;
          -webkit-tap-highlight-color: transparent;
        }

        .lucky-store * { box-sizing: border-box; }
        .lucky-store a { color: inherit; text-decoration: none; }
        .lucky-store button { font-family: inherit; }

        .lucky-store .mesh-bg {
          position: fixed;
          inset: 0;
          z-index: -2;
          background-image:
            radial-gradient(circle at 15% 50%, rgba(255, 228, 230, 0.85) 0%, transparent 50%),
            radial-gradient(circle at 85% 30%, rgba(255, 237, 213, 0.85) 0%, transparent 50%),
            radial-gradient(circle at 50% 90%, rgba(254, 243, 199, 0.85) 0%, transparent 50%),
            radial-gradient(circle at 50% 10%, rgba(255, 228, 196, 0.85) 0%, transparent 50%);
          filter: blur(60px);
          animation: lwfFluid 15s infinite alternate ease-in-out;
        }

        @keyframes lwfFluid {
          0% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.05) rotate(2deg); }
          100% { transform: scale(1.1) rotate(-2deg); }
        }

        /* topbar：参考 rankings 的简洁样式，主色保持橙色 */
        .lucky-store .topbar {
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

        .lucky-store .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: var(--text-main);
          flex-shrink: 0;
        }
        .lucky-store .brand-icon {
          width: 36px;
          height: 36px;
          background: var(--grad-primary);
          border-radius: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 16px rgba(255, 122, 0, 0.3);
        }
        .lucky-store .brand-icon svg {
          width: 20px;
          height: 20px;
          color: #fff;
          stroke-width: 2.5;
        }

        .lucky-store .topbar-right {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }

        .lucky-store .topbar .btn-icon {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.9);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--text-light);
          transition: all 0.2s;
          cursor: pointer;
        }
        .lucky-store .topbar .btn-icon svg { width: 16px; height: 16px; }
        .lucky-store .topbar .btn-icon:hover { background: #fff; color: var(--c-orange); transform: translateY(-1px); }

        .lucky-store .user-profile {
          display: inline-flex;
          align-items: center;
          gap: 12px;
          padding: 5px 16px 5px 5px;
          background: #ffffff;
          border-radius: 999px;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.04);
          cursor: pointer;
          transition: transform 0.2s;
        }
        .lucky-store .user-profile:hover { transform: scale(1.02); }
        .lucky-store .user-profile .avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
          color: #475569;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 14px;
          flex-shrink: 0;
          overflow: hidden;
          text-transform: uppercase;
        }
        .lucky-store .user-profile .avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: inherit;
          display: block;
        }
        .lucky-store .user-info h4 {
          font-size: 13px;
          font-weight: 700;
          line-height: 1.2;
          margin: 0;
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .lucky-store .user-info p {
          font-size: 11px;
          color: var(--text-light);
          margin: 1px 0 0;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          max-width: 150px;
        }

        .lucky-store .user-info .nav-achievement-line {
          width: 100%;
          min-width: 0;
        }

        .lucky-store .nav-achievement {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
          color: #92400e;
          font-weight: 800;
        }

        .lucky-store .nav-achievement.empty {
          color: var(--text-light);
          font-weight: 700;
        }

        .lucky-store .nav-achievement-emoji {
          flex: 0 0 auto;
          font-size: 11px;
          line-height: 1;
        }

        .lucky-store .nav-achievement-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .lucky-store .user-info p .rank-pill {
          background: var(--grad-gold);
          color: #fff;
          padding: 1px 7px;
          border-radius: 999px;
          font-weight: 800;
          font-size: 10px;
          letter-spacing: 0.3px;
        }

        /* container */
        .lucky-store .container {
          max-width: 1600px;
          margin: 0 auto;
          padding: 32px 48px 64px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        /* hero */
        .lucky-store .store-hero {
          position: relative;
          padding: 36px 40px;
          border-radius: 36px;
          background:
            /* 左上角暗化蒙层（保证标题与副文可读） */
            linear-gradient(
              to bottom right,
              rgba(66, 32, 6, 0.72) 0%,
              rgba(66, 32, 6, 0.32) 32%,
              transparent 55%
            ),
            /* 右上角暗化蒙层（保证积分玻璃卡可读） */
            linear-gradient(
              to bottom left,
              rgba(66, 32, 6, 0.58) 0%,
              rgba(66, 32, 6, 0.22) 30%,
              transparent 55%
            ),
            /* 主图 */
            url('/images/store/hero.webp') center 45% / cover no-repeat,
            /* 兜底渐变（图片未加载时呈现原配色） */
            linear-gradient(135deg, #422006 0%, #92400e 25%, #ea580c 55%, #f59e0b 100%);
          color: #fff;
          overflow: hidden;
          box-shadow: 0 30px 60px rgba(146, 64, 14, 0.4);
        }
        .lucky-store .store-hero::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            radial-gradient(circle at 50% 100%, rgba(255, 255, 255, 0.12), transparent 60%);
          pointer-events: none;
        }
        .lucky-store .store-hero::after {
          content: '';
          position: absolute;
          top: -40%;
          right: -10%;
          width: 480px;
          height: 480px;
          background: radial-gradient(circle, rgba(253, 224, 71, 0.22), transparent 60%);
          filter: blur(60px);
          pointer-events: none;
          animation: lwfGlowPulse 4.5s ease-in-out infinite;
          mix-blend-mode: screen;
        }
        @keyframes lwfGlowPulse {
          0%, 100% { transform: scale(1); opacity: 0.65; }
          50% { transform: scale(1.18); opacity: 1; }
        }
        .lucky-store .stars { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
        .lucky-store .star { position: absolute; color: rgba(255, 255, 255, 0.7); animation: lwfTwinkle 3s ease-in-out infinite; }
        @keyframes lwfTwinkle {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }

        .lucky-store .hero-content {
          position: relative;
          z-index: 2;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 32px;
          flex-wrap: wrap;
        }
        .lucky-store .hero-text {
          flex: 1;
          min-width: 280px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .lucky-store .hero-points-wrap { flex-shrink: 0; }
        .lucky-store .hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          background: rgba(253, 224, 71, 0.22);
          border: 1px solid rgba(253, 224, 71, 0.45);
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          color: #fde047;
          letter-spacing: 1px;
          backdrop-filter: blur(10px);
          width: fit-content;
        }
        .lucky-store .hero-badge svg { width: 12px; height: 12px; }
        .lucky-store .hero-title {
          font-size: 46px;
          font-weight: 900;
          letter-spacing: -1.5px;
          line-height: 1.05;
          margin: 0;
          text-shadow: 0 2px 18px rgba(0, 0, 0, 0.55);
        }
        .lucky-store .hero-title .glow {
          background: linear-gradient(135deg, #fde047, #fed7aa);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          text-shadow: 0 2px 14px rgba(0, 0, 0, 0.6), 0 0 40px rgba(253, 224, 71, 0.5);
          filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5));
        }
        .lucky-store .hero-sub {
          font-size: 15px;
          color: rgba(255, 255, 255, 0.92);
          line-height: 1.6;
          max-width: 580px;
          margin: 0;
          text-shadow: 0 1px 6px rgba(0, 0, 0, 0.45);
        }

        .lucky-store .hero-points-card {
          display: inline-flex;
          align-items: center;
          gap: 18px;
          padding: 16px 22px;
          background: rgba(66, 32, 6, 0.55);
          border: 1px solid rgba(255, 255, 255, 0.32);
          border-radius: 22px;
          backdrop-filter: blur(22px);
          width: fit-content;
          box-shadow: 0 18px 36px rgba(0, 0, 0, 0.35);
        }
        .lucky-store .hpc-star {
          width: 50px;
          height: 50px;
          border-radius: 50%;
          background: var(--grad-amber);
          display: flex; align-items: center; justify-content: center;
          color: #fff;
          box-shadow: 0 10px 20px rgba(251, 191, 36, 0.45);
        }
        .lucky-store .hpc-star svg { width: 22px; height: 22px; }
        .lucky-store .hpc-info { display: flex; flex-direction: column; gap: 2px; }
        .lucky-store .hpc-label {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 700;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        .lucky-store .hpc-value {
          font-size: 32px;
          font-weight: 900;
          line-height: 1;
          background: linear-gradient(135deg, #fde047, #fed7aa);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          letter-spacing: -1px;
        }
        .lucky-store .hpc-value .unit {
          font-size: 14px;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 700;
          margin-left: 4px;
          -webkit-text-fill-color: rgba(255, 255, 255, 0.7);
          background: none;
        }

        /* 消息 */
        .lucky-store .store-message {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 18px;
          border-radius: 16px;
          font-size: 13.5px;
          font-weight: 600;
          border: 1px solid;
          backdrop-filter: blur(20px);
        }
        .lucky-store .store-message.success { background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.25); color: var(--c-green); }
        .lucky-store .store-message.error { background: rgba(244, 63, 94, 0.08); border-color: rgba(244, 63, 94, 0.25); color: var(--c-red); }
        .lucky-store .store-message svg { width: 18px; height: 18px; flex-shrink: 0; }
        .lucky-store .store-message-close {
          margin-left: auto;
          width: 26px; height: 26px;
          display: inline-flex; align-items: center; justify-content: center;
          background: rgba(15, 23, 42, 0.05);
          border: none;
          border-radius: 50%;
          color: inherit;
          cursor: pointer;
          opacity: 0.6;
          transition: opacity 0.2s;
        }
        .lucky-store .store-message-close:hover { opacity: 1; }
        .lucky-store .store-message-close svg { width: 14px; height: 14px; }

        /* page header */
        .lucky-store .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 16px;
          flex-wrap: wrap;
        }
        .lucky-store .header-left .section-title {
          font-size: 32px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 14px;
          color: var(--text-main);
          margin: 0 0 6px;
          letter-spacing: -0.8px;
        }
        .lucky-store .section-title .title-icon {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: var(--grad-orange);
          display: flex; align-items: center; justify-content: center;
          color: #fff;
          box-shadow: 0 12px 24px rgba(249, 115, 22, 0.32);
          position: relative;
        }
        .lucky-store .section-title .title-icon svg { width: 22px; height: 22px; }
        .lucky-store .section-title .title-icon::after {
          content: '';
          position: absolute;
          inset: -4px;
          border-radius: 18px;
          background: var(--grad-orange);
          opacity: 0.3;
          filter: blur(10px);
          z-index: -1;
        }
        .lucky-store .header-subtitle {
          font-size: 14px;
          color: var(--text-light);
          line-height: 1.6;
          max-width: 640px;
          margin: 0;
        }
        .lucky-store .header-actions { display: flex; gap: 10px; align-items: center; }
        .lucky-store .btn-icon {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.9);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          color: var(--text-light);
          transition: all 0.2s;
        }
        .lucky-store .btn-icon svg { width: 16px; height: 16px; }
        .lucky-store .btn-icon:hover:not(:disabled) { background: #fff; color: var(--text-main); }
        .lucky-store .btn-icon:disabled { opacity: 0.5; cursor: not-allowed; }
        .lucky-store .btn-icon.spinning svg { animation: lwfRotate 0.6s ease; }
        @keyframes lwfRotate {
          from { transform: rotate(0); }
          to { transform: rotate(360deg); }
        }

        /* 数据卡 */
        .lucky-store .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 18px;
        }
        .lucky-store .stat-card {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.55));
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 24px;
          padding: 22px 24px;
          box-shadow: var(--card-shadow), inset 0 1px 0 rgba(255, 255, 255, 1);
          position: relative;
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .lucky-store .stat-card::before {
          content: '';
          position: absolute;
          top: -50%;
          right: -30%;
          width: 200px;
          height: 200px;
          border-radius: 50%;
          opacity: 0.3;
          filter: blur(40px);
          pointer-events: none;
          transition: opacity 0.3s;
        }
        .lucky-store .stat-card.t-amber::before { background: rgba(251, 191, 36, 0.5); }
        .lucky-store .stat-card.t-orange::before { background: rgba(249, 115, 22, 0.4); }
        .lucky-store .stat-card.t-green::before { background: rgba(16, 185, 129, 0.4); }
        .lucky-store .stat-card.t-purple::before { background: rgba(139, 92, 246, 0.4); }
        .lucky-store .stat-card:hover { transform: translateY(-3px); box-shadow: 0 24px 48px rgba(15, 23, 42, 0.08); }
        .lucky-store .stat-card:hover::before { opacity: 0.5; }
        .lucky-store .stat-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; position: relative; z-index: 1; }
        .lucky-store .stat-icon {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          background: #fff;
          position: relative;
          flex-shrink: 0;
        }
        .lucky-store .stat-icon svg { width: 18px; height: 18px; }
        .lucky-store .stat-icon::after {
          content: '';
          position: absolute;
          inset: -3px;
          border-radius: 14px;
          opacity: 0.25;
          filter: blur(8px);
          z-index: -1;
        }
        .lucky-store .stat-card.t-amber .stat-icon { color: #d97706; box-shadow: 0 8px 16px rgba(251, 191, 36, 0.3); }
        .lucky-store .stat-card.t-amber .stat-icon::after { background: var(--c-amber); }
        .lucky-store .stat-card.t-orange .stat-icon { color: var(--c-orange); box-shadow: 0 8px 16px rgba(249, 115, 22, 0.25); }
        .lucky-store .stat-card.t-orange .stat-icon::after { background: var(--c-orange); }
        .lucky-store .stat-card.t-green .stat-icon { color: var(--c-green); box-shadow: 0 8px 16px rgba(16, 185, 129, 0.25); }
        .lucky-store .stat-card.t-green .stat-icon::after { background: var(--c-green); }
        .lucky-store .stat-card.t-purple .stat-icon { color: var(--c-purple); box-shadow: 0 8px 16px rgba(139, 92, 246, 0.25); }
        .lucky-store .stat-card.t-purple .stat-icon::after { background: var(--c-purple); }
        .lucky-store .stat-label { font-size: 12px; font-weight: 700; color: var(--text-light); letter-spacing: 0.3px; }
        .lucky-store .stat-value-row { display: flex; align-items: baseline; gap: 6px; position: relative; z-index: 1; }
        .lucky-store .stat-value {
          font-size: 32px;
          font-weight: 900;
          color: var(--text-main);
          letter-spacing: -1px;
          line-height: 1;
        }
        .lucky-store .stat-card.t-amber .stat-value { background: var(--grad-gold); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .lucky-store .stat-card.t-orange .stat-value { background: var(--grad-orange); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .lucky-store .stat-unit { font-size: 13px; color: var(--text-light); font-weight: 700; }

        /* 筛选栏 */
        .lucky-store .filter-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }
        .lucky-store .filter-tabs {
          display: flex;
          gap: 6px;
          background: rgba(255, 255, 255, 0.65);
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 999px;
          padding: 5px;
          backdrop-filter: blur(10px);
          flex-wrap: wrap;
        }
        .lucky-store .filter-tab {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 9px 18px;
          border: none;
          background: transparent;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 700;
          color: var(--text-light);
          cursor: pointer;
          transition: all 0.25s ease;
          white-space: nowrap;
        }
        .lucky-store .filter-tab:hover { color: var(--text-main); background: rgba(255, 255, 255, 0.7); }
        .lucky-store .filter-tab.active {
          background: var(--grad-primary);
          color: #fff;
          box-shadow: 0 8px 16px rgba(255, 122, 0, 0.35);
        }
        .lucky-store .filter-tab .count {
          background: rgba(255, 255, 255, 0.25);
          padding: 1px 8px;
          border-radius: 999px;
          font-size: 10.5px;
          font-weight: 800;
        }
        .lucky-store .filter-tab:not(.active) .count { background: rgba(15, 23, 42, 0.06); color: var(--text-light); }

        .lucky-store .search-box {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 0 18px;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 999px;
          backdrop-filter: blur(10px);
          min-height: 42px;
          min-width: 240px;
        }
        .lucky-store .search-box svg { width: 14px; height: 14px; color: var(--text-light); flex-shrink: 0; }
        .lucky-store .search-box input {
          border: none;
          outline: none;
          background: transparent;
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-main);
          flex: 1;
        }
        .lucky-store .search-box input::placeholder { color: var(--text-light); }

        /* group title */
        .lucky-store .group-title {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 4px;
          gap: 16px;
          flex-wrap: wrap;
        }
        .lucky-store .group-title h3 {
          font-size: 22px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 12px;
          color: var(--text-main);
          letter-spacing: -0.4px;
          margin: 0;
        }
        .lucky-store .group-title .grp-icon {
          width: 36px;
          height: 36px;
          border-radius: 11px;
          display: flex; align-items: center; justify-content: center;
          color: #fff;
        }
        .lucky-store .group-title .grp-icon svg { width: 18px; height: 18px; }
        .lucky-store .grp-icon.free { background: var(--grad-orange); box-shadow: 0 8px 16px rgba(249, 115, 22, 0.3); }
        .lucky-store .grp-icon.points { background: var(--grad-amber); box-shadow: 0 8px 16px rgba(251, 191, 36, 0.4); color: #92400e; }
        .lucky-store .group-title .grp-count {
          font-size: 12px;
          font-weight: 800;
          background: rgba(15, 23, 42, 0.05);
          color: var(--text-light);
          padding: 4px 12px;
          border-radius: 999px;
        }

        /* items grid */
        .lucky-store .items-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 22px;
        }
        .lucky-store .item-card {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.6));
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 28px;
          padding: 26px;
          box-shadow: var(--card-shadow), inset 0 1px 0 rgba(255, 255, 255, 1);
          position: relative;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 16px;
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          min-height: 330px;
          color: inherit;
        }
        .lucky-store .item-card::before {
          content: '';
          position: absolute;
          top: -40%;
          right: -30%;
          width: 280px;
          height: 280px;
          border-radius: 50%;
          opacity: 0.35;
          filter: blur(50px);
          pointer-events: none;
          transition: opacity 0.4s;
        }
        .lucky-store .item-card.t-orange::before { background: rgba(249, 115, 22, 0.5); }
        .lucky-store .item-card.t-purple::before { background: rgba(139, 92, 246, 0.45); }
        .lucky-store .item-card.t-pink::before { background: rgba(236, 72, 153, 0.45); }
        .lucky-store .item-card.t-blue::before { background: rgba(59, 130, 246, 0.45); }
        .lucky-store .item-card.t-cyan::before { background: rgba(6, 182, 212, 0.45); }
        .lucky-store .item-card.t-green::before { background: rgba(16, 185, 129, 0.45); }
        .lucky-store .item-card:hover {
          transform: translateY(-6px);
          box-shadow: 0 32px 64px rgba(15, 23, 42, 0.1);
          background: rgba(255, 255, 255, 0.95);
        }
        .lucky-store .item-card:hover::before { opacity: 0.55; }

        .lucky-store .corner-tag {
          position: absolute;
          top: 16px;
          right: 16px;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.3px;
          z-index: 2;
        }
        .lucky-store .corner-tag.discount {
          background: linear-gradient(135deg, #f43f5e, #ec4899);
          color: #fff;
          box-shadow: 0 6px 12px rgba(244, 63, 94, 0.35);
        }
        .lucky-store .corner-tag.hot {
          background: var(--grad-primary);
          color: #fff;
          box-shadow: 0 6px 12px rgba(255, 122, 0, 0.35);
        }

        .lucky-store .ic-head { display: flex; align-items: flex-start; gap: 14px; position: relative; z-index: 1; }
        .lucky-store .ic-icon {
          width: 56px;
          height: 56px;
          border-radius: 18px;
          display: flex; align-items: center; justify-content: center;
          background: #fff;
          position: relative;
          flex-shrink: 0;
        }
        .lucky-store .ic-icon svg { width: 26px; height: 26px; }
        .lucky-store .ic-icon::after {
          content: '';
          position: absolute;
          inset: -4px;
          border-radius: 22px;
          opacity: 0.35;
          filter: blur(10px);
          z-index: -1;
        }
        .lucky-store .item-card.t-orange .ic-icon { color: #fff; background: var(--grad-orange); box-shadow: 0 12px 24px rgba(249, 115, 22, 0.35); }
        .lucky-store .item-card.t-orange .ic-icon::after { background: var(--c-orange); }
        .lucky-store .item-card.t-purple .ic-icon { color: #fff; background: var(--grad-purple); box-shadow: 0 12px 24px rgba(139, 92, 246, 0.35); }
        .lucky-store .item-card.t-purple .ic-icon::after { background: var(--c-purple); }
        .lucky-store .item-card.t-pink .ic-icon { color: #fff; background: var(--grad-pink); box-shadow: 0 12px 24px rgba(236, 72, 153, 0.35); }
        .lucky-store .item-card.t-pink .ic-icon::after { background: var(--c-pink); }
        .lucky-store .item-card.t-blue .ic-icon { color: #fff; background: var(--grad-blue); box-shadow: 0 12px 24px rgba(59, 130, 246, 0.35); }
        .lucky-store .item-card.t-blue .ic-icon::after { background: var(--c-blue); }
        .lucky-store .item-card.t-cyan .ic-icon { color: #fff; background: var(--grad-cyan); box-shadow: 0 12px 24px rgba(6, 182, 212, 0.35); }
        .lucky-store .item-card.t-cyan .ic-icon::after { background: var(--c-cyan); }
        .lucky-store .item-card.t-green .ic-icon { color: #fff; background: var(--grad-green); box-shadow: 0 12px 24px rgba(16, 185, 129, 0.35); }
        .lucky-store .item-card.t-green .ic-icon::after { background: var(--c-green); }

        .lucky-store .ic-title-area { flex: 1; min-width: 0; padding-top: 2px; }
        .lucky-store .ic-title {
          font-size: 18px;
          font-weight: 900;
          color: var(--text-main);
          letter-spacing: -0.3px;
          line-height: 1.3;
          margin-bottom: 8px;
        }
        .lucky-store .ic-tags { display: flex; gap: 6px; flex-wrap: wrap; }
        .lucky-store .ic-tag {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 10.5px;
          font-weight: 800;
          padding: 3px 9px;
          border-radius: 6px;
          letter-spacing: 0.3px;
        }
        .lucky-store .ic-tag.cat-lottery { background: rgba(6, 182, 212, 0.12); color: #0e7490; }
        .lucky-store .ic-tag.cat-card { background: rgba(59, 130, 246, 0.12); color: var(--c-blue); }
        .lucky-store .ic-tag.cat-topup { background: rgba(16, 185, 129, 0.12); color: var(--c-green); }
        .lucky-store .ic-tag.cat-makeup { background: rgba(16, 185, 129, 0.12); color: var(--c-green); }
        .lucky-store .ic-tag.cat-welfare { background: rgba(249, 115, 22, 0.12); color: var(--c-orange); }
        .lucky-store .ic-tag.cat-raffle { background: rgba(236, 72, 153, 0.12); color: var(--c-pink); }
        .lucky-store .ic-tag.limit { background: rgba(15, 23, 42, 0.05); color: var(--text-light); }
        .lucky-store .ic-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.3px;
        }
        .lucky-store .ic-status .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          position: relative;
        }
        .lucky-store .ic-status .dot::after {
          content: '';
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          opacity: 0.5;
          animation: lwfPulseDot 2s ease-in-out infinite;
        }
        .lucky-store .ic-status.active { background: rgba(16, 185, 129, 0.12); color: var(--c-green); }
        .lucky-store .ic-status.active .dot { background: var(--c-green); }
        .lucky-store .ic-status.active .dot::after { background: var(--c-green); }
        @keyframes lwfPulseDot {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.6); opacity: 0; }
        }

        .lucky-store .ic-desc {
          font-size: 13.5px;
          color: var(--text-light);
          font-weight: 500;
          line-height: 1.5;
          position: relative;
          z-index: 1;
          flex: 1;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .lucky-store .ic-progress-section { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 6px; margin-top: -4px; }
        .lucky-store .ic-progress-text {
          display: flex;
          justify-content: space-between;
          font-size: 11.5px;
          font-weight: 700;
          color: var(--text-light);
        }
        .lucky-store .ic-progress-text .num { font-weight: 900; font-size: 12.5px; color: var(--text-main); }
        .lucky-store .item-card.t-orange .ic-progress-text .num.received { color: var(--c-orange); }
        .lucky-store .item-card.t-purple .ic-progress-text .num.received { color: var(--c-purple); }
        .lucky-store .item-card.t-pink .ic-progress-text .num.received { color: var(--c-pink); }
        .lucky-store .item-card.t-cyan .ic-progress-text .num.received { color: var(--c-cyan); }
        .lucky-store .item-card.t-green .ic-progress-text .num.received { color: var(--c-green); }
        .lucky-store .ic-progress-track {
          height: 7px;
          background: rgba(15, 23, 42, 0.06);
          border-radius: 999px;
          overflow: hidden;
          position: relative;
        }
        .lucky-store .ic-progress-bar {
          height: 100%;
          border-radius: 999px;
          position: relative;
          transition: width 1s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .lucky-store .ic-progress-bar::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.6), transparent);
          animation: lwfShimmer 2.5s linear infinite;
        }
        @keyframes lwfShimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .lucky-store .item-card.t-orange .ic-progress-bar { background: var(--grad-orange); box-shadow: 0 0 10px rgba(249, 115, 22, 0.4); }
        .lucky-store .item-card.t-purple .ic-progress-bar { background: var(--grad-purple); box-shadow: 0 0 10px rgba(139, 92, 246, 0.4); }
        .lucky-store .item-card.t-pink .ic-progress-bar { background: var(--grad-pink); box-shadow: 0 0 10px rgba(236, 72, 153, 0.4); }
        .lucky-store .item-card.t-cyan .ic-progress-bar { background: var(--grad-cyan); box-shadow: 0 0 10px rgba(6, 182, 212, 0.4); }
        .lucky-store .item-card.t-green .ic-progress-bar { background: var(--grad-green); box-shadow: 0 0 10px rgba(16, 185, 129, 0.4); }

        .lucky-store .ic-foot {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 16px;
          border-top: 1px dashed rgba(15, 23, 42, 0.1);
          position: relative;
          z-index: 1;
          gap: 12px;
          margin-top: auto;
        }
        .lucky-store .ic-price { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .lucky-store .ic-price-label {
          font-size: 11px;
          color: var(--text-light);
          font-weight: 700;
          letter-spacing: 0.3px;
          text-transform: uppercase;
        }
        .lucky-store .ic-price-row { display: flex; align-items: baseline; gap: 4px; }
        .lucky-store .ic-price-num {
          font-size: 24px;
          font-weight: 900;
          color: var(--text-main);
          letter-spacing: -0.6px;
          line-height: 1;
        }
        .lucky-store .ic-price-num.points-color { background: var(--grad-gold); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .lucky-store .ic-price-num.welfare-free-color { background: var(--grad-orange); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; font-size: 22px; }
        .lucky-store .ic-price-num.raffle-free-color { background: var(--grad-pink); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; font-size: 22px; }
        .lucky-store .ic-price-unit { font-size: 12px; color: var(--text-light); font-weight: 700; }

        .lucky-store .ic-action-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 11px 20px;
          border-radius: 999px;
          border: none;
          font-family: inherit;
          font-size: 13px;
          font-weight: 800;
          color: #fff;
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
          overflow: hidden;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .lucky-store .ic-action-btn.dark { background: linear-gradient(135deg, #1e293b, #0f172a); box-shadow: 0 10px 20px rgba(15, 23, 42, 0.25); }
        .lucky-store .ic-action-btn.primary { background: var(--grad-primary); box-shadow: 0 10px 20px rgba(255, 122, 0, 0.35); }
        .lucky-store .ic-action-btn.orange { background: var(--grad-orange); box-shadow: 0 10px 20px rgba(249, 115, 22, 0.35); }
        .lucky-store .ic-action-btn.purple { background: var(--grad-purple); box-shadow: 0 10px 20px rgba(139, 92, 246, 0.35); }
        .lucky-store .ic-action-btn.pink { background: var(--grad-pink); box-shadow: 0 10px 20px rgba(236, 72, 153, 0.35); }
        .lucky-store .ic-action-btn.blue { background: var(--grad-blue); box-shadow: 0 10px 20px rgba(59, 130, 246, 0.35); }
        .lucky-store .ic-action-btn.cyan { background: var(--grad-cyan); box-shadow: 0 10px 20px rgba(6, 182, 212, 0.35); }
        .lucky-store .ic-action-btn.green { background: var(--grad-green); box-shadow: 0 10px 20px rgba(16, 185, 129, 0.35); }
        .lucky-store .ic-action-btn::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
          transform: translateX(-100%);
          transition: transform 0.6s;
        }
        .lucky-store .ic-action-btn:hover:not(:disabled):not(.disabled) { transform: translateY(-2px) scale(1.03); }
        .lucky-store .ic-action-btn:hover:not(:disabled):not(.disabled)::before { transform: translateX(100%); }
        .lucky-store .ic-action-btn.disabled,
        .lucky-store .ic-action-btn:disabled {
          background: rgba(15, 23, 42, 0.06) !important;
          color: var(--text-light) !important;
          box-shadow: none !important;
          cursor: not-allowed;
        }
        .lucky-store .ic-action-btn.disabled::before,
        .lucky-store .ic-action-btn:disabled::before { display: none; }
        .lucky-store .ic-action-spin { animation: lwfSpin 0.8s linear infinite; }

        /* 空状态 */
        .lucky-store .empty-state {
          padding: 60px 24px;
          text-align: center;
          background: rgba(255, 255, 255, 0.65);
          border: 1px dashed rgba(15, 23, 42, 0.12);
          border-radius: 28px;
          backdrop-filter: blur(20px);
        }
        .lucky-store .empty-state .empty-icon {
          width: 64px;
          height: 64px;
          border-radius: 20px;
          margin: 0 auto 16px;
          display: flex; align-items: center; justify-content: center;
          background: rgba(15, 23, 42, 0.04);
          color: var(--text-light);
        }
        .lucky-store .empty-state .empty-icon svg { width: 28px; height: 28px; }
        .lucky-store .empty-state h3 { font-size: 17px; font-weight: 800; color: var(--text-main); margin: 0 0 6px; }
        .lucky-store .empty-state p { font-size: 13.5px; color: var(--text-light); margin: 0; }

        /* modal */
        .lucky-store .lwf-modal-mask {
          position: fixed;
          inset: 0;
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }
        .lucky-store .lwf-modal-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
        }
        .lucky-store .lwf-modal {
          position: relative;
          background: #fff;
          border-radius: 24px;
          width: 100%;
          max-width: 460px;
          max-height: calc(100vh - 48px);
          display: flex;
          flex-direction: column;
          box-shadow: 0 32px 64px rgba(15, 23, 42, 0.2);
          overflow: hidden;
          animation: lwfSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .lucky-store .lwf-modal-rules { max-width: 560px; }
        .lucky-store .lwf-modal-wallet { max-width: 520px; }
        @keyframes lwfSlideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .lucky-store .lwf-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px;
          border-bottom: 1px solid rgba(15, 23, 42, 0.06);
        }
        .lucky-store .lwf-modal-header h3 {
          font-size: 16px;
          font-weight: 800;
          margin: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          letter-spacing: -0.3px;
        }
        .lucky-store .lwf-modal-header h3 svg { width: 18px; height: 18px; color: var(--c-orange); }
        .lucky-store .lwf-modal-close {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: none;
          background: rgba(15, 23, 42, 0.05);
          color: var(--text-light);
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
          transition: all 0.2s;
        }
        .lucky-store .lwf-modal-close svg { width: 16px; height: 16px; }
        .lucky-store .lwf-modal-close:hover { background: rgba(244, 63, 94, 0.12); color: var(--c-red); }
        .lucky-store .lwf-modal-body { padding: 22px 24px; overflow-y: auto; flex: 1; min-height: 0; }
        .lucky-store .lwf-modal-tip {
          font-size: 13px;
          color: var(--text-light);
          margin: 0 0 16px;
          font-weight: 600;
        }
        .lucky-store .lwf-modal-footer {
          padding: 16px 24px;
          border-top: 1px solid rgba(15, 23, 42, 0.06);
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }

        .lucky-store .qty-row {
          display: flex;
          align-items: stretch;
          gap: 10px;
        }

        .lucky-store .qty-modal {
          --qty-color: var(--c-cyan);
          --qty-grad: var(--grad-cyan);
          --qty-soft: rgba(6, 182, 212, 0.07);
          --qty-border: rgba(6, 182, 212, 0.2);
          --qty-focus: rgba(6, 182, 212, 0.14);
          --qty-shadow: rgba(6, 182, 212, 0.28);
        }
        .lucky-store .qty-modal.qty-theme-blue {
          --qty-color: var(--c-blue);
          --qty-grad: var(--grad-blue);
          --qty-soft: rgba(59, 130, 246, 0.07);
          --qty-border: rgba(59, 130, 246, 0.2);
          --qty-focus: rgba(59, 130, 246, 0.14);
          --qty-shadow: rgba(59, 130, 246, 0.28);
        }
        .lucky-store .qty-modal.qty-theme-green {
          --qty-color: var(--c-green);
          --qty-grad: var(--grad-green);
          --qty-soft: rgba(16, 185, 129, 0.07);
          --qty-border: rgba(16, 185, 129, 0.2);
          --qty-focus: rgba(16, 185, 129, 0.14);
          --qty-shadow: rgba(16, 185, 129, 0.28);
        }
        .lucky-store .qty-modal.qty-theme-cyan {
          --qty-color: var(--c-cyan);
          --qty-grad: var(--grad-cyan);
          --qty-soft: rgba(6, 182, 212, 0.07);
          --qty-border: rgba(6, 182, 212, 0.2);
          --qty-focus: rgba(6, 182, 212, 0.14);
          --qty-shadow: rgba(6, 182, 212, 0.28);
        }
        .lucky-store .qty-modal.qty-theme-orange {
          --qty-color: var(--c-orange);
          --qty-grad: var(--grad-orange);
          --qty-soft: rgba(249, 115, 22, 0.07);
          --qty-border: rgba(249, 115, 22, 0.2);
          --qty-focus: rgba(249, 115, 22, 0.14);
          --qty-shadow: rgba(249, 115, 22, 0.28);
        }
        .lucky-store .qty-modal.qty-theme-pink {
          --qty-color: var(--c-pink);
          --qty-grad: var(--grad-pink);
          --qty-soft: rgba(236, 72, 153, 0.07);
          --qty-border: rgba(236, 72, 153, 0.2);
          --qty-focus: rgba(236, 72, 153, 0.14);
          --qty-shadow: rgba(236, 72, 153, 0.28);
        }
        .lucky-store .qty-modal .lwf-modal-header h3 svg {
          color: var(--qty-color);
        }

        .lucky-store .qty-btn {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          border: 1px solid var(--qty-border);
          background: var(--qty-soft);
          color: var(--qty-color);
          cursor: pointer;
          display: inline-flex; align-items: center; justify-content: center;
          transition: all 0.2s;
        }
        .lucky-store .qty-btn:hover:not(:disabled) {
          background: #fff;
          border-color: var(--qty-color);
          color: var(--qty-color);
          box-shadow: 0 8px 16px var(--qty-shadow);
        }
        .lucky-store .qty-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .lucky-store .qty-btn svg { width: 16px; height: 16px; }
        .lucky-store .qty-input {
          flex: 1;
          height: 42px;
          border-radius: 12px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: #f8fafc;
          font-family: inherit;
          font-size: 16px;
          font-weight: 800;
          text-align: center;
          color: var(--text-main);
          outline: none;
          transition: all 0.2s;
        }
        .lucky-store .qty-input:focus {
          background: #fff;
          border-color: var(--qty-color);
          box-shadow: 0 0 0 3px var(--qty-focus);
        }

        .lucky-store .qty-summary {
          margin-top: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 14px;
          background: var(--qty-soft);
          border: 1px solid var(--qty-border);
          border-radius: 14px;
          font-size: 13.5px;
          color: var(--text-main);
        }
        .lucky-store .qty-summary strong { color: var(--qty-color); font-size: 16px; }
        .lucky-store .qty-hint {
          font-size: 12px;
          color: var(--text-light);
          margin: 10px 0 0;
        }

        .lucky-store .lwf-btn-secondary {
          padding: 10px 18px;
          background: #f1f5f9;
          color: var(--text-main);
          border: 1px solid rgba(15, 23, 42, 0.06);
          border-radius: 12px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s;
        }
        .lucky-store .lwf-btn-secondary:hover:not(:disabled) { background: #e2e8f0; }
        .lucky-store .lwf-btn-secondary:disabled { opacity: 0.6; cursor: not-allowed; }

        .lucky-store .lwf-btn-primary {
          padding: 10px 22px;
          background: var(--grad-primary);
          color: #fff;
          border: none;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s;
          box-shadow: 0 8px 18px rgba(255, 122, 0, 0.25);
        }
        .lucky-store .lwf-btn-primary:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 22px rgba(255, 122, 0, 0.32);
        }
        .lucky-store .lwf-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
        .lucky-store .qty-modal .lwf-btn-primary {
          background: var(--qty-grad);
          box-shadow: 0 8px 18px var(--qty-shadow);
        }
        .lucky-store .qty-modal .lwf-btn-primary:hover:not(:disabled) {
          box-shadow: 0 10px 22px var(--qty-shadow);
        }

        /* rules list */
        .lucky-store .rules-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .lucky-store .rules-list li {
          display: flex;
          gap: 16px;
          padding: 14px;
          background: #f8fafc;
          border: 1px solid rgba(15, 23, 42, 0.06);
          border-radius: 14px;
        }
        .lucky-store .rules-list h4 {
          font-size: 14px;
          font-weight: 800;
          color: var(--text-main);
          margin: 0 0 4px;
          letter-spacing: -0.2px;
        }
        .lucky-store .rules-list p {
          font-size: 12.5px;
          color: var(--text-light);
          line-height: 1.55;
          margin: 0;
        }
        .lucky-store .rules-list strong { color: var(--c-orange); font-weight: 800; }
        .lucky-store .rule-num {
          flex-shrink: 0;
          width: 30px;
          height: 30px;
          border-radius: 10px;
          background: var(--grad-orange);
          color: #fff;
          font-weight: 900;
          font-size: 11.5px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          letter-spacing: 0.5px;
          box-shadow: 0 6px 12px rgba(249, 115, 22, 0.25);
        }

        /* === 提现充值入口（统计卡的可点击形态） === */
        .lucky-store .stat-card-clickable {
          border: 1px solid rgba(255, 255, 255, 0.9);
          font-family: inherit;
          text-align: left;
          cursor: pointer;
          color: inherit;
          width: 100%;
        }
        .lucky-store .stat-card-clickable .stat-extra {
          margin-top: 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11.5px;
          font-weight: 700;
          color: var(--text-light);
          position: relative;
          z-index: 1;
        }
        .lucky-store .stat-card-clickable .stat-extra-cta {
          color: #b45309;
          letter-spacing: 0.3px;
          transition: transform 0.2s;
        }
        .lucky-store .stat-card-clickable:hover .stat-extra-cta { transform: translateX(3px); }

        /* === 钱包 modal === */
        .lucky-store .wallet-tabs {
          display: flex;
          gap: 6px;
          padding: 14px 24px 0;
          background: #fff;
        }
        .lucky-store .wallet-tab {
          flex: 1;
          padding: 10px 14px;
          background: #f8fafc;
          color: var(--text-light);
          border: 1px solid rgba(15, 23, 42, 0.06);
          border-radius: 14px;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: all 0.2s;
        }
        .lucky-store .wallet-tab:hover:not(:disabled) { background: #fff; color: var(--text-main); }
        .lucky-store .wallet-tab.active {
          background: var(--grad-primary);
          color: #fff;
          border-color: transparent;
          box-shadow: 0 8px 16px rgba(255, 122, 0, 0.3);
        }
        .lucky-store .wallet-tab:disabled { opacity: 0.5; cursor: not-allowed; }

        .lucky-store .wallet-body { padding-top: 16px; }

        .lucky-store .wallet-summary {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 14px 16px;
          background: linear-gradient(135deg, rgba(253, 224, 71, 0.18), rgba(251, 191, 36, 0.08));
          border: 1px solid rgba(251, 191, 36, 0.3);
          border-radius: 14px;
          margin-bottom: 16px;
        }
        .lucky-store .wallet-summary-divider {
          width: 1px;
          height: 32px;
          background: rgba(146, 64, 14, 0.18);
        }
        .lucky-store .wallet-summary-label {
          font-size: 11px;
          color: #92400e;
          font-weight: 700;
          letter-spacing: 0.3px;
          text-transform: uppercase;
        }
        .lucky-store .wallet-summary-value {
          font-size: 20px;
          font-weight: 900;
          color: #92400e;
          margin-top: 2px;
          letter-spacing: -0.3px;
          display: inline-flex;
          align-items: baseline;
          gap: 4px;
        }
        .lucky-store .wallet-summary-unit {
          font-size: 11px;
          color: #b45309;
          font-weight: 700;
        }

        .lucky-store .wallet-field-label {
          display: block;
          font-size: 13px;
          font-weight: 700;
          color: var(--text-main);
          margin-bottom: 8px;
        }
        .lucky-store .wallet-field-row {
          display: flex;
          align-items: stretch;
          gap: 8px;
          margin-bottom: 14px;
        }
        .lucky-store .wallet-input {
          flex: 1;
          height: 44px;
          padding: 0 14px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: #f8fafc;
          border-radius: 12px;
          font-family: inherit;
          font-size: 16px;
          font-weight: 800;
          color: var(--text-main);
          outline: none;
          transition: all 0.2s;
        }
        .lucky-store .wallet-input:focus { background: #fff; border-color: var(--c-orange); box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.12); }
        .lucky-store .wallet-input::-webkit-outer-spin-button,
        .lucky-store .wallet-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .lucky-store .wallet-input { -moz-appearance: textfield; }

        .lucky-store .wallet-input-suffix {
          width: 44px;
          height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--grad-amber);
          color: #92400e;
          font-weight: 900;
          border-radius: 12px;
        }
        .lucky-store .wallet-max-btn {
          padding: 0 16px;
          border-radius: 12px;
          background: rgba(249, 115, 22, 0.08);
          border: 1px solid rgba(249, 115, 22, 0.25);
          color: var(--c-orange);
          font-weight: 800;
          font-size: 12.5px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .lucky-store .wallet-max-btn:hover:not(:disabled) { background: rgba(249, 115, 22, 0.15); }
        .lucky-store .wallet-max-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .lucky-store .wallet-preview {
          padding: 14px 16px;
          background: #f8fafc;
          border: 1px solid rgba(15, 23, 42, 0.06);
          border-radius: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .lucky-store .wallet-preview-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12.5px;
          color: var(--text-light);
          font-weight: 600;
        }
        .lucky-store .wallet-preview-row strong { color: var(--text-main); font-weight: 800; }
        .lucky-store .wallet-fee { color: var(--c-red) !important; }
        .lucky-store .wallet-fee-free { color: var(--c-green) !important; }
        .lucky-store .wallet-preview-final {
          padding-top: 10px;
          border-top: 1px dashed rgba(15, 23, 42, 0.12);
          font-size: 13px;
        }
        .lucky-store .wallet-final { color: var(--c-orange) !important; font-size: 18px !important; letter-spacing: -0.3px; }
        .lucky-store .wallet-preview-empty {
          font-size: 12.5px;
          color: var(--text-light);
          text-align: center;
          padding: 8px 0;
          font-weight: 600;
        }

        .lucky-store .wallet-fee-table {
          margin-top: 14px;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.6);
          border: 1px solid rgba(15, 23, 42, 0.05);
          border-radius: 12px;
        }
        .lucky-store .wallet-fee-table-title {
          font-size: 11.5px;
          color: var(--text-light);
          font-weight: 800;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .lucky-store .wallet-fee-rows {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .lucky-store .wallet-fee-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 10px;
          border-radius: 8px;
          font-size: 12px;
          color: var(--text-light);
          font-weight: 700;
          transition: all 0.2s;
        }
        .lucky-store .wallet-fee-row strong { color: var(--text-main); font-weight: 800; }
        .lucky-store .wallet-fee-row.is-active {
          background: rgba(249, 115, 22, 0.1);
          color: var(--c-orange);
        }
        .lucky-store .wallet-fee-row.is-active strong { color: var(--c-orange); }

        .lucky-store .wallet-hint {
          margin: 12px 0 0;
          padding: 10px 14px;
          background: rgba(59, 130, 246, 0.06);
          border: 1px solid rgba(59, 130, 246, 0.18);
          border-radius: 12px;
          font-size: 12px;
          color: var(--c-blue);
          font-weight: 600;
          line-height: 1.5;
        }

        .lucky-store .wallet-error {
          margin-top: 12px;
          padding: 10px 14px;
          background: rgba(244, 63, 94, 0.08);
          border: 1px solid rgba(244, 63, 94, 0.25);
          border-radius: 12px;
          font-size: 12.5px;
          color: var(--c-red);
          font-weight: 700;
        }

        /* 响应式 */
        @media (max-width: 1280px) {
          .lucky-store .topbar { padding: 14px 32px; }
          .lucky-store .container { padding: 24px 32px 48px; }
          .lucky-store .stats-grid { grid-template-columns: repeat(2, 1fr); }
          .lucky-store .items-grid { grid-template-columns: repeat(2, 1fr); }
          .lucky-store .hero-title { font-size: 38px; }
        }
        @media (max-width: 992px) {
          .lucky-store .topbar { padding: 12px 24px; }
          .lucky-store .user-info { display: none; }
          .lucky-store .user-profile { padding: 4px; }
          .lucky-store .container { padding: 20px 24px 48px; gap: 18px; padding-bottom: max(48px, calc(24px + env(safe-area-inset-bottom))); }
          .lucky-store .store-hero { padding: 28px 24px; border-radius: 28px; }
          .lucky-store .hero-content { gap: 24px; }
          .lucky-store .hero-title { font-size: 30px; }
          .lucky-store .header-left .section-title { font-size: 26px; }
          .lucky-store .section-title .title-icon { width: 38px; height: 38px; }
          .lucky-store .items-grid { grid-template-columns: 1fr; }
          .lucky-store .stats-grid { grid-template-columns: repeat(2, 1fr); }
          .lucky-store .filter-bar { flex-direction: column; align-items: stretch; }
          .lucky-store .search-box { min-width: 0; }
        }
        @media (max-width: 640px) {
          .lucky-store .topbar { padding: 10px 16px; gap: 12px; }
          .lucky-store .brand { font-size: 18px; }
          .lucky-store .brand-icon { width: 32px; height: 32px; border-radius: 10px; }
          .lucky-store .brand-icon svg { width: 18px; height: 18px; }
          .lucky-store .topbar .btn-icon { width: 36px; height: 36px; }
          .lucky-store .user-profile .avatar { width: 32px; height: 32px; font-size: 12px; }
          .lucky-store .container { padding: 16px 16px 40px; gap: 16px; }
          .lucky-store .store-hero { padding: 24px 18px; border-radius: 24px; }
          .lucky-store .hero-badge { font-size: 11px; padding: 5px 11px; }
          .lucky-store .hero-title { font-size: 24px; letter-spacing: -1px; }
          .lucky-store .hero-sub { font-size: 13px; }
          .lucky-store .hero-points-card { padding: 12px 16px; gap: 14px; }
          .lucky-store .hpc-star { width: 42px; height: 42px; }
          .lucky-store .hpc-value { font-size: 26px; }
          .lucky-store .header-left .section-title { font-size: 22px; gap: 10px; }
          .lucky-store .section-title .title-icon { width: 36px; height: 36px; border-radius: 12px; }
          .lucky-store .header-subtitle { font-size: 13px; }
          .lucky-store .header-actions { width: 100%; }
          .lucky-store .stats-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
          .lucky-store .stat-card { padding: 18px; border-radius: 20px; }
          .lucky-store .stat-value { font-size: 24px; }
          .lucky-store .filter-tabs { width: 100%; overflow-x: auto; padding: 4px; }
          .lucky-store .filter-tab { padding: 8px 14px; font-size: 12.5px; }
          .lucky-store .group-title h3 { font-size: 18px; }
          .lucky-store .group-title .grp-icon { width: 32px; height: 32px; }
          .lucky-store .item-card { padding: 22px; min-height: 0; border-radius: 24px; }
          .lucky-store .ic-icon { width: 50px; height: 50px; border-radius: 16px; }
          .lucky-store .ic-icon svg { width: 22px; height: 22px; }
          .lucky-store .ic-title { font-size: 16px; }
          .lucky-store .ic-desc { font-size: 12.5px; }
          .lucky-store .ic-price-num { font-size: 22px; }
        }

        /* === 手机端重排 v2：参考排行榜/游戏中心 === */
        @media (max-width: 640px) {
          .lucky-store .mesh-bg {
            opacity: 0.72;
            filter: blur(42px);
          }

          /* 顶栏：fixed 全宽磨砂，不随页面滚动 */
          .lucky-store .topbar {
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
            border: 0;
            border-radius: 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.8);
            background: rgba(255, 251, 248, 0.82);
            backdrop-filter: blur(24px) saturate(1.6);
            -webkit-backdrop-filter: blur(24px) saturate(1.6);
            box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
          }
          .lucky-store .brand {
            min-width: 0;
            gap: 8px;
            font-size: 16px;
            letter-spacing: 0;
          }
          .lucky-store .brand-icon {
            width: 34px;
            height: 34px;
            border-radius: 13px;
          }
          .lucky-store .topbar-right {
            min-width: 0;
            gap: 6px;
          }
          .lucky-store .topbar .btn-icon {
            width: 36px;
            height: 36px;
            border-radius: 14px;
            flex: 0 0 auto;
            background: rgba(255, 255, 255, 0.92);
          }
          .lucky-store .user-profile {
            width: 36px;
            height: 36px;
            justify-content: center;
            padding: 0;
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.92);
          }
          .lucky-store .user-profile .avatar {
            width: 32px;
            height: 32px;
            border-radius: 12px;
          }

          /* 容器：给 fixed topbar 让出空间 */
          .lucky-store .container {
            width: 100%;
            padding: max(72px, calc(60px + env(safe-area-inset-top))) 12px max(32px, calc(22px + env(safe-area-inset-bottom)));
            gap: 14px;
          }

          /* Hero 单列紧凑 */
          .lucky-store .store-hero {
            padding: 20px 16px;
            border-radius: 22px;
          }
          .lucky-store .hero-content {
            flex-direction: column;
            gap: 16px;
          }
          .lucky-store .hero-text {
            min-width: 0;
          }
          .lucky-store .hero-badge {
            font-size: 10.5px;
            padding: 5px 10px;
            letter-spacing: 0;
            white-space: normal;
          }
          .lucky-store .hero-title {
            font-size: 22px;
            line-height: 1.15;
            letter-spacing: -0.5px;
            margin-bottom: 8px;
          }
          .lucky-store .hero-sub {
            font-size: 12.5px;
            line-height: 1.55;
          }
          .lucky-store .hero-points-wrap {
            width: 100%;
          }
          .lucky-store .hero-points-card {
            width: 100%;
            padding: 12px 14px;
            border-radius: 18px;
            gap: 12px;
          }
          .lucky-store .hpc-star {
            width: 40px;
            height: 40px;
          }
          .lucky-store .hpc-star svg { width: 18px; height: 18px; }
          .lucky-store .hpc-label { font-size: 10px; }
          .lucky-store .hpc-value { font-size: 22px; }
          .lucky-store .hpc-value .unit { font-size: 11px; margin-left: 4px; }

          /* 页头 */
          .lucky-store .page-header {
            gap: 10px;
            align-items: flex-start;
          }
          .lucky-store .header-left .section-title { font-size: 18px; gap: 8px; }
          .lucky-store .section-title .title-icon { width: 32px; height: 32px; border-radius: 10px; }
          .lucky-store .header-subtitle { font-size: 12px; line-height: 1.55; }

          /* Stats grid 2x2 紧凑 */
          .lucky-store .stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }
          .lucky-store .stat-card {
            padding: 14px 12px;
            border-radius: 18px;
            min-height: 0;
          }
          .lucky-store .stat-head { gap: 8px; margin-bottom: 8px; }
          .lucky-store .stat-icon { width: 32px; height: 32px; border-radius: 10px; }
          .lucky-store .stat-icon svg { width: 16px; height: 16px; }
          .lucky-store .stat-label { font-size: 10.5px; letter-spacing: 0; }
          .lucky-store .stat-value { font-size: 18px; }
          .lucky-store .stat-unit { font-size: 10.5px; }
          .lucky-store .stat-extra { font-size: 10px; gap: 4px; margin-top: 6px; }
          .lucky-store .stat-extra-cta { font-size: 10px; }

          /* 筛选栏：tabs 横滚 + 搜索框紧贴 */
          .lucky-store .filter-bar { gap: 10px; }
          .lucky-store .filter-tabs {
            width: 100%;
            overflow-x: auto;
            padding: 4px;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            border-radius: 14px;
          }
          .lucky-store .filter-tabs::-webkit-scrollbar { display: none; }
          .lucky-store .filter-tab {
            padding: 7px 12px;
            font-size: 12px;
            flex: 0 0 auto;
            white-space: nowrap;
            border-radius: 10px;
          }
          .lucky-store .filter-tab .count { padding: 1px 6px; font-size: 10px; }
          .lucky-store .search-box {
            width: 100%;
            padding: 9px 14px;
            border-radius: 14px;
          }
          .lucky-store .search-box input { font-size: 13px; }

          /* 分组标题紧凑 */
          .lucky-store .group-title { margin: 4px 2px 0; }
          .lucky-store .group-title h3 { font-size: 15px; gap: 8px; }
          .lucky-store .group-title .grp-icon { width: 28px; height: 28px; border-radius: 9px; }
          .lucky-store .group-title .grp-icon svg { width: 14px; height: 14px; }
          .lucky-store .group-title .grp-count { font-size: 11px; padding: 3px 8px; }

          /* 商品卡：紧凑布局 */
          .lucky-store .items-grid { gap: 12px; }
          .lucky-store .item-card {
            padding: 16px 14px;
            border-radius: 20px;
            min-height: 0;
            gap: 12px;
          }
          .lucky-store .corner-tag {
            top: 10px;
            right: 10px;
            padding: 3px 8px;
            font-size: 9.5px;
            letter-spacing: 0.3px;
          }
          .lucky-store .ic-head { gap: 12px; }
          .lucky-store .ic-icon {
            width: 44px;
            height: 44px;
            border-radius: 13px;
            flex-shrink: 0;
          }
          .lucky-store .ic-icon svg { width: 20px; height: 20px; }
          .lucky-store .ic-title-area { padding-top: 0; }
          .lucky-store .ic-title { font-size: 14.5px; line-height: 1.3; }
          .lucky-store .ic-tags { gap: 5px; margin-top: 4px; }
          .lucky-store .ic-tag { padding: 2px 7px; font-size: 10px; border-radius: 5px; }
          .lucky-store .ic-status { padding: 2px 7px; font-size: 10px; }
          .lucky-store .ic-desc {
            font-size: 12px;
            line-height: 1.55;
            -webkit-line-clamp: 2;
          }
          .lucky-store .ic-progress-section { gap: 5px; }
          .lucky-store .ic-progress-text { font-size: 10.5px; }
          .lucky-store .ic-progress-text .num { font-size: 11.5px; }
          .lucky-store .ic-progress-track { height: 6px; }
          .lucky-store .ic-foot {
            flex-wrap: wrap;
            gap: 10px;
            padding-top: 10px;
          }
          .lucky-store .ic-price { gap: 1px; }
          .lucky-store .ic-price-label { font-size: 10px; letter-spacing: 0.3px; }
          .lucky-store .ic-price-num { font-size: 20px; letter-spacing: -0.3px; }
          .lucky-store .ic-price-num.welfare-free-color,
          .lucky-store .ic-price-num.raffle-free-color { font-size: 19px; }
          .lucky-store .ic-price-unit { font-size: 11px; }
          .lucky-store .ic-action-btn {
            padding: 10px 14px;
            font-size: 12.5px;
            border-radius: 12px;
            gap: 4px;
          }
          .lucky-store .ic-action-btn svg { width: 13px; height: 13px; }
        }

        @media (max-width: 480px) {
          .lucky-store .topbar {
            padding: 9px 12px;
            padding-top: max(9px, env(safe-area-inset-top));
            gap: 6px;
          }
          .lucky-store .brand { font-size: 15px; gap: 7px; }
          .lucky-store .brand-icon { width: 32px; height: 32px; border-radius: 12px; }
          .lucky-store .brand-icon svg { width: 16px; height: 16px; }
          .lucky-store .topbar .btn-icon { width: 34px; height: 34px; border-radius: 13px; }
          .lucky-store .topbar .btn-icon svg { width: 15px; height: 15px; }
          .lucky-store .user-profile { width: 34px; height: 34px; border-radius: 13px; }
          .lucky-store .user-profile .avatar { width: 30px; height: 30px; border-radius: 11px; font-size: 11px; }

          .lucky-store .container { padding: max(68px, calc(56px + env(safe-area-inset-top))) 10px max(32px, calc(20px + env(safe-area-inset-bottom))); }

          .lucky-store .store-hero { padding: 18px 14px; border-radius: 20px; }
          .lucky-store .hero-title { font-size: 20px; }
          .lucky-store .hero-sub { font-size: 12px; }

          .lucky-store .stats-grid { gap: 8px; }
          .lucky-store .stat-card { padding: 12px 10px; border-radius: 16px; }
          .lucky-store .stat-icon { width: 28px; height: 28px; border-radius: 9px; }
          .lucky-store .stat-icon svg { width: 14px; height: 14px; }
          .lucky-store .stat-value { font-size: 16px; }
          .lucky-store .stat-label { font-size: 10px; }

          .lucky-store .item-card { padding: 14px 12px; border-radius: 18px; gap: 10px; }
          .lucky-store .ic-icon { width: 40px; height: 40px; border-radius: 12px; }
          .lucky-store .ic-icon svg { width: 18px; height: 18px; }
          .lucky-store .ic-title { font-size: 14px; }
          .lucky-store .ic-desc { font-size: 11.5px; }
          .lucky-store .ic-price-num { font-size: 18px; }
          .lucky-store .ic-action-btn { padding: 9px 12px; font-size: 12px; }
        }
      `}</style>
    </div>
  );
}

export default function StorePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
        </div>
      }
    >
      <StoreContent />
    </Suspense>
  );
}
