'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import Link from 'next/link';
import {
  Home, Sparkles, Star, RefreshCw, HelpCircle, Sprout, BookOpen,
  Coins, Droplets, Scissors, ShoppingBag, PawPrint, ScrollText,
  Lock, Cloud, Sun, CloudRain, CloudSnow, Wind, CloudFog, CloudLightning,
  Trees, Backpack, Cherry, Tv,
  Calendar, Leaf,
} from 'lucide-react';
import { useFarmGame } from './hooks/useFarmGame';
import CropSprite from './components/CropSprite';
import PetSprite, { type PetExpression } from './components/PetSprite';
import {
  AdoptModal, PlantModal, HarvestModal, ShopModal, RulesModal,
  BackpackModal, EventLogModal, ItemDetailModal, SeedDetailModal, LandQuickUseModal, LandDetailModal,
  PetItemPickerModal, WeatherTvModal,
} from './components/Modals';
import type {
  ComputedLand, WeatherV2, Season, PetTask, HarvestResult, ShopItemKey, CropIdV2, PetType, Inventory,
} from '@/lib/types/farm-v2';
import {
  LAND_UNLOCK_PRICES, SEASON_LABEL, WEATHERS_V2, PET_TASKS,
  PET_ITEM_EFFECTS, PET_FREE_FALLBACK, SHOP_ITEMS_V2, PET_SKILL_LABEL, type PetActionCategory,
} from '@/lib/farm-v2/config';
import type { PublicAchievement } from '@/lib/profile-achievements';

const DEFAULT_PET_NAMES: Record<PetType, string> = {
  cat: '小白',
  dog: '小黑',
  rabbit: '小粉',
  red_panda: '小红',
};
const LAND_VISUAL_SIZE = 80;

interface AuthMeUser { id: number; username: string; displayName?: string; isAdmin?: boolean }
interface MyProfile {
  displayName: string | null;
  avatarUrl: string | null;
  equippedAchievement: PublicAchievement | null;
}
interface ProfileUpdatedDetail {
  displayName?: string | null;
  avatarUrl?: string | null;
  equippedAchievement?: PublicAchievement | null;
}

function formatNumber(v: number): string { return Math.floor(v).toLocaleString('zh-CN'); }
function getInitial(name: string): string { return (name?.[0] ?? '?').toUpperCase(); }
const SEASON_ICON: Record<Season, React.ReactNode> = {
  spring: <Cherry size={16} />, summer: <Sun size={16} />,
  autumn: <Leaf size={16} />, winter: <CloudSnow size={16} />,
};

const WEATHER_ICONS: Record<WeatherV2, React.ReactNode> = {
  sunny: <Sun size={16} />, cloudy: <Cloud size={16} />, light_rain: <CloudRain size={16} />,
  storm: <CloudLightning size={16} />, hot: <Sun size={16} />, wind: <Wind size={16} />,
  snow: <CloudSnow size={16} />, fog: <CloudFog size={16} />,
};

export default function FarmPage() {
  const game = useFarmGame();
  const [user, setUser] = useState<AuthMeUser | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [showAdopt, setShowAdopt] = useState(false);
  const [showPlant, setShowPlant] = useState(false);
  const [plantPlot, setPlantPlot] = useState<number | null>(null);
  const [showShop, setShowShop] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showBackpack, setShowBackpack] = useState(false);
  const [showWeatherTv, setShowWeatherTv] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [itemDetail, setItemDetail] = useState<ShopItemKey | null>(null);
  const [seedDetail, setSeedDetail] = useState<CropIdV2 | null>(null);
  const [petPicker, setPetPicker] = useState<PetActionCategory | null>(null);
  const [landUse, setLandUse] = useState<{ mode: 'fertilizer' | 'item'; landIndex: number } | null>(null);
  const [landDetailIndex, setLandDetailIndex] = useState<number | null>(null);
  const [harvestPopup, setHarvestPopup] = useState<{ results: HarvestResult[]; total: number } | null>(null);
  const [now, setNow] = useState(Date.now());

  // 加载用户信息（用于 topbar 显示）
  useEffect(() => {
    Promise.all([
      fetch('/api/auth/me', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
      fetch('/api/profile/settings', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    ]).then(([meJson, profileJson]) => {
      if (meJson?.success && meJson.user) setUser(meJson.user);
      if (profileJson?.success && profileJson.data) {
        setProfile({
          displayName: profileJson.data.displayName ?? null,
          avatarUrl: profileJson.data.avatarUrl ?? null,
          equippedAchievement: profileJson.data.equippedAchievement ?? null,
        });
      }
    });

    const handleProfileUpdated = (event: Event) => {
      const detail = (event as CustomEvent<ProfileUpdatedDetail>).detail;
      if (!detail) return;

      setProfile((prev) => {
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

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (game.status && !game.status.state.pet && !showAdopt) setShowAdopt(true);
  }, [game.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!game.toast) return;
    const t = setTimeout(() => game.setToast(null), 3000);
    return () => clearTimeout(t);
  }, [game.toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerRefresh = useCallback(() => {
    setRefreshSpin(true);
    game.refresh().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  }, [game]);

  const username = profile?.displayName || user?.displayName || user?.username || '';
  const meAvatarUrl = profile?.avatarUrl ?? null;
  const meInitial = getInitial(username);
  const navAchievement = profile?.equippedAchievement ?? null;
  const navRoleLabel = user?.isAdmin ? '管理员' : '用户';

  const matureCount = useMemo(
    () => game.status?.computedLands.filter(c => c.status === 'mature').length ?? 0,
    [game.status],
  );
  const witheredCount = useMemo(
    () => game.status?.computedLands.filter(c => c.status === 'withered' || c.status === 'eaten').length ?? 0,
    [game.status],
  );
  const unlockedLandCount = useMemo(
    () => game.status?.state.lands.filter(l => l.status !== 'locked').length ?? 4,
    [game.status],
  );

  if (!game.loading && game.error && !game.status) {
    return (
      <div className="lucky-farm">
        <div className="mesh-bg" />
        <div className="farm-loading">
          <Sprout size={42} />
          <span>{game.error}</span>
          <Link className="land-btn primary" href="/">返回首页</Link>
        </div>
        <FarmStyles />
      </div>
    );
  }

  if (game.loading || !game.status) {
    return (
      <div className="lucky-farm">
        <div className="mesh-bg" />
        <div className="farm-loading">
          <Sprout size={42} />
          <span>正在加载你的庄园…</span>
        </div>
        <FarmStyles />
      </div>
    );
  }

  const { state, computedLands, world, weatherForecast, plantableCrops, nextSeasonInMs } = game.status;
  const hasWeatherTv = (state.inventory.weather_tv?.count ?? 0) > 0;
  const globalBuffs: Array<{ key: string; className: string; icon: string; label: string; remaining: string }> = [];
  if (state.scarecrowUntil && state.scarecrowUntil > now) {
    globalBuffs.push({
      key: 'scarecrow',
      className: 'scarecrow',
      icon: '🧙',
      label: '稻草人',
      remaining: fmtMs(state.scarecrowUntil - now),
    });
  }
  if (state.bellUntil && state.bellUntil > now) {
    globalBuffs.push({
      key: 'bell',
      className: 'bell',
      icon: '🔔',
      label: '铃铛',
      remaining: fmtMs(state.bellUntil - now),
    });
  }
  const landUseTarget = landUse
    ? computedLands.find((land) => land.index - 1 === landUse.landIndex) ?? null
    : null;
  const landDetailTarget = landDetailIndex != null
    ? computedLands.find((land) => land.index - 1 === landDetailIndex) ?? null
    : null;

  return (
    <div className="lucky-farm">
      <div className="mesh-bg" />

      {/* Topbar */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon"><Sprout /></div>
          开心农场
        </div>
        <div className="topbar-right">
          <button
            type="button"
            className="btn-icon rules-trigger"
            onClick={() => setShowRules(true)}
            aria-label="查看农场规则"
            title="农场规则"
          >
            <BookOpen />
          </button>
          <Link href="/" className="btn-icon" aria-label="返回首页" title="返回首页">
            <Home />
          </Link>
          {user && (
            <Link href="/profile" className="user-profile">
              <div className="avatar">
                {meAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={meAvatarUrl} alt={username || 'avatar'} className="avatar-img" />
                ) : meInitial}
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
          )}
        </div>
      </header>

      <main className="container">
        {/* Hero */}
        <section className="store-hero pastoral-hero">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/farm/butterfly-anim.png" alt="" className="pastoral-butterfly" />
          <div className="hero-content">
            <div className="hero-text">
              <div className="hero-badge">
                <Sparkles />
                LUCKY 开心农场 · {SEASON_LABEL[world.season]}播种季
              </div>
              <h1 className="hero-title">
                经营你的<span className="glow">绿色庄园</span><br />
                收获每一份积分
              </h1>
              <p className="hero-sub">
                种菜浇水、养宠养花、防乌鸦、看天气，离线时作物也在生长。每一次成熟收获，都是积分账户的新增长。
              </p>
              <div className="hero-meta">
                <div className="hero-meta-chip">
                  {SEASON_ICON[world.season]} {SEASON_LABEL[world.season]}
                </div>
                <div className="hero-meta-chip">
                  {WEATHER_ICONS[world.weather]} {WEATHERS_V2[world.weather].name}
                </div>
                <div className="hero-meta-chip">
                  <Calendar size={14} /> 距下次换季 {fmtMs(nextSeasonInMs)}
                </div>
              </div>
            </div>
            <div className="hero-points-wrap">
              <div className="hero-points-card">
                <div className="hpc-star"><Star fill="currentColor" strokeWidth={0} /></div>
                <div className="hpc-info">
                  <div className="hpc-label">当前可用积分余额</div>
                  <div className="hpc-value">
                    {formatNumber(state.points)}
                    <span className="unit">积分</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 顶部错误 / toast */}
        {game.toast && (
          <div className={`store-message ${game.toast.type === 'error' ? 'error' : 'success'}`}>
            <Sparkles />
            <span>{game.toast.text}</span>
          </div>
        )}

        {/* 页头 */}
        <div className="page-header">
          <div className="header-left">
            <h2 className="section-title">
              <span className="title-icon"><Trees strokeWidth={2.5} /></span>
              我的庄园
            </h2>
            <p className="header-subtitle">
              已开垦 {unlockedLandCount} / 8 块地，{matureCount} 块成熟可收，{witheredCount} 块需清理。把握季节与天气，让每一寸土地都不闲置。
            </p>
          </div>
          <div className="header-actions">
            <button
              className={`btn-icon ${refreshSpin ? 'spinning' : ''}`}
              onClick={triggerRefresh} aria-label="刷新"
            >
              <RefreshCw />
            </button>
          </div>
        </div>

        {/* 数据概览 */}
        <section className="stats-grid">
          <div className="stat-card t-amber">
            <div className="stat-head">
              <div className="stat-icon"><Coins strokeWidth={2.4} /></div>
              <div className="stat-label">积分余额</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{formatNumber(state.points)}</span>
              <span className="stat-unit">积分</span>
            </div>
          </div>
          <div className="stat-card t-green">
            <div className="stat-head">
              <div className="stat-icon"><Sprout strokeWidth={2.4} /></div>
              <div className="stat-label">已开垦土地</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{unlockedLandCount}</span>
              <span className="stat-unit">/ 8 块</span>
            </div>
          </div>
          <div className="stat-card t-orange">
            <div className="stat-head">
              <div className="stat-icon"><Scissors strokeWidth={2.4} /></div>
              <div className="stat-label">成熟可收</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{matureCount}</span>
              <span className="stat-unit">块</span>
            </div>
          </div>
          <div className="stat-card t-purple">
            <div className="stat-head">
              <div className="stat-icon"><PawPrint strokeWidth={2.4} /></div>
              <div className="stat-label">宠物状态</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">
                {state.pet ? (state.pet.stage === 'adult' ? '成年' : '幼年') : '未领养'}
              </span>
              <span className="stat-unit">{state.pet ? `· 成长 ${state.pet.growth}` : ''}</span>
            </div>
          </div>
        </section>

        {/* 主内容 */}
        <div className="farm-main">
          {/* 左：土地网格 */}
          <section className="lands-section">
            <div className="group-title">
              <div className="land-title-main">
                <h3>
                  <span className="grp-icon green"><Trees /></span>
                  土地一览
                </h3>
                <div className="land-title-actions" aria-label="农场入口">
                  <button className="land-title-action" onClick={() => setShowBackpack(true)}>
                    <Backpack size={14} /> 背包
                  </button>
                  {hasWeatherTv && (
                    <button className="land-title-action" onClick={() => setShowWeatherTv(true)}>
                      <Tv size={14} /> 电视机
                    </button>
                  )}
                  <button className="land-title-action" onClick={() => setShowShop(true)}>
                    <ShoppingBag size={14} /> 农场商店
                  </button>
                  <button className="land-title-action" onClick={() => setShowEvents(true)}>
                    <ScrollText size={14} /> 庄园事件
                    {state.events && state.events.length > 0 && <span className="count">{state.events.length}</span>}
                  </button>
                </div>
              </div>
              <div className="group-title-right">
                {globalBuffs.length > 0 && (
                  <div className="global-buffs" aria-label="全局道具剩余时间">
                    {globalBuffs.map((buff) => (
                      <span className={`global-buff ${buff.className}`} key={buff.key}>
                        <span aria-hidden="true">{buff.icon}</span>
                        {buff.label} {buff.remaining}
                      </span>
                    ))}
                  </div>
                )}
                <span className="grp-count">{state.lands.length} 块</span>
              </div>
            </div>
            <div className="lands-grid">
              {computedLands.map((land) => (
                <LandCard
                  key={land.index}
                  land={land}
                  onPlant={() => { setPlantPlot(land.index - 1); setShowPlant(true); }}
                  onWater={() => game.water(land.index - 1)}
                  onHarvest={async () => {
                    const r = await game.harvest(land.index - 1);
                    if (r) setHarvestPopup({ results: [r], total: r.finalYield });
                  }}
                  onRemove={() => game.removeWithered(land.index - 1)}
                  onBuy={() => game.buyLand(land.index)}
                  onOpenFertilizer={() => setLandUse({ mode: 'fertilizer', landIndex: land.index - 1 })}
                  onOpenItems={() => setLandUse({ mode: 'item', landIndex: land.index - 1 })}
                  onOpenDetail={() => setLandDetailIndex(land.index - 1)}
                />
              ))}
            </div>
          </section>

          {/* 右：宠物 + 事件 */}
          <aside className="side-section">
            <PetPanel
              pet={state.pet}
              inventory={state.inventory}
              now={now}
              onAdopt={() => setShowAdopt(true)}
              onCare={(itemKey) => game.carePet(itemKey)}
              onDrink={(itemKey) => game.drinkPet(itemKey)}
              onRest={(itemKey) => game.restPet(itemKey)}
              onPlay={(itemKey) => game.playPet(itemKey)}
              onOpenPicker={(cat) => setPetPicker(cat)}
              onDispatch={(t) => game.dispatchPet(t)}
            />
          </aside>
        </div>
      </main>

      {/* Modals */}
      <AdoptModal
        open={showAdopt && !state.pet}
        balance={state.points}
        firstAdopted={state.bonuses.firstAdopt}
        onSelect={(t, name) => { game.adoptPet(t, name); setShowAdopt(false); }}
        onClose={() => setShowAdopt(false)}
      />
      <PlantModal
        open={showPlant && plantPlot != null}
        plantableCrops={plantableCrops}
        unlockedLandCount={unlockedLandCount}
        balance={state.points}
        seedInventory={state.seedInventory}
        onClose={() => setShowPlant(false)}
        onPlant={(cid) => { if (plantPlot != null) game.plant(plantPlot, cid); }}
        onGoShop={() => { setShowPlant(false); setShowShop(true); }}
      />
      <HarvestModal
        open={!!harvestPopup}
        results={harvestPopup?.results ?? []}
        total={harvestPopup?.total ?? 0}
        onClose={() => setHarvestPopup(null)}
      />
      <ShopModal
        open={showShop}
        inventory={state.inventory}
        purchasedSkillBooks={state.purchasedSkillBooks}
        learnedSkills={state.pet?.learnedSkills}
        seedInventory={state.seedInventory}
        balance={state.points}
        unlockedLandCount={unlockedLandCount}
        scarecrowUntil={state.scarecrowUntil}
        bellUntil={state.bellUntil}
        onClose={() => setShowShop(false)}
        onBuy={(k, q) => game.buyItem(k, q)}
        onBuySeed={(c, q) => game.buySeed(c, q)}
        onUse={(k, p) => game.useItem(k, p)}
      />
      <RulesModal open={showRules} onClose={() => setShowRules(false)} />
      <BackpackModal
        open={showBackpack}
        inventory={state.inventory}
        seedInventory={state.seedInventory}
        scarecrowUntil={state.scarecrowUntil}
        bellUntil={state.bellUntil}
        onClose={() => setShowBackpack(false)}
        onItemClick={(k) => setItemDetail(k)}
        onSeedClick={(c) => setSeedDetail(c)}
      />
      <EventLogModal
        open={showEvents}
        events={state.events ?? []}
        onClose={() => setShowEvents(false)}
      />
      <WeatherTvModal
        open={showWeatherTv}
        forecast={weatherForecast}
        onClose={() => setShowWeatherTv(false)}
      />
      <ItemDetailModal
        itemKey={itemDetail}
        inventory={state.inventory}
        lands={computedLands}
        onClose={() => setItemDetail(null)}
        onUse={async (k, p) => { await game.useItem(k, p); setItemDetail(null); }}
      />
      <SeedDetailModal
        cropId={seedDetail}
        seedInventory={state.seedInventory}
        currentSeason={world.season}
        onClose={() => setSeedDetail(null)}
      />
      <LandQuickUseModal
        open={!!landUse}
        mode={landUse?.mode ?? 'fertilizer'}
        land={landUseTarget}
        inventory={state.inventory}
        onClose={() => setLandUse(null)}
        onUse={async (k, p) => { await game.useItem(k, p); setLandUse(null); }}
      />
      <LandDetailModal
        open={landDetailIndex != null}
        land={landDetailTarget}
        onClose={() => setLandDetailIndex(null)}
      />
      <PetItemPickerModal
        category={petPicker}
        inventory={state.inventory}
        onClose={() => setPetPicker(null)}
        onPick={async (cat, itemKey) => {
          setPetPicker(null);
          if (cat === 'feed') {
            const kind: 'normal' | 'premium' = itemKey === 'pet_food_premium' ? 'premium' : 'normal';
            await game.feedPet(kind);
          }
          else if (cat === 'drink') await game.drinkPet(itemKey);
          else if (cat === 'care') await game.carePet(itemKey);
          else if (cat === 'rest') await game.restPet(itemKey);
          else if (cat === 'play') await game.playPet(itemKey);
        }}
        onGoShop={() => { setPetPicker(null); setShowShop(true); }}
      />

      {game.actionLoading && <div className="loading-bar" />}

      <FarmStyles />
    </div>
  );
}

// ===================== 子组件 =====================

const PET_PANEL_SKILLS: Array<{
  skill: Exclude<PetTask, null>;
  icon: string;
  expression: PetExpression;
  detail: string;
}> = [
  { skill: 'water', icon: '💧', expression: 'excited', detail: `${PET_TASKS.water.durationMinutes / 60}h` },
  { skill: 'guard', icon: '🛡️', expression: 'angry', detail: `${PET_TASKS.guard.durationMinutes / 60}h` },
  { skill: 'chase_crow', icon: '🦅', expression: 'angry', detail: `${PET_TASKS.chase_crow.durationMinutes / 60}h` },
  { skill: 'harvest', icon: '🌾', expression: 'happy', detail: '立即收菜' },
  { skill: 'plant', icon: '🌱', expression: 'excited', detail: '自动种菜' },
];

type LandQuickIcon = 'fertilizer' | 'items' | 'water' | 'detail' | 'harvest' | 'plant' | 'clean' | 'buy';

interface LandQuickSlot {
  label: string;
  icon: LandQuickIcon;
  disabled?: boolean;
  primary?: boolean;
  onClick?: () => void;
}

function LandCard({
  land, onPlant, onWater, onHarvest, onRemove, onBuy, onOpenFertilizer, onOpenItems, onOpenDetail,
}: {
  land: ComputedLand;
  onPlant: () => void; onWater: () => void; onHarvest: () => void; onRemove: () => void; onBuy: () => void;
  onOpenFertilizer: () => void; onOpenItems: () => void; onOpenDetail: () => void;
}) {
  const [quickOpen, setQuickOpen] = useState(false);

  const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setQuickOpen(true);
  }, []);

  const handleQuickClick = useCallback(() => {
    setQuickOpen((open) => !open);
  }, []);

  const handleQuickKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setQuickOpen((open) => !open);
  }, []);

  const quickCardEvents = {
    onClick: handleQuickClick,
    onKeyDown: handleQuickKeyDown,
    onContextMenu: handleContextMenu,
  };

  const renderQuickIcon = (icon: LandQuickIcon) => {
    switch (icon) {
      case 'fertilizer': return <Sprout aria-hidden="true" />;
      case 'items': return <Backpack aria-hidden="true" />;
      case 'water': return <Droplets aria-hidden="true" />;
      case 'detail': return <HelpCircle aria-hidden="true" />;
      case 'harvest': return <Scissors aria-hidden="true" />;
      case 'plant': return <Sprout aria-hidden="true" />;
      case 'clean': return <RefreshCw aria-hidden="true" />;
      case 'buy': return <Coins aria-hidden="true" />;
    }
  };

  const renderQuickActions = (slots: LandQuickSlot[]) => (
    <div
      className="land-quick-actions"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {slots.map((slot) => (
        <button
          key={slot.label}
          className={`land-quick-btn ${slot.primary ? 'land-quick-primary' : ''}`}
          type="button"
          aria-label={slot.label}
          title={slot.label}
          disabled={slot.disabled}
          onClick={() => {
            if (slot.disabled || !slot.onClick) return;
            setQuickOpen(false);
            slot.onClick();
          }}
        >
          {renderQuickIcon(slot.icon)}
        </button>
      ))}
    </div>
  );

  const renderCommonQuickActions = (
    primary: LandQuickSlot,
    options?: { canUseLandItems?: boolean; canWater?: boolean },
  ) => renderQuickActions([
    { label: '使用肥料', icon: 'fertilizer', disabled: !options?.canUseLandItems, onClick: onOpenFertilizer },
    { label: '使用道具', icon: 'items', disabled: !options?.canUseLandItems, onClick: onOpenItems },
    { label: '浇水', icon: 'water', disabled: !options?.canWater, onClick: onWater },
    { label: '详情', icon: 'detail', onClick: onOpenDetail },
    primary,
  ]);

  useEffect(() => {
    if (!quickOpen) return;
    const timer = setTimeout(() => setQuickOpen(false), 6000);
    return () => clearTimeout(timer);
  }, [quickOpen]);

  if (land.status === 'locked') {
    const price = LAND_UNLOCK_PRICES[land.index] ?? 0;
    return (
      <div className="land-card t-locked">
        <div className="land-soil">
          <div className="land-lock-icon"><Lock size={26} /></div>
        </div>
        <button className="land-btn primary" onClick={onBuy}>
          <Coins size={13} /> {price} 积分开垦
        </button>
      </div>
    );
  }
  if (land.status === 'empty') {
    return (
      <div
        className={`land-card land-visual-only t-empty ${quickOpen ? 'quick-open' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={`第 ${land.index} 块空地，点按打开土地操作`}
        {...quickCardEvents}
      >
        <div className="land-soil" />
        {quickOpen && renderCommonQuickActions({ label: '种植', icon: 'plant', primary: true, onClick: onPlant })}
      </div>
    );
  }
  if (land.status === 'eaten') {
    return (
      <div
        className={`land-card land-visual-only t-eaten ${quickOpen ? 'quick-open' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={`第 ${land.index} 块地被乌鸦吃掉，点按打开土地操作`}
        {...quickCardEvents}
      >
        <div className="land-soil">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/farm/crow-display.png" alt="乌鸦" className="land-crow-img" />
        </div>
        {quickOpen && renderCommonQuickActions({ label: '清理', icon: 'clean', primary: true, onClick: onRemove })}
      </div>
    );
  }
  if (land.status === 'withered' || (land.crop && land.crop.waterMissCount >= 3)) {
    return (
      <div
        className={`land-card land-visual-only t-warn ${quickOpen ? 'quick-open' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={`第 ${land.index} 块地作物枯萎，点按打开土地操作`}
        {...quickCardEvents}
      >
        <div className="land-soil">
          {land.crop && <CropSprite cropId={land.crop.cropId} stage="mature" size={LAND_VISUAL_SIZE} variant="withered" />}
        </div>
        {quickOpen && renderCommonQuickActions({ label: '铲除', icon: 'clean', primary: true, onClick: onRemove })}
      </div>
    );
  }
  if (!land.crop || !land.stage) return null;

  const isMature = land.status === 'mature';
  const isThirsty = land.status === 'thirsty';
  const waterRemain = Math.max(0, land.nextWaterRemainingMs);
  const canWater = !isMature && (waterRemain <= 60_000 || isThirsty);

  return (
    <div
      className={`land-card land-visual-only ${isMature ? 't-mature' : isThirsty ? 't-thirsty' : 't-grow'} ${quickOpen ? 'quick-open' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`第 ${land.index} 块地，点按打开土地操作`}
      {...quickCardEvents}
    >
      <div className="land-soil">
        <CropSprite cropId={land.crop.cropId} stage={land.stage} size={LAND_VISUAL_SIZE} />
        {land.netActive && <div className="land-corner-tag">🕸️</div>}
        {land.crop.waterMissCount > 0 && (
          <div className="land-water-cans">
            {Array.from({ length: Math.min(land.crop.waterMissCount, 2) }).map((_, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src="/images/farm/watering-can.png" alt="缺水" className="land-water-can" />
            ))}
          </div>
        )}
      </div>
      {quickOpen && renderCommonQuickActions(
        { label: '收获', icon: 'harvest', primary: true, disabled: !isMature, onClick: onHarvest },
        { canUseLandItems: true, canWater },
      )}
    </div>
  );
}

function PetPanel({
  pet, inventory, now, onAdopt, onCare, onDrink, onRest, onPlay, onOpenPicker, onDispatch,
}: {
  pet: import('@/lib/types/farm-v2').PetState | null;
  inventory: Inventory;
  now: number;
  onAdopt: () => void;
  onCare: (itemKey?: ShopItemKey) => void | Promise<void>;
  onDrink: (itemKey?: ShopItemKey) => void | Promise<void>;
  onRest: (itemKey?: ShopItemKey) => void | Promise<void>;
  onPlay: (itemKey?: ShopItemKey) => void | Promise<void>;
  onOpenPicker: (cat: PetActionCategory) => void;
  onDispatch: (t: Exclude<PetTask, null>) => void | Promise<void>;
}) {
  const [reaction, setReaction] = useState<PetExpression | null>(null);
  const [showSkills, setShowSkills] = useState(false);
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    };
  }, []);

  const triggerReaction = useCallback((expression: PetExpression, action: () => void | Promise<void>) => {
    if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    setReaction(expression);
    void Promise.resolve(action()).finally(() => {
      reactionTimerRef.current = setTimeout(() => setReaction(null), 1500);
    });
  }, []);

  if (!pet) {
    return (
      <div className="side-card pet-empty-card">
        <div className="pet-empty-icon"><PawPrint size={38} /></div>
        <h3>领养你的伙伴</h3>
        <p>可领养小白猫、边牧、兔子或红熊猫。首次免费，再次领养 50 积分。</p>
        <button className="land-btn primary" onClick={onAdopt}>立即领养</button>
      </div>
    );
  }
  const taskName: Record<string, string> = {
    water: '自动浇水中',
    guard: '守护中',
    chase_crow: '赶乌鸦中',
    steal: '偷菜中',
    harvest: '收菜中',
    plant: '种菜中',
  };
  const remain = pet.taskEndAt ? Math.max(0, pet.taskEndAt - now) : 0;
  const cooldown = pet.cooldownEndAt ? Math.max(0, pet.cooldownEndAt - now) : 0;
  const working = !!pet.currentTask && remain > 0;
  const emotion = reaction ?? resolvePetExpression(pet, working);
  const displayName = pet.name?.trim() || DEFAULT_PET_NAMES[pet.type];
  const thirstColor = pet.thirst < 30 ? '#ef4444' : pet.thirst < 55 ? '#f97316' : '#06b6d4';
  const thirstDisplay = Math.max(0, Math.min(100, Math.round(pet.thirst)));
  const learnedSkills = new Set(pet.learnedSkills ?? []);
  const learnedSkillText = (pet.learnedSkills ?? []).length > 0
    ? (pet.learnedSkills ?? []).map((skill) => PET_SKILL_LABEL[skill]).join('、')
    : '暂无';
  const moodStatus = describePetMood(pet, working);
  const speech = pickPetSpeech(pet, working, now);

  const handleCategoryClick = (cat: PetActionCategory) => {
    // 喂食类别没有免费回退，且需要主动选择普通/高级，因此直接打开弹窗
    if (cat === 'feed') {
      onOpenPicker('feed');
      return;
    }
    const paid = countPaidPetItemsInCategory(cat, inventory);
    if (paid > 0) {
      onOpenPicker(cat);
      return;
    }
    const fallback = PET_FREE_FALLBACK[cat];
    if (cat === 'drink') triggerReaction('happy', () => onDrink(fallback ?? undefined));
    else if (cat === 'care') triggerReaction('love', () => onCare(fallback ?? undefined));
    else if (cat === 'rest') triggerReaction('sleepy', () => onRest(fallback ?? undefined));
    else if (cat === 'play') triggerReaction('excited', () => onPlay(fallback ?? undefined));
  };

  return (
    <div className="side-card pet-card">
      <div className="side-card-head">
        <div className="grp-icon orange"><PawPrint /></div>
        <div className="side-card-title">
          <strong>{displayName}</strong>
          <span className="pet-title-meta">
            成长值 {pet.growth}
            <em className={`pet-title-mood mood-${moodStatus.tone}`}>{moodStatus.text}</em>
          </span>
        </div>
      </div>
      <div className="pet-sprite-row">
        <div
          className="pet-sprite-wrap"
          role="button"
          tabIndex={0}
          aria-label="点按查看宠物技能"
          title="点按查看宠物技能"
          onContextMenu={(event) => event.preventDefault()}
          onClick={() => setShowSkills((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setShowSkills((open) => !open);
            }
          }}
        >
          <PetSprite type={pet.type} stage={pet.stage} size={120} emotion={emotion} />
          {speech && (
            <div className={`pet-speech-bubble mood-${moodStatus.tone}`} role="note" aria-live="polite">
              {speech}
            </div>
          )}
        </div>
      </div>
      <div className="pet-stats">
        <Stat label="饱食" value={pet.hunger} color="#f59e0b" />
        <Stat label="体力" value={pet.cleanliness} color="#3b82f6" />
        <Stat label="口渴值" value={thirstDisplay} color={thirstColor} />
        <Stat label="健康" value={pet.health} color="#22c55e" />
      </div>
      {working && <div className="pet-task-status">{taskName[pet.currentTask!]} · 剩 {fmtMs(remain)}</div>}
      {!working && cooldown > 0 && <div className="pet-task-status idle">休息中 {fmtMs(cooldown)}</div>}
      <div className="pet-care">
        <button className="pet-btn" onClick={() => handleCategoryClick('feed')}>
          <span className="pet-btn-icon">🍖</span>
          <span className="pet-btn-label">喂食</span>
        </button>
        <button className="pet-btn" onClick={() => handleCategoryClick('drink')}>
          <span className="pet-btn-icon">💧</span>
          <span className="pet-btn-label">喂水</span>
        </button>
        <button className="pet-btn" onClick={() => handleCategoryClick('care')}>
          <span className="pet-btn-icon">🩺</span>
          <span className="pet-btn-label">保养</span>
        </button>
        <button className="pet-btn" onClick={() => handleCategoryClick('rest')}>
          <span className="pet-btn-icon">😴</span>
          <span className="pet-btn-label">休息</span>
        </button>
        <button className="pet-btn" onClick={() => handleCategoryClick('play')}>
          <span className="pet-btn-icon">🎾</span>
          <span className="pet-btn-label">陪玩</span>
        </button>
      </div>
      {showSkills && (
        <div className="pet-skill-popover" role="dialog" aria-modal="false" aria-label="宠物技能">
          <div className="pet-skill-popover-head">
            <strong>宠物技能</strong>
            <button type="button" onClick={() => setShowSkills(false)} aria-label="关闭技能面板">×</button>
          </div>
          <div className="pet-skill-known">已学：{learnedSkillText}</div>
          {pet.stage !== 'adult' ? (
            <div className="pet-skill-hint">宠物成年后，可在背包中使用商店购买的技能书。</div>
          ) : (
            <div className="pet-skill-list">
              {PET_PANEL_SKILLS.map((item) => {
                const learned = learnedSkills.has(item.skill);
                const disabled = !learned || working || cooldown > 0;
                const disabledReason = !learned ? `需要先学习${PET_SKILL_LABEL[item.skill]}技能书` : working ? '宠物正在工作中' : cooldown > 0 ? `休息中 ${fmtMs(cooldown)}` : '';
                return (
                  <button
                    key={item.skill}
                    className={`pet-task-btn ${!learned ? 'locked' : ''}`}
                    disabled={disabled}
                    title={disabledReason}
                    onClick={() => {
                      setShowSkills(false);
                      triggerReaction(item.expression, () => onDispatch(item.skill));
                    }}
                  >
                    <span>{item.icon}</span>
                    <span>{PET_SKILL_LABEL[item.skill]} · {learned ? item.detail : '未学习'}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function countPaidPetItemsInCategory(cat: PetActionCategory, inventory: Inventory): number {
  let total = 0;
  for (const [key, entry] of Object.entries(PET_ITEM_EFFECTS)) {
    if (!entry || entry.category !== cat) continue;
    const def = SHOP_ITEMS_V2[key as ShopItemKey];
    if (!def || def.cost <= 0) continue;
    total += inventory[key as ShopItemKey]?.count ?? 0;
  }
  return total;
}

function resolvePetExpression(
  pet: import('@/lib/types/farm-v2').PetState,
  working: boolean,
): PetExpression | 'working' {
  if (working) return 'working';
  if (pet.health < 25 || pet.mood < 20) return 'sad';
  if (pet.thirst < 20) return 'surprised';
  if (pet.cleanliness < 25) return 'angry';
  if (pet.hunger < 30 || pet.health < 45 || pet.mood < 40) return 'sleepy';
  if (pet.mood >= 90) return 'excited';
  if (pet.mood >= 75) return 'love';
  if (pet.mood >= 60) return 'happy';
  if (pet.mood >= 45) return 'blush';
  return 'normal';
}

interface PetSpeechLine {
  text: string;
  weight: number;
  match: (pet: import('@/lib/types/farm-v2').PetState, working: boolean) => boolean;
}

const PET_SPEECH_LINES: PetSpeechLine[] = [
  // 工作中
  { text: '专心干活！别打扰~', weight: 3, match: (_, w) => w },
  { text: '我会努力完成的！', weight: 2, match: (_, w) => w },
  { text: '工作中…等我回来', weight: 2, match: (_, w) => w },
  // 极度低落 / 罢工边缘
  { text: '一点也不想动…', weight: 5, match: (p, w) => !w && p.mood < 20 },
  { text: '不想干活了…', weight: 5, match: (p, w) => !w && p.mood < 20 },
  { text: '陪陪我好吗？', weight: 4, match: (p, w) => !w && p.mood < 25 },
  // 饥饿
  { text: '肚子咕咕叫…', weight: 5, match: (p) => p.hunger < 25 },
  { text: '主人，我饿了！', weight: 5, match: (p) => p.hunger < 25 },
  { text: '想吃好吃的~', weight: 3, match: (p) => p.hunger < 45 },
  // 口渴
  { text: '渴渴渴~', weight: 5, match: (p) => p.thirst < 20 },
  { text: '想喝水…', weight: 4, match: (p) => p.thirst < 35 },
  { text: '嘴巴干干的', weight: 3, match: (p) => p.thirst < 45 },
  // 体力低
  { text: '好累，想休息', weight: 5, match: (p) => p.cleanliness < 25 },
  { text: '腿软了…', weight: 3, match: (p) => p.cleanliness < 35 },
  { text: '想钻进小窝里', weight: 3, match: (p) => p.cleanliness < 45 },
  // 健康差
  { text: '感觉不太舒服…', weight: 5, match: (p) => p.health < 30 },
  { text: '需要保养一下', weight: 4, match: (p) => p.health < 45 },
  // 高兴
  { text: '今天天气真好~', weight: 2, match: (p, w) => !w && p.mood >= 80 && p.hunger >= 50 && p.thirst >= 50 },
  { text: '最喜欢主人啦！', weight: 4, match: (p, w) => !w && p.mood >= 85 },
  { text: '好开心好开心！', weight: 3, match: (p, w) => !w && p.mood >= 80 },
  { text: '一起玩吧~', weight: 3, match: (p, w) => !w && p.mood >= 70 },
  // 中等
  { text: '主人，看我看我~', weight: 2, match: (p, w) => !w && p.mood >= 55 && p.mood < 80 },
  { text: '嘿嘿，蹭蹭你', weight: 2, match: (p, w) => !w && p.mood >= 60 },
  { text: '今天也要加油呀', weight: 2, match: (p, w) => !w && p.mood >= 50 && p.mood < 80 },
  // 默认 / 平静
  { text: '汪~（摇尾巴）', weight: 1, match: (p) => p.type === 'dog' },
  { text: '喵呜~', weight: 1, match: (p) => p.type === 'cat' },
  { text: '哼哼~', weight: 1, match: (p) => p.type === 'rabbit' },
  { text: '吱吱~', weight: 1, match: (p) => p.type === 'red_panda' },
  { text: '在想点什么…', weight: 1, match: () => true },
  { text: '今天也安安静静的', weight: 1, match: () => true },
];

function pickPetSpeech(
  pet: import('@/lib/types/farm-v2').PetState,
  working: boolean,
  now: number,
): string | null {
  const candidates = PET_SPEECH_LINES.filter((line) => line.match(pet, working));
  if (candidates.length === 0) return null;
  // 用一个 30 秒的时间窗作为种子，让对白在短时间内稳定，过一会儿又变化
  const slot = Math.floor(now / 30_000);
  const seed = slot + pet.hunger + Math.floor(pet.mood) + (working ? 1 : 0);
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let pick = seed % totalWeight;
  for (const c of candidates) {
    if (pick < c.weight) return c.text;
    pick -= c.weight;
  }
  return candidates[0].text;
}

interface MoodTextStatus {
  text: string;
  hint: string;
  tone: 'great' | 'good' | 'soft' | 'calm' | 'warn' | 'bad';
}

function describePetMood(
  pet: import('@/lib/types/farm-v2').PetState,
  working: boolean,
): MoodTextStatus {
  if (working) return { text: '专注工作', hint: '正在努力完成任务', tone: 'good' };
  if (pet.health < 25 || pet.mood < 20) return { text: '很难过', hint: '需要陪伴和照料', tone: 'bad' };
  if (pet.thirst < 20) return { text: '焦躁口渴', hint: '先喂点水会舒服很多', tone: 'warn' };
  if (pet.cleanliness < 25) return { text: '闹脾气', hint: '洗个澡心情会变好', tone: 'warn' };
  if (pet.hunger < 30 || pet.health < 45 || pet.mood < 40) return { text: '没精神', hint: '吃饱休息后会恢复', tone: 'warn' };
  if (pet.mood >= 90) return { text: '星星眼', hint: '开心到发光', tone: 'great' };
  if (pet.mood >= 75) return { text: '超黏人', hint: '特别想和你待在一起', tone: 'great' };
  if (pet.mood >= 60) return { text: '很开心', hint: '状态轻松愉快', tone: 'good' };
  if (pet.mood >= 45) return { text: '有点害羞', hint: '慢慢熟悉庄园', tone: 'soft' };
  return { text: '平静', hint: '状态普通', tone: 'calm' };
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="pet-stat">
      <div className="pet-stat-row">
        <span className="pet-stat-label">{label}</span>
        <span className="pet-stat-val">{safeValue}</span>
      </div>
      <div className="pet-stat-bar">
        <div className="pet-stat-fill" style={{ width: `${safeValue}%`, background: color }} />
      </div>
    </div>
  );
}

function fmtMs(ms: number): string {
  if (ms <= 0) return '已到';
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `${sec}秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分${sec % 60}秒`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `${h}小时${m}分`;
  const d = Math.floor(h / 24);
  return `${d}天${h % 24}小时`;
}

// ===================== 样式 =====================

function FarmStyles() {
  return (
    <style jsx global>{`
      .lucky-farm {
        --text-main: #0f172a;
        --text-light: #64748b;
        --card-bg: rgba(255, 255, 255, 0.7);
        --card-border: rgba(255, 255, 255, 1);
        --card-shadow: 0 24px 48px rgba(15, 23, 42, 0.06);

        --c-green: #16a34a;
        --c-emerald: #10b981;
        --c-lime: #84cc16;
        --c-purple: #8b5cf6;
        --c-orange: #f97316;
        --c-red: #f43f5e;
        --c-blue: #3b82f6;
        --c-pink: #ec4899;
        --c-amber: #fbbf24;

        --grad-primary: linear-gradient(135deg, #84cc16, #16a34a);
        --grad-green: linear-gradient(135deg, #84cc16, #16a34a 60%, #15803d);
        --grad-emerald: linear-gradient(135deg, #34d399, #10b981);
        --grad-lime: linear-gradient(135deg, #d9f99d, #84cc16);
        --grad-orange: linear-gradient(135deg, #fb923c, #f97316);
        --grad-amber: linear-gradient(135deg, #fde047, #fbbf24);
        --grad-pink: linear-gradient(135deg, #fb7185, #ec4899);
        --grad-purple: linear-gradient(135deg, #a78bfa, #8b5cf6);
        --grad-blue: linear-gradient(135deg, #60a5fa, #3b82f6);
        --grad-red: linear-gradient(135deg, #fb7185, #f43f5e);
        --grad-gold: linear-gradient(135deg, #fde047, #f59e0b 50%, #ea580c);

        font-family: 'Outfit', 'Noto Sans SC', sans-serif;
        background-color: #f8fafc;
        color: var(--text-main);
        min-height: 100vh;
        position: relative;
        isolation: isolate;
        -webkit-font-smoothing: antialiased;
      }
      .lucky-farm * { box-sizing: border-box; }
      .lucky-farm a { color: inherit; text-decoration: none; }
      .lucky-farm button { font-family: inherit; }

      .lucky-farm .mesh-bg {
        position: fixed; inset: 0; z-index: -2;
        background-image:
          radial-gradient(circle at 15% 20%, rgba(186, 230, 253, 0.7) 0%, transparent 50%),
          radial-gradient(circle at 85% 30%, rgba(254, 240, 138, 0.55) 0%, transparent 50%),
          radial-gradient(circle at 50% 100%, rgba(132, 204, 22, 0.4) 0%, transparent 60%),
          radial-gradient(circle at 50% 50%, rgba(220, 252, 231, 0.85) 0%, transparent 50%);
        filter: blur(60px);
        animation: lwfFluid 15s infinite alternate ease-in-out;
      }
      @keyframes lwfFluid {
        0% { transform: scale(1) rotate(0deg); }
        50% { transform: scale(1.05) rotate(2deg); }
        100% { transform: scale(1.1) rotate(-2deg); }
      }

      /* topbar */
      .lucky-farm .topbar {
        position: sticky; top: 0; z-index: 100;
        display: flex; align-items: center; justify-content: space-between;
        gap: 24px; padding: 16px 48px;
        background: rgba(248, 250, 252, 0.65);
        backdrop-filter: blur(24px) saturate(1.6);
        -webkit-backdrop-filter: blur(24px) saturate(1.6);
        border-bottom: 1px solid rgba(255, 255, 255, 0.8);
        padding-top: max(16px, env(safe-area-inset-top));
      }
      .lucky-farm .brand {
        display: flex; align-items: center; gap: 12px;
        font-size: 20px; font-weight: 800; letter-spacing: -0.5px;
        color: var(--text-main); flex-shrink: 0;
      }
      .lucky-farm .brand-icon {
        width: 36px; height: 36px;
        background: var(--grad-green);
        border-radius: 11px;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 8px 16px rgba(22, 163, 74, 0.3);
      }
      .lucky-farm .brand-icon svg { width: 20px; height: 20px; color: #fff; stroke-width: 2.5; }

      .lucky-farm .topbar-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
      .lucky-farm .topbar .btn-icon {
        width: 40px; height: 40px; border-radius: 50%;
        background: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.9);
        display: inline-flex; align-items: center; justify-content: center;
        color: var(--text-light); transition: all 0.2s; cursor: pointer;
      }
      .lucky-farm .topbar .btn-icon svg { width: 16px; height: 16px; }
      .lucky-farm .topbar .btn-icon:hover { background: #fff; color: var(--c-green); transform: translateY(-1px); }
      .lucky-farm .topbar .rules-trigger {
        color: #15803d;
        background:
          linear-gradient(#fff, #fff) padding-box,
          linear-gradient(135deg, rgba(132, 204, 22, 0.45), rgba(16, 185, 129, 0.45)) border-box;
        border: 1px solid transparent;
      }
      .lucky-farm .topbar .rules-trigger:hover {
        color: #166534;
        box-shadow: 0 14px 26px rgba(22, 163, 74, 0.14);
      }

      .lucky-farm .user-profile {
        display: inline-flex; align-items: center; gap: 12px;
        padding: 5px 16px 5px 5px;
        background: #fff; border-radius: 999px;
        box-shadow: 0 8px 20px rgba(0,0,0,0.04);
        cursor: pointer; transition: transform 0.2s;
        color: var(--text-main); text-decoration: none;
      }
      .lucky-farm .user-profile:hover { transform: scale(1.02); }
      .lucky-farm .user-profile .avatar {
        width: 36px; height: 36px; border-radius: 50%;
        background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
        color: #475569; display: inline-flex; align-items: center; justify-content: center;
        font-weight: 800; font-size: 14px; flex-shrink: 0; overflow: hidden; text-transform: uppercase;
      }
      .lucky-farm .user-profile .avatar-img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; display: block; }
      .lucky-farm .user-info h4 { font-size: 13px; font-weight: 700; line-height: 1.2; margin: 0; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lucky-farm .user-info p {
        font-size: 11px; color: var(--text-light); margin: 1px 0 0;
        display: inline-flex; align-items: center; gap: 4px; max-width: 150px;
      }
      .lucky-farm .user-info .nav-achievement-line {
        width: 100%;
        min-width: 0;
      }
      .lucky-farm .nav-achievement {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
        color: #15803d;
        font-weight: 800;
      }
      .lucky-farm .nav-achievement.empty {
        color: var(--text-light);
        font-weight: 700;
      }
      .lucky-farm .nav-achievement-emoji {
        flex: 0 0 auto;
        font-size: 11px;
        line-height: 1;
      }
      .lucky-farm .nav-achievement-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* container */
      .lucky-farm .container {
        max-width: 1600px; margin: 0 auto;
        padding: 32px 48px 64px;
        display: flex; flex-direction: column; gap: 24px;
      }

      /* hero - 自定义插画背景 */
      .lucky-farm .store-hero {
        position: relative; padding: 36px 40px 60px; border-radius: 36px;
        background:
          url('/images/farm/hero-bg.webp') center / cover no-repeat;
        color: #1f2937; overflow: hidden;
        box-shadow: 0 30px 60px rgba(20, 83, 45, 0.25), inset 0 0 0 4px rgba(255,255,255,0.6);
      }
      .lucky-farm .store-hero::before {
        content: ''; position: absolute; inset: 0;
        background: linear-gradient(
          90deg,
          rgba(255, 255, 255, 0.35) 0%,
          rgba(255, 255, 255, 0.10) 35%,
          transparent 60%
        );
        pointer-events: none;
      }
      .lucky-farm .store-hero::after {
        content: none;
      }
      @keyframes lwfGlowPulse {
        0%, 100% { transform: scale(1); opacity: 0.65; }
        50% { transform: scale(1.18); opacity: 1; }
      }
      .lucky-farm .pastoral-butterfly {
        position: absolute; top: 20px; right: 12%;
        width: 64px; height: 64px;
        object-fit: contain;
        pointer-events: none;
        filter:
          drop-shadow(0 4px 10px rgba(0, 0, 0, 0.4))
          drop-shadow(0 0 4px rgba(255, 255, 255, 0.45));
        animation: pastoralFlyPath 6s ease-in-out infinite;
      }
      @keyframes pastoralFlyPath {
        0%, 100% { transform: translate(0, 0) rotate(-3deg); }
        20% { transform: translate(25px, -18px) rotate(6deg); }
        40% { transform: translate(55px, -8px) rotate(-4deg); }
        60% { transform: translate(70px, 10px) rotate(5deg); }
        80% { transform: translate(35px, 15px) rotate(-6deg); }
      }
      .lucky-farm .hero-content { position: relative; z-index: 2; display: flex; justify-content: space-between; align-items: center; gap: 32px; flex-wrap: wrap; }
      .lucky-farm .hero-text { flex: 1; min-width: 280px; display: flex; flex-direction: column; gap: 14px; }
      .lucky-farm .hero-points-wrap { flex-shrink: 0; }
      .lucky-farm .hero-badge {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 14px;
        background: rgba(255, 255, 255, 0.55);
        border: 1px solid rgba(255, 255, 255, 0.75);
        border-radius: 999px;
        font-size: 12px; font-weight: 800; color: #15803d;
        letter-spacing: 1px; backdrop-filter: blur(10px); width: fit-content;
        box-shadow: 0 4px 10px rgba(20, 83, 45, 0.12);
      }
      .lucky-farm .hero-badge svg { width: 12px; height: 12px; }
      .lucky-farm .hero-title {
        font-size: 46px; font-weight: 900; letter-spacing: -1.5px; line-height: 1.05; margin: 0;
        color: #14532d;
        text-shadow:
          0 2px 8px rgba(255, 255, 255, 0.65),
          0 1px 2px rgba(255, 255, 255, 0.6),
          0 2px 4px rgba(20, 83, 45, 0.35);
      }
      .lucky-farm .hero-title .glow {
        background: linear-gradient(135deg, #b45309, #d97706 50%, #f59e0b);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        filter:
          drop-shadow(0 1px 2px rgba(120, 53, 15, 0.55))
          drop-shadow(0 0 6px rgba(255, 255, 255, 0.5));
      }
      .lucky-farm .hero-sub { font-size: 15px; color: rgba(20, 83, 45, 0.85); line-height: 1.6; max-width: 580px; margin: 0; font-weight: 600; }
      .lucky-farm .hero-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
      .lucky-farm .hero-meta-chip {
        display: inline-flex; align-items: center; gap: 5px;
        padding: 6px 12px; border-radius: 999px;
        background: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.8);
        font-size: 12px; font-weight: 700; color: #14532d;
        backdrop-filter: blur(8px);
        box-shadow: 0 2px 6px rgba(20, 83, 45, 0.08);
      }
      .lucky-farm .hero-meta-chip svg { width: 12px; height: 12px; }

      .lucky-farm .hero-points-card {
        display: inline-flex; align-items: center; gap: 18px;
        padding: 16px 22px;
        background: rgba(254, 243, 199, 0.85); border: 1.5px solid rgba(255, 255, 255, 1);
        border-radius: 22px; backdrop-filter: blur(18px); width: fit-content;
        box-shadow:
          0 16px 36px rgba(20, 83, 45, 0.22),
          0 0 0 1px rgba(20, 83, 45, 0.08),
          inset 0 1px 0 rgba(255, 255, 255, 0.9);
      }
      .lucky-farm .hpc-star {
        width: 50px; height: 50px; border-radius: 50%;
        background: var(--grad-amber);
        display: flex; align-items: center; justify-content: center; color: #fff;
        box-shadow: 0 10px 20px rgba(251,191,36,0.45);
      }
      .lucky-farm .hpc-star svg { width: 22px; height: 22px; }
      .lucky-farm .hpc-info { display: flex; flex-direction: column; gap: 2px; }
      .lucky-farm .hpc-label { font-size: 11px; color: #16a34a; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; }
      .lucky-farm .hpc-value {
        font-size: 32px; font-weight: 900; line-height: 1;
        background: linear-gradient(135deg, #16a34a, #84cc16);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        letter-spacing: -1px;
      }
      .lucky-farm .hpc-value .unit {
        font-size: 14px; color: #16a34a; font-weight: 700; margin-left: 4px;
        -webkit-text-fill-color: #16a34a; background: none;
      }

      /* message */
      .lucky-farm .store-message {
        display: flex; align-items: center; gap: 10px;
        padding: 12px 18px; border-radius: 16px;
        font-size: 13.5px; font-weight: 600; border: 1px solid; backdrop-filter: blur(20px);
      }
      .lucky-farm .store-message.success { background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.25); color: var(--c-green); }
      .lucky-farm .store-message.error { background: rgba(244, 63, 94, 0.08); border-color: rgba(244, 63, 94, 0.25); color: var(--c-red); }
      .lucky-farm .store-message svg { width: 18px; height: 18px; flex-shrink: 0; }

      /* page-header */
      .lucky-farm .page-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
      .lucky-farm .header-left .section-title {
        font-size: 32px; font-weight: 800;
        display: flex; align-items: center; gap: 14px;
        color: var(--text-main); margin: 0 0 6px; letter-spacing: -0.8px;
      }
      .lucky-farm .section-title .title-icon {
        width: 44px; height: 44px; border-radius: 14px;
        background: var(--grad-green);
        display: flex; align-items: center; justify-content: center;
        color: #fff;
        box-shadow: 0 12px 24px rgba(22, 163, 74, 0.35);
        position: relative;
      }
      .lucky-farm .section-title .title-icon.t-emerald { background: var(--grad-emerald); box-shadow: 0 12px 24px rgba(16, 185, 129, 0.32); }
      .lucky-farm .section-title .title-icon svg { width: 22px; height: 22px; }
      .lucky-farm .section-title .title-icon::after {
        content: ''; position: absolute; inset: -4px; border-radius: 18px;
        background: var(--grad-green); opacity: 0.3; filter: blur(10px); z-index: -1;
      }
      .lucky-farm .header-subtitle { font-size: 14px; color: var(--text-light); line-height: 1.6; max-width: 720px; margin: 0; }
      .lucky-farm .header-actions { display: flex; gap: 10px; align-items: center; }
      .lucky-farm .btn-ghost {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 10px 20px;
        background: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.9);
        border-radius: 999px; font-size: 13px; font-weight: 700;
        color: var(--text-main); cursor: pointer; backdrop-filter: blur(10px);
        transition: all 0.2s; min-height: 42px;
      }
      .lucky-farm .btn-ghost svg { width: 16px; height: 16px; }
      .lucky-farm .btn-ghost:hover { background: #fff; transform: translateY(-2px); box-shadow: 0 8px 16px rgba(0,0,0,0.05); }
      .lucky-farm .btn-icon {
        width: 42px; height: 42px; border-radius: 50%;
        background: rgba(255,255,255,0.7); border: 1px solid rgba(255,255,255,0.9);
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; color: var(--text-light); transition: all 0.2s;
      }
      .lucky-farm .btn-icon svg { width: 16px; height: 16px; }
      .lucky-farm .btn-icon:hover:not(:disabled) { background: #fff; color: var(--c-green); }
      .lucky-farm .btn-icon.spinning svg { animation: lwfRotate 0.6s ease; }
      @keyframes lwfRotate { from { transform: rotate(0); } to { transform: rotate(360deg); } }

      /* stats */
      .lucky-farm .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
      .lucky-farm .stat-card {
        background: linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.55));
        backdrop-filter: blur(30px);
        border: 1px solid rgba(255,255,255,0.9);
        border-radius: 24px; padding: 22px 24px;
        box-shadow: var(--card-shadow), inset 0 1px 0 rgba(255,255,255,1);
        position: relative; overflow: hidden; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .lucky-farm .stat-card::before {
        content: ''; position: absolute; top: -50%; right: -30%;
        width: 200px; height: 200px; border-radius: 50%;
        opacity: 0.3; filter: blur(40px); pointer-events: none; transition: opacity 0.3s;
      }
      .lucky-farm .stat-card.t-amber::before { background: rgba(251,191,36,0.5); }
      .lucky-farm .stat-card.t-orange::before { background: rgba(249,115,22,0.4); }
      .lucky-farm .stat-card.t-green::before { background: rgba(22,163,74,0.45); }
      .lucky-farm .stat-card.t-purple::before { background: rgba(139,92,246,0.4); }
      .lucky-farm .stat-card:hover { transform: translateY(-3px); box-shadow: 0 24px 48px rgba(15,23,42,0.08); }
      .lucky-farm .stat-card:hover::before { opacity: 0.5; }
      .lucky-farm .stat-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; position: relative; z-index: 1; }
      .lucky-farm .stat-icon {
        width: 36px; height: 36px; border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        background: #fff; position: relative; flex-shrink: 0;
      }
      .lucky-farm .stat-icon svg { width: 18px; height: 18px; }
      .lucky-farm .stat-icon::after { content: ''; position: absolute; inset: -3px; border-radius: 14px; opacity: 0.25; filter: blur(8px); z-index: -1; }
      .lucky-farm .stat-card.t-amber .stat-icon { color: #d97706; box-shadow: 0 8px 16px rgba(251,191,36,0.3); }
      .lucky-farm .stat-card.t-amber .stat-icon::after { background: var(--c-amber); }
      .lucky-farm .stat-card.t-orange .stat-icon { color: var(--c-orange); box-shadow: 0 8px 16px rgba(249,115,22,0.25); }
      .lucky-farm .stat-card.t-orange .stat-icon::after { background: var(--c-orange); }
      .lucky-farm .stat-card.t-green .stat-icon { color: var(--c-green); box-shadow: 0 8px 16px rgba(22,163,74,0.25); }
      .lucky-farm .stat-card.t-green .stat-icon::after { background: var(--c-green); }
      .lucky-farm .stat-card.t-purple .stat-icon { color: var(--c-purple); box-shadow: 0 8px 16px rgba(139,92,246,0.25); }
      .lucky-farm .stat-card.t-purple .stat-icon::after { background: var(--c-purple); }
      .lucky-farm .stat-label { font-size: 12px; font-weight: 700; color: var(--text-light); letter-spacing: 0.3px; }
      .lucky-farm .stat-value-row { display: flex; align-items: baseline; gap: 6px; position: relative; z-index: 1; }
      .lucky-farm .stat-value { font-size: 32px; font-weight: 900; color: var(--text-main); letter-spacing: -1px; line-height: 1; }
      .lucky-farm .stat-card.t-green .stat-value { background: var(--grad-green); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
      .lucky-farm .stat-card.t-amber .stat-value { background: var(--grad-gold); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
      .lucky-farm .stat-card.t-orange .stat-value { background: var(--grad-orange); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
      .lucky-farm .stat-card.t-purple .stat-value { background: var(--grad-purple); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
      .lucky-farm .stat-unit { font-size: 13px; color: var(--text-light); font-weight: 700; }

      /* group title */
      .lucky-farm .group-title { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; gap: 16px; flex-wrap: wrap; }
      .lucky-farm .group-title h3 { font-size: 22px; font-weight: 800; display: flex; align-items: center; gap: 12px; color: var(--text-main); letter-spacing: -0.4px; margin: 0; }
      .lucky-farm .land-title-main { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; min-width: 0; }
      .lucky-farm .land-title-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .lucky-farm .land-title-action {
        display: inline-flex; align-items: center; justify-content: center; gap: 5px;
        border: 1px solid rgba(255,255,255,0.8); background: rgba(255,255,255,0.52);
        color: var(--text-light); padding: 8px 11px; border-radius: 999px;
        font-size: 12px; font-weight: 800; cursor: pointer; transition: all 0.2s;
        min-height: 34px;
        white-space: nowrap;
        box-shadow: 0 8px 16px rgba(15,23,42,0.05), inset 0 1px 0 rgba(255,255,255,0.9);
      }
      .lucky-farm .land-title-action:hover:not(:disabled) {
        color: var(--text-main);
        background: rgba(255,255,255,0.78);
        transform: translateY(-1px);
      }
      .lucky-farm .land-title-action:disabled { opacity: 0.45; cursor: not-allowed; }
      .lucky-farm .land-title-action .count { background: rgba(15,23,42,0.06); color: var(--text-light); padding: 1px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 900; margin-left: 1px; }
      .lucky-farm .group-title-right { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
      .lucky-farm .global-buffs { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
      .lucky-farm .global-buff {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 4px 9px; border-radius: 999px;
        font-size: 11.5px; font-weight: 800; line-height: 1;
        border: 1px solid rgba(15,23,42,0.06);
        background: rgba(255,255,255,0.76);
        box-shadow: 0 6px 16px rgba(15,23,42,0.06), inset 0 1px 0 rgba(255,255,255,0.9);
        backdrop-filter: blur(10px);
        color: var(--text-main);
        white-space: nowrap;
      }
      .lucky-farm .global-buff.scarecrow { color: #92400e; background: rgba(254,243,199,0.82); border-color: rgba(251,191,36,0.28); }
      .lucky-farm .global-buff.bell { color: #1d4ed8; background: rgba(219,234,254,0.82); border-color: rgba(96,165,250,0.28); }
      .lucky-farm .grp-icon { width: 36px; height: 36px; border-radius: 11px; display: flex; align-items: center; justify-content: center; color: #fff; }
      .lucky-farm .grp-icon svg { width: 18px; height: 18px; }
      .lucky-farm .grp-icon.green { background: var(--grad-green); box-shadow: 0 8px 16px rgba(22,163,74,0.32); }
      .lucky-farm .grp-icon.orange { background: var(--grad-orange); box-shadow: 0 8px 16px rgba(249,115,22,0.3); }
      .lucky-farm .grp-icon.amber { background: var(--grad-amber); box-shadow: 0 8px 16px rgba(251,191,36,0.4); color: #92400e; }
      .lucky-farm .grp-count { font-size: 12px; font-weight: 800; background: rgba(15,23,42,0.05); color: var(--text-light); padding: 4px 12px; border-radius: 999px; }

      /* main grid - 土地区 3 份 / 宠物侧栏 1 份，宠物卡面与土地一览底部对齐 */
      .lucky-farm .farm-main { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 1fr); gap: 16px; align-items: stretch; }
      .lucky-farm .farm-main > .lands-section { min-width: 0; }
      .lucky-farm .farm-main > .side-section { min-width: 0; }

      /* lands */
      .lucky-farm .lands-section { display: flex; flex-direction: column; gap: 14px; }
      .lucky-farm .lands-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
      .lucky-farm .land-card {
        background: linear-gradient(180deg, rgba(255,255,255,0.88), rgba(255,255,255,0.6));
        backdrop-filter: blur(20px);
        border: none;
        border-radius: 22px; padding: 16px 14px 14px;
        box-shadow: var(--card-shadow);
        display: flex; flex-direction: column; align-items: center; gap: 10px;
        min-height: 220px; position: relative; overflow: hidden;
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        text-align: center;
      }
      .lucky-farm .land-card.land-visual-only {
        aspect-ratio: 1 / 1;
        min-height: 0;
        justify-content: center;
        padding: 8px;
      }
      .lucky-farm .land-card.land-visual-only .land-soil {
        height: 100%;
        overflow: visible;
      }
      .lucky-farm .land-card.land-visual-only::before {
        display: none;
      }
      .lucky-farm .land-card::before {
        content: ''; position: absolute; top: -40%; right: -30%;
        width: 200px; height: 200px; border-radius: 50%;
        opacity: 0.32; filter: blur(40px); pointer-events: none;
      }
      .lucky-farm .land-card.t-grow::before { background: rgba(132,204,22,0.45); }
      .lucky-farm .land-card.t-mature::before { background: rgba(251,191,36,0.55); }
      .lucky-farm .land-card.t-thirsty::before { background: rgba(56,189,248,0.5); }
      .lucky-farm .land-card.t-locked {
        background:
          linear-gradient(180deg, rgba(15, 23, 42, 0.1), rgba(15, 23, 42, 0.22)),
          url('/images/farm/empty-soil.png') center / 100% 100% no-repeat;
        background-color: transparent;
        box-shadow: 0 12px 28px rgba(95, 60, 28, 0.22);
      }
      .lucky-farm .land-card.t-locked::before { display: none; }
      .lucky-farm .land-card.t-warn::before { background: rgba(244,63,94,0.4); }
      /* 空地卡片：整个 land-card 作为土地图载体，不显示白色玻璃边框 */
      .lucky-farm .land-card.t-empty {
        cursor: pointer; border: none;
        background:
          url('/images/farm/empty-soil.png') center / 100% 100% no-repeat;
        background-color: transparent;
        box-shadow: 0 12px 28px rgba(95, 60, 28, 0.22);
      }
      .lucky-farm .land-card.t-empty:hover {
        transform: translateY(-3px);
        box-shadow: 0 18px 36px rgba(95, 60, 28, 0.32);
      }
      /* 已种植的土地（生长/缺水/成熟）：整张卡片用 PNG 作为背景，与 t-empty 风格统一 */
      .lucky-farm .land-card.t-grow,
      .lucky-farm .land-card.t-thirsty,
      .lucky-farm .land-card.t-mature {
        background:
          url('/images/farm/empty-soil.png') center / 100% 100% no-repeat;
        background-color: transparent;
        box-shadow: 0 12px 28px rgba(95, 60, 28, 0.22);
      }
      .lucky-farm .land-card:hover { transform: translateY(-3px); box-shadow: 0 24px 48px rgba(15,23,42,0.08); }
      .lucky-farm .land-card.quick-open { box-shadow: 0 24px 48px rgba(22,163,74,0.16); }

      /* 田地土壤底纹：垄沟纹理 + 颗粒感，状态化配色 */
      .lucky-farm .land-soil {
        width: 100%; height: 92px;
        display: flex; align-items: center; justify-content: center;
        position: relative; overflow: hidden;
        border-radius: 14px;
        background:
          repeating-linear-gradient(
            90deg,
            rgba(0,0,0,0.10) 0,
            rgba(0,0,0,0.10) 1px,
            transparent 1px,
            transparent 14px
          ),
          radial-gradient(circle at 18% 28%, rgba(0,0,0,0.16) 0 1px, transparent 2px),
          radial-gradient(circle at 72% 62%, rgba(0,0,0,0.14) 0 1px, transparent 2px),
          radial-gradient(circle at 38% 78%, rgba(255,255,255,0.18) 0 1px, transparent 2px),
          radial-gradient(circle at 86% 22%, rgba(255,255,255,0.16) 0 1px, transparent 2px),
          linear-gradient(180deg, #a16b3c 0%, #8a4f25 55%, #6b3a16 100%);
        box-shadow:
          inset 0 -6px 10px rgba(0,0,0,0.28),
          inset 0 2px 4px rgba(255,255,255,0.18),
          inset 0 0 0 1px rgba(0,0,0,0.08);
      }
      /* 田边石头/装饰 - 通用一些点缀 */
      .lucky-farm .land-soil::before {
        content: ''; position: absolute; inset: 0;
        background:
          radial-gradient(ellipse at 8% 88%, rgba(120, 80, 40, 0.6) 0 5px, transparent 7px),
          radial-gradient(ellipse at 94% 92%, rgba(140, 100, 60, 0.55) 0 4px, transparent 6px);
        pointer-events: none;
      }
      /* 已种植的土地（生长/缺水/成熟）：land-soil 完全透明，
         PNG 由 .land-card 自身承载，与 t-empty 风格统一 */
      .lucky-farm .land-card.t-grow .land-soil,
      .lucky-farm .land-card.t-thirsty .land-soil,
      .lucky-farm .land-card.t-mature .land-soil {
        background: transparent;
        background-color: transparent;
        box-shadow: none;
      }
      .lucky-farm .land-card.t-grow .land-soil::before,
      .lucky-farm .land-card.t-thirsty .land-soil::before,
      .lucky-farm .land-card.t-mature .land-soil::before {
        content: none;
      }
      .lucky-farm .land-card.t-thirsty .land-soil::after { content: none; }
      /* 成熟状态保留金光闪烁覆盖层，强化丰收感 */
      .lucky-farm .land-card.t-mature .land-soil::after {
        content: ''; position: absolute; inset: 0;
        background:
          radial-gradient(circle at 18% 30%, rgba(254, 240, 138, 0.95) 0 1.8px, transparent 3.5px),
          radial-gradient(circle at 82% 24%, rgba(254, 240, 138, 0.95) 0 1.8px, transparent 3.5px),
          radial-gradient(circle at 28% 78%, rgba(254, 240, 138, 0.92) 0 1.6px, transparent 3px),
          radial-gradient(circle at 72% 80%, rgba(254, 240, 138, 0.9) 0 1.6px, transparent 3px),
          radial-gradient(circle at 50% 14%, rgba(255, 255, 240, 1) 0 1.4px, transparent 2.8px),
          radial-gradient(circle at 50% 90%, rgba(255, 255, 240, 0.9) 0 1.2px, transparent 2.5px),
          radial-gradient(circle at 38% 52%, rgba(253, 224, 71, 0.75) 0 1px, transparent 2px),
          radial-gradient(circle at 64% 56%, rgba(253, 224, 71, 0.7) 0 1px, transparent 2px);
        animation: lwfSparkleTwinkle 2.4s ease-in-out infinite;
        pointer-events: none;
      }
      @keyframes lwfSparkleTwinkle { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
      /* 枯萎：使用独立枯萎作物图，位置与成熟作物保持一致 */
      .lucky-farm .land-card.t-warn {
        background:
          url('/images/farm/empty-soil.png') center / 100% 100% no-repeat;
        background-color: transparent;
        box-shadow: 0 12px 28px rgba(95, 60, 28, 0.22);
      }
      .lucky-farm .land-card.t-warn .land-soil {
        background: transparent;
        background-color: transparent;
        box-shadow: none;
      }
      .lucky-farm .land-card.t-warn .land-soil::before,
      .lucky-farm .land-card.t-warn .land-soil::after {
        content: none;
      }
      /* 被乌鸦吃掉：整张卡片用土地 PNG 背景 + 乌鸦图片 */
      .lucky-farm .land-card.t-eaten {
        background:
          url('/images/farm/empty-soil.png') center / 100% 100% no-repeat;
        background-color: transparent;
        box-shadow: 0 12px 28px rgba(95, 60, 28, 0.22);
      }
      .lucky-farm .land-card.t-eaten::before { display: none; }
      .lucky-farm .land-card.t-eaten .land-soil {
        background: transparent;
        background-color: transparent;
        box-shadow: none;
      }
      .lucky-farm .land-card.t-eaten .land-soil::before,
      .lucky-farm .land-card.t-eaten .land-soil::after {
        content: none;
      }
      .lucky-farm .land-crow-img {
        width: 80px; height: 80px;
        object-fit: contain;
        position: relative; z-index: 1;
        filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.5));
        animation: lwfCrowLand 3.2s ease-in-out infinite;
        transform-origin: 50% 80%;
      }
      @keyframes lwfCrowLand {
        0%   { transform: translateY(0) rotate(0deg) scale(1); }
        15%  { transform: translateY(-8px) rotate(-4deg) scale(1.03); }
        30%  { transform: translateY(0) rotate(2deg) scale(1); }
        50%  { transform: translateY(-3px) rotate(-2deg) scale(1.01); }
        65%  { transform: translateY(2px) rotate(3deg) scale(0.98); }
        80%  { transform: translateY(-1px) rotate(-1deg) scale(1); }
        100% { transform: translateY(0) rotate(0deg) scale(1); }
      }
      /* 空地（种植背景）：PNG 由 .land-card.t-empty 整体承载，land-soil 完全透明 */
      .lucky-farm .land-card.t-empty .land-soil {
        background: transparent;
        background-color: transparent;
        box-shadow: none;
      }
      .lucky-farm .land-card.t-empty .land-soil::before,
      .lucky-farm .land-card.t-empty .land-soil::after {
        content: none;
      }
      /* 锁定：土地照片背景 + 锁定标识 */
      .lucky-farm .land-card.t-locked .land-soil {
        background: transparent;
        background-color: transparent;
        box-shadow: none;
      }
      .lucky-farm .land-card.t-locked .land-soil::before,
      .lucky-farm .land-card.t-locked .land-soil::after {
        content: none;
      }
      .lucky-farm .land-emoji { font-size: 38px; }
      .lucky-farm .land-lock-icon {
        width: 58px; height: 58px; border-radius: 50%;
        background: rgba(255, 255, 255, 0.82); color: #7c2d12;
        display: flex; align-items: center; justify-content: center;
        box-shadow:
          0 10px 22px rgba(67, 35, 14, 0.28),
          inset 0 0 0 1px rgba(255, 255, 255, 0.7);
        backdrop-filter: blur(6px);
        position: relative;
        z-index: 1;
      }
      .lucky-farm .land-corner-tag { position: absolute; top: 0; right: 4px; font-size: 18px; }
      .lucky-farm .land-water-cans {
        position: absolute; bottom: 4px; right: 6px;
        display: flex; gap: 2px; z-index: 3;
      }
      .lucky-farm .land-water-can {
        width: 28px; height: 28px;
        object-fit: contain;
        filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.4));
        animation: lwfWaterBounce 1.2s ease-in-out infinite;
      }
      .lucky-farm .land-water-can:nth-child(2) {
        animation-delay: 0.3s;
      }
      @keyframes lwfWaterBounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-3px); }
      }
      @keyframes lwfBlink { 0%,100%{ opacity: 1;} 50%{ opacity: 0.55;} }
      .lucky-farm .land-btn {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 7px 14px; border: none; border-radius: 999px;
        font-size: 12px; font-weight: 700; cursor: pointer;
        background: rgba(15,23,42,0.06); color: var(--text-main);
        transition: all 0.2s;
      }
      .lucky-farm .land-btn:hover:not(:disabled) { background: rgba(15,23,42,0.1); transform: translateY(-1px); }
      .lucky-farm .land-btn:disabled { opacity: 0.45; cursor: not-allowed; }
      .lucky-farm .land-btn.primary { background: var(--grad-green); color: #fff; box-shadow: 0 6px 14px rgba(22,163,74,0.3); }
      .lucky-farm .land-quick-actions {
        position: absolute; left: 50%; top: 50%; z-index: 8;
        width: 150px; height: 150px; border-radius: 50%;
        transform: translate(-50%, -50%);
        pointer-events: none;
        animation: lwfQuickIn 0.18s ease-out;
      }
      @keyframes lwfQuickIn { from { opacity: 0; transform: translate(-50%, -50%) scale(0.82); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
      .lucky-farm .land-quick-btn {
        position: absolute; top: 50%; left: 50%;
        width: 42px; height: 42px; padding: 0; border: none; border-radius: 50%;
        display: inline-flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.96); color: #15803d;
        box-shadow: 0 10px 22px rgba(15,23,42,0.16), inset 0 1px 0 rgba(255,255,255,1);
        cursor: pointer; transition: all 0.2s ease;
        pointer-events: auto;
      }
      .lucky-farm .land-quick-btn:nth-child(1) { transform: translate(-50%, -50%) translate(0, -66px); }
      .lucky-farm .land-quick-btn:nth-child(2) { transform: translate(-50%, -50%) translate(63px, -20px); }
      .lucky-farm .land-quick-btn:nth-child(3) { transform: translate(-50%, -50%) translate(39px, 55px); }
      .lucky-farm .land-quick-btn:nth-child(4) { transform: translate(-50%, -50%) translate(-39px, 55px); }
      .lucky-farm .land-quick-btn:nth-child(5) { transform: translate(-50%, -50%) translate(-63px, -20px); }
      .lucky-farm .land-quick-btn:hover:not(:disabled) { background: var(--grad-green); color: #fff; box-shadow: 0 12px 26px rgba(22,163,74,0.28); }
      .lucky-farm .land-quick-btn:nth-child(1):hover:not(:disabled) { transform: translate(-50%, -50%) translate(0, -69px) scale(1.04); }
      .lucky-farm .land-quick-btn:nth-child(2):hover:not(:disabled) { transform: translate(-50%, -50%) translate(66px, -22px) scale(1.04); }
      .lucky-farm .land-quick-btn:nth-child(3):hover:not(:disabled) { transform: translate(-50%, -50%) translate(41px, 58px) scale(1.04); }
      .lucky-farm .land-quick-btn:nth-child(4):hover:not(:disabled) { transform: translate(-50%, -50%) translate(-41px, 58px) scale(1.04); }
      .lucky-farm .land-quick-btn:nth-child(5):hover:not(:disabled) { transform: translate(-50%, -50%) translate(-66px, -22px) scale(1.04); }
      .lucky-farm .land-quick-btn.land-quick-primary {
        background: var(--grad-green);
        color: #fff;
      }
      .lucky-farm .land-quick-btn:disabled {
        opacity: 0.42; cursor: not-allowed; color: #94a3b8; box-shadow: 0 6px 14px rgba(15,23,42,0.08);
      }
      .lucky-farm .land-quick-btn.land-quick-primary:disabled {
        background: rgba(255,255,255,0.96);
      }
      .lucky-farm .land-quick-btn svg { width: 18px; height: 18px; }
      @keyframes lwfPulse { 0%,100%{ transform: scale(1);} 50%{ transform: scale(1.04);} }

      /* side cards (pet + events) */
      .lucky-farm .side-section { display: flex; flex-direction: column; gap: 16px; min-height: 100%; }
      .lucky-farm .side-section .pet-card { flex: 1; display: flex; flex-direction: column; }
      .lucky-farm .side-card {
        background: linear-gradient(180deg, rgba(255,255,255,0.88), rgba(255,255,255,0.6));
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255,255,255,0.9);
        border-radius: 24px; padding: 18px;
        box-shadow: var(--card-shadow), inset 0 1px 0 rgba(255,255,255,1);
        position: relative; overflow: hidden;
      }
      .lucky-farm .side-card-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
      .lucky-farm .side-card-title strong { display: block; font-size: 16px; color: var(--text-main); font-weight: 800; }
      .lucky-farm .side-card-title span { font-size: 12px; color: var(--text-light); font-weight: 600; }
      .lucky-farm .pet-title-meta { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .lucky-farm .pet-title-mood {
        font-style: normal; padding: 2px 8px; border-radius: 999px;
        font-size: 11px; font-weight: 800; line-height: 1.3;
      }
      .lucky-farm .pet-title-mood.mood-great { background: rgba(236,72,153,0.14); color: #be185d; }
      .lucky-farm .pet-title-mood.mood-good { background: rgba(34,197,94,0.14); color: #15803d; }
      .lucky-farm .pet-title-mood.mood-soft { background: rgba(244,114,182,0.14); color: #be185d; }
      .lucky-farm .pet-title-mood.mood-calm { background: rgba(100,116,139,0.12); color: #475569; }
      .lucky-farm .pet-title-mood.mood-warn { background: rgba(249,115,22,0.14); color: #c2410c; }
      .lucky-farm .pet-title-mood.mood-bad { background: rgba(239,68,68,0.14); color: #b91c1c; }

      .lucky-farm .pet-card {
        background:
          radial-gradient(circle at 90% 0%, rgba(251,191,36,0.18), transparent 55%),
          radial-gradient(circle at 0% 100%, rgba(132,204,22,0.14), transparent 50%),
          linear-gradient(180deg, rgba(255,255,255,0.92), rgba(247,254,231,0.85));
      }
      .lucky-farm .pet-card .side-card-head {
        padding: 4px 4px 12px;
        border-bottom: 1px dashed rgba(132,204,22,0.25);
        margin-bottom: 14px;
      }
      .lucky-farm .pet-card .side-card-title strong { font-size: 18px; letter-spacing: -0.2px; }
      .lucky-farm .pet-card .grp-icon.orange {
        width: 40px; height: 40px; border-radius: 14px;
        box-shadow: 0 10px 18px rgba(249,115,22,0.32);
      }

      .lucky-farm .pet-empty-card { text-align: center; padding: 28px 18px; }
      .lucky-farm .pet-empty-icon { width: 64px; height: 64px; border-radius: 50%; background: rgba(249,115,22,0.12); color: var(--c-orange); display: flex; align-items: center; justify-content: center; margin: 0 auto 12px; }
      .lucky-farm .pet-empty-card h3 { font-size: 18px; font-weight: 800; color: var(--text-main); margin: 0 0 4px; }
      .lucky-farm .pet-empty-card p { font-size: 13px; color: var(--text-light); margin: 0 0 14px; }

      .lucky-farm .pet-sprite-row { display: flex; justify-content: center; padding: 6px 0 14px; }
      .lucky-farm .pet-sprite-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 10px 16px;
        border-radius: 28px;
        background:
          radial-gradient(circle at 30% 25%, rgba(255,255,255,0.85), rgba(255,255,255,0.4) 60%, transparent 80%),
          linear-gradient(180deg, #ecfccb 0%, #d9f99d 100%);
        box-shadow: 0 14px 28px rgba(132,204,22,0.18), inset 0 1px 0 rgba(255,255,255,0.9);
        min-height: 132px;
        cursor: pointer;
        touch-action: none;
        user-select: none;
      }
      .lucky-farm .pet-sprite-wrap:focus-visible {
        outline: 3px solid rgba(22,163,74,0.38);
        outline-offset: 3px;
      }
      .lucky-farm .pet-speech-bubble {
        position: absolute; left: calc(100% + 6px); top: 50%;
        transform: translateY(-50%);
        background: #fff; color: #15803d;
        padding: 8px 13px; border-radius: 16px;
        font-size: 12.5px; font-weight: 700; line-height: 1.35;
        max-width: 150px; min-width: 80px;
        box-shadow: 0 8px 18px rgba(15,23,42,0.10), inset 0 1px 0 rgba(255,255,255,1);
        border: 1px solid rgba(132,204,22,0.35);
        animation: lwfSpeechIn 0.4s cubic-bezier(0.18, 1.2, 0.6, 1.05);
        pointer-events: none;
        z-index: 2;
        text-align: center;
        word-break: break-word; white-space: normal;
      }
      .lucky-farm .pet-speech-bubble::after {
        content: ''; position: absolute; left: -7px; top: 50%; transform: translateY(-50%);
        width: 0; height: 0;
        border-top: 6px solid transparent; border-bottom: 6px solid transparent;
        border-right: 7px solid #fff;
        filter: drop-shadow(-1px 0 0 rgba(132,204,22,0.35));
      }
      .lucky-farm .pet-speech-bubble.mood-bad { color: #b91c1c; border-color: rgba(239,68,68,0.4); }
      .lucky-farm .pet-speech-bubble.mood-warn { color: #c2410c; border-color: rgba(249,115,22,0.4); }
      .lucky-farm .pet-speech-bubble.mood-great { color: #be185d; border-color: rgba(236,72,153,0.4); }
      @keyframes lwfSpeechIn {
        0% { opacity: 0; transform: translate(8px, -50%) scale(0.85); }
        100% { opacity: 1; transform: translate(0, -50%) scale(1); }
      }

      .lucky-farm .pet-stats {
        display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px;
        margin: 6px 0 14px;
        padding: 12px 14px;
        background: rgba(255,255,255,0.7);
        border-radius: 18px;
        border: 1px solid rgba(255,255,255,0.95);
        box-shadow: inset 0 1px 0 rgba(255,255,255,1), 0 4px 12px rgba(15,23,42,0.04);
      }
      .lucky-farm .pet-stat {
        display: flex; flex-direction: column; gap: 4px;
        font-size: 12px;
      }
      .lucky-farm .pet-stat-row { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
      .lucky-farm .pet-stat-label { color: var(--text-light); font-weight: 700; letter-spacing: 0.2px; }
      .lucky-farm .pet-stat-bar { height: 7px; background: rgba(15,23,42,0.06); border-radius: 999px; overflow: hidden; }
      .lucky-farm .pet-stat-fill { height: 100%; transition: width .4s; border-radius: 999px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.5); }
      .lucky-farm .pet-stat-val { color: var(--text-main); font-weight: 800; font-size: 12px; }

      .lucky-farm .pet-task-status {
        background: linear-gradient(135deg, rgba(132,204,22,0.18), rgba(22,163,74,0.12));
        padding: 9px 14px; border-radius: 14px;
        font-size: 13px; color: var(--c-green); text-align: center;
        margin-bottom: 10px; font-weight: 800;
        border: 1px dashed rgba(22,163,74,0.35);
      }
      .lucky-farm .pet-task-status.idle { background: rgba(15,23,42,0.05); color: var(--text-light); border-color: rgba(15,23,42,0.1); }

      .lucky-farm .pet-care {
        display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px;
      }
      .lucky-farm .pet-btn {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 4px;
        padding: 10px 4px;
        border-radius: 16px;
        border: 1px solid rgba(132,204,22,0.25);
        background: linear-gradient(180deg, #ffffff 0%, #f7fee7 100%);
        color: #15803d;
        font-size: 12px; font-weight: 800;
        cursor: pointer; transition: all 0.2s;
        box-shadow: 0 4px 12px rgba(132,204,22,0.10), inset 0 1px 0 rgba(255,255,255,1);
        min-height: 64px;
      }
      .lucky-farm .pet-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        background: linear-gradient(180deg, #ffffff 0%, #ecfccb 100%);
        border-color: rgba(132,204,22,0.5);
        box-shadow: 0 10px 20px rgba(132,204,22,0.20);
      }
      .lucky-farm .pet-btn:active:not(:disabled) { transform: translateY(0); }
      .lucky-farm .pet-btn:disabled { opacity: 0.45; cursor: not-allowed; }
      .lucky-farm .pet-btn-icon { font-size: 22px; line-height: 1; filter: drop-shadow(0 2px 3px rgba(15,23,42,0.12)); }
      .lucky-farm .pet-btn-label { font-size: 11.5px; font-weight: 800; }

      .lucky-farm .pet-skill-popover {
        position: absolute;
        left: 16px;
        right: 16px;
        top: 104px;
        z-index: 8;
        padding: 14px;
        border-radius: 20px;
        background: rgba(255,255,255,0.96);
        border: 1px solid rgba(132,204,22,0.28);
        box-shadow: 0 24px 54px rgba(15,23,42,0.18), inset 0 1px 0 rgba(255,255,255,1);
        backdrop-filter: blur(16px);
      }
      .lucky-farm .pet-skill-popover-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 10px;
      }
      .lucky-farm .pet-skill-popover-head strong {
        color: var(--text-main);
        font-size: 15px;
        font-weight: 900;
      }
      .lucky-farm .pet-skill-popover-head button {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 1px solid rgba(15,23,42,0.10);
        background: #fff;
        color: var(--text-light);
        cursor: pointer;
        font-size: 17px;
        line-height: 1;
      }
      .lucky-farm .pet-skill-list { display: flex; flex-direction: column; gap: 7px; }
      .lucky-farm .pet-skill-known,
      .lucky-farm .pet-skill-hint {
        margin-bottom: 8px;
        padding: 8px 10px;
        border-radius: 12px;
        background: rgba(132,204,22,0.10);
        color: #15803d;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.45;
      }
      .lucky-farm .pet-skill-hint { color: var(--text-light); background: rgba(15,23,42,0.04); }
      .lucky-farm .pet-task-btn {
        width: 100%; padding: 10px 12px;
        border-radius: 14px; border: 1px solid rgba(132,204,22,0.3);
        background: linear-gradient(135deg, #ecfccb, #d9f99d);
        color: #15803d; font-weight: 800; cursor: pointer;
        margin-top: 6px; transition: all 0.2s; font-size: 13px;
        text-align: left;
        display: flex; align-items: center; gap: 6px;
      }
      .lucky-farm .pet-task-btn:hover:not(:disabled) { background: var(--grad-green); color: #fff; box-shadow: 0 8px 16px rgba(22,163,74,0.25); transform: translateY(-1px); }
      .lucky-farm .pet-task-btn:disabled {
        cursor: not-allowed;
        opacity: 0.55;
        background: rgba(15,23,42,0.05);
        color: var(--text-light);
        border-color: rgba(15,23,42,0.08);
      }
      .lucky-farm .pet-task-btn.locked { border-style: dashed; }

      .lucky-farm .event-list { display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow-y: auto; }
      .lucky-farm .event-empty { text-align: center; color: var(--text-light); padding: 18px; font-size: 13px; }
      .lucky-farm .event-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; padding: 7px 10px; border-radius: 10px; background: rgba(15,23,42,0.03); }
      .lucky-farm .event-icon { font-size: 15px; flex-shrink: 0; }
      .lucky-farm .event-text { flex: 1; color: var(--text-main); }
      .lucky-farm .event-time { color: var(--text-light); font-size: 11px; flex-shrink: 0; }
      .lucky-farm .event-row.ev-mature { background: rgba(254,243,199,0.55); }
      .lucky-farm .event-row.ev-crow_eat { background: rgba(254,226,226,0.55); }
      .lucky-farm .event-row.ev-stolen_in { background: rgba(254,226,226,0.55); }
      .lucky-farm .event-row.ev-stolen_out { background: rgba(220,252,231,0.55); }
      .lucky-farm .event-row.ev-harvest { background: rgba(220,252,231,0.55); }

      /* loading */
      .lucky-farm .farm-loading {
        min-height: 80vh; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 14px; color: var(--c-green);
      }
      .lucky-farm .farm-loading svg { animation: lwfPetBounce 1s ease-in-out infinite; }
      @keyframes lwfPetBounce { 0%,100%{ transform: translateY(0);} 50%{ transform: translateY(-8px);} }

      .lucky-farm .loading-bar {
        position: fixed; top: 0; left: 0; right: 0; height: 3px;
        background: linear-gradient(90deg, transparent, var(--c-green), transparent);
        animation: lwfLoadingMove 1s linear infinite; z-index: 200;
      }
      @keyframes lwfLoadingMove { from { transform: translateX(-100%);} to { transform: translateX(100%);} }

      /* sprite 内动画 */
      .farm-sprite-sway { transform-origin: 50px 88px; animation: spriteSway 3s ease-in-out infinite; }
      @keyframes spriteSway { 0%,100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }
      .farm-sprite-bounce { transform-origin: 50px 88px; animation: spriteBounce 2s ease-in-out infinite; }
      @keyframes spriteBounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
      .farm-pet-sprite {
        display: block;
        filter: drop-shadow(0 10px 16px rgba(15,23,42,0.14));
      }
      .farm-pet-pixel-image {
        image-rendering: pixelated;
        image-rendering: crisp-edges;
      }
      .farm-pet-bouncing { animation: petBounce 2.4s ease-in-out infinite; }
      .farm-pet-walking { animation: petWalk 0.8s ease-in-out infinite; }
      @keyframes petBounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
      @keyframes petWalk { 0%,100% { transform: translateY(0) rotate(-1deg); } 50% { transform: translateY(-2px) rotate(1deg); } }
      .farm-pet-tail {
        transform-box: fill-box;
        transform-origin: 15% 82%;
        animation: wagTail 1.45s ease-in-out infinite;
      }
      @keyframes wagTail { 0%,100% { transform: rotate(-10deg); } 50% { transform: rotate(13deg); } }
      .farm-pet-ear {
        transform-box: fill-box;
        transform-origin: 50% 100%;
        animation: petEarWiggle 5s ease-in-out infinite;
      }
      .farm-pet-eye {
        transform-box: fill-box;
        transform-origin: 50% 50%;
        animation: petBlink 4.6s ease-in-out infinite;
      }
      .farm-pet-heart {
        transform-box: fill-box;
        transform-origin: 50% 50%;
        animation: petHeartFloat 2.4s ease-in-out infinite;
      }
      .farm-pet-heart.delay { animation-delay: 0.45s; }
      .farm-pet-sparkle {
        transform-box: fill-box;
        transform-origin: 50% 50%;
        animation: petSparkle 2s ease-in-out infinite;
      }
      .farm-pet-sparkle.idle { animation-duration: 2.8s; }
      .farm-pet-working-mark { animation: petWorkPop 0.9s ease-in-out infinite; }
      @keyframes petEarWiggle { 0%, 86%, 100% { transform: rotate(0deg); } 90% { transform: rotate(-5deg); } 94% { transform: rotate(4deg); } }
      @keyframes petBlink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(0.12); } }
      @keyframes petHeartFloat { 0%,100% { transform: translateY(0) scale(1); opacity: 0.9; } 50% { transform: translateY(-4px) scale(1.08); opacity: 1; } }
      @keyframes petSparkle { 0%,100% { transform: scale(0.82) rotate(0deg); opacity: 0.62; } 50% { transform: scale(1.12) rotate(12deg); opacity: 1; } }
      @keyframes petWorkPop { 0%,100% { transform: translateY(0); opacity: 0.72; } 50% { transform: translateY(-3px); opacity: 1; } }

      /* 响应式 */
      @media (max-width: 1280px) {
        .lucky-farm .container { padding: 24px 32px 48px; }
        .lucky-farm .hero-title { font-size: 38px; }
        .lucky-farm .stats-grid { grid-template-columns: repeat(2, 1fr); }
        .lucky-farm .farm-main { grid-template-columns: 1fr; }
        .lucky-farm .farm-main > .lands-section,
        .lucky-farm .farm-main > .side-section { grid-column: auto; }
        .lucky-farm .side-section { min-height: auto; }
      }
      @media (max-width: 992px) {
        .lucky-farm .topbar { padding: 14px 24px; }
        .lucky-farm .container { padding: 20px 24px 40px; }
        .lucky-farm .hero-title { font-size: 30px; }
        .lucky-farm .store-hero { padding: 28px 24px; border-radius: 28px; }
        .lucky-farm .lands-grid { grid-template-columns: repeat(3, 1fr); }
        .lucky-farm .user-info { display: none; }
        .lucky-farm .user-profile { padding: 4px; }
      }
      @media (max-width: 640px) {
        .lucky-farm .topbar { padding: 12px 16px; }
        .lucky-farm .container { padding: 16px 12px 32px; }
        .lucky-farm .store-hero { padding: 22px 18px; border-radius: 24px; }
        .lucky-farm .hero-title { font-size: 26px; }
        .lucky-farm .hero-points-card { width: 100%; }
        .lucky-farm .stats-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
        .lucky-farm .stat-card { padding: 16px; }
        .lucky-farm .stat-value { font-size: 26px; }
        .lucky-farm .lands-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
        .lucky-farm .land-card { padding: 10px 8px 8px; min-height: 160px; }
        .lucky-farm .land-title-main { width: 100%; }
        .lucky-farm .land-title-actions { width: 100%; gap: 6px; }
        .lucky-farm .land-title-action { flex: 1 1 104px; padding: 8px 7px; font-size: 11.5px; }
        .lucky-farm .pet-care { grid-template-columns: repeat(5, 1fr); gap: 6px; }
        .lucky-farm .pet-btn { padding: 8px 2px; min-height: 56px; }
        .lucky-farm .pet-btn-icon { font-size: 20px; }
        .lucky-farm .pet-btn-label { font-size: 11px; }
        .lucky-farm .pet-stats { grid-template-columns: 1fr 1fr; }
      }

      /* === 手机端重排 v2：参考排行榜/游戏中心 === */
      @media (max-width: 640px) {
        .lucky-farm .mesh-bg {
          opacity: 0.72;
          filter: blur(42px);
        }

        /* 顶栏：fixed 全宽磨砂，不随页面滚动 */
        .lucky-farm .topbar {
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
          background: rgba(248, 252, 245, 0.85);
          backdrop-filter: blur(24px) saturate(1.6);
          -webkit-backdrop-filter: blur(24px) saturate(1.6);
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
        }
        .lucky-farm .brand {
          min-width: 0;
          gap: 8px;
          font-size: 16px;
          letter-spacing: 0;
        }
        .lucky-farm .brand-icon {
          width: 34px;
          height: 34px;
          border-radius: 13px;
          flex: 0 0 auto;
        }
        .lucky-farm .topbar-right {
          min-width: 0;
          gap: 6px;
        }
        .lucky-farm .topbar .btn-icon {
          width: 36px;
          height: 36px;
          border-radius: 14px;
          flex: 0 0 auto;
          background: rgba(255, 255, 255, 0.92);
        }
        .lucky-farm .topbar .btn-icon svg { width: 16px; height: 16px; }
        .lucky-farm .user-profile {
          width: 36px;
          height: 36px;
          justify-content: center;
          padding: 0;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.92);
        }
        .lucky-farm .user-profile .avatar {
          width: 32px;
          height: 32px;
          border-radius: 12px;
        }

        /* 容器：给 fixed topbar 让出空间 */
        .lucky-farm .container {
          padding: max(72px, calc(60px + env(safe-area-inset-top))) 12px max(40px, calc(28px + env(safe-area-inset-bottom)));
          gap: 14px;
        }

        /* Hero 紧凑 */
        .lucky-farm .store-hero {
          padding: 20px 16px;
          border-radius: 22px;
        }
        .lucky-farm .hero-content {
          flex-direction: column;
          gap: 14px;
        }
        .lucky-farm .hero-badge {
          font-size: 10.5px;
          padding: 5px 10px;
          letter-spacing: 0;
        }
        .lucky-farm .hero-title {
          font-size: 22px;
          line-height: 1.15;
          letter-spacing: -0.5px;
          margin-bottom: 8px;
        }
        .lucky-farm .hero-sub { font-size: 12.5px; line-height: 1.55; }
        .lucky-farm .hero-meta {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 6px;
          margin-top: 8px;
        }
        .lucky-farm .hero-meta-chip {
          padding: 5px 8px;
          font-size: 10.5px;
          gap: 4px;
          justify-content: center;
          letter-spacing: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .lucky-farm .hero-points-wrap { width: 100%; }
        .lucky-farm .hero-points-card {
          width: 100%;
          padding: 12px 14px;
          border-radius: 18px;
          gap: 12px;
        }
        .lucky-farm .hpc-star { width: 40px; height: 40px; }
        .lucky-farm .hpc-star svg { width: 18px; height: 18px; }
        .lucky-farm .hpc-label { font-size: 10px; }
        .lucky-farm .hpc-value { font-size: 22px; }
        .lucky-farm .hpc-value .unit { font-size: 11px; margin-left: 4px; }

        /* 页头 */
        .lucky-farm .page-header { gap: 10px; align-items: flex-start; }
        .lucky-farm .header-left .section-title { font-size: 18px; gap: 8px; }
        .lucky-farm .section-title .title-icon { width: 32px; height: 32px; border-radius: 10px; }
        .lucky-farm .header-subtitle { font-size: 12px; line-height: 1.55; }

        /* Stats 2x2 紧凑 */
        .lucky-farm .stats-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .lucky-farm .stat-card {
          padding: 14px 12px;
          border-radius: 18px;
          min-height: 0;
        }
        .lucky-farm .stat-head { gap: 8px; margin-bottom: 8px; }
        .lucky-farm .stat-icon { width: 32px; height: 32px; border-radius: 10px; }
        .lucky-farm .stat-icon svg { width: 16px; height: 16px; }
        .lucky-farm .stat-label { font-size: 10.5px; letter-spacing: 0; }
        .lucky-farm .stat-value { font-size: 20px; }
        .lucky-farm .stat-unit { font-size: 10.5px; }

        /* 土地行动按钮 2x2 紧凑网格 */
        .lucky-farm .group-title { gap: 10px; }
        .lucky-farm .group-title h3 { font-size: 15px; gap: 8px; }
        .lucky-farm .group-title .grp-icon { width: 28px; height: 28px; border-radius: 9px; }
        .lucky-farm .land-title-main { gap: 10px; }
        .lucky-farm .land-title-actions {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 6px;
        }
        .lucky-farm .land-title-action {
          flex: none;
          padding: 8px 6px;
          font-size: 11px;
          gap: 4px;
          border-radius: 12px;
          justify-content: center;
        }
        .lucky-farm .land-title-action svg { width: 13px; height: 13px; }
        .lucky-farm .land-title-action .count { font-size: 9.5px; padding: 1px 5px; }

        /* 土地网格保持 2 列，但卡片更紧凑 */
        .lucky-farm .lands-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .lucky-farm .land-card {
          padding: 10px 8px 8px;
          min-height: 150px;
          border-radius: 16px;
        }
        .lucky-farm .land-soil {
          height: 76px;
        }
        .lucky-farm .land-soil svg { width: 64px; height: 64px; }
        .lucky-farm .land-emoji { font-size: 30px; }
        .lucky-farm .land-crow-img { width: 60px; height: 60px; }

        /* 宠物面板 */
        .lucky-farm .pet-care {
          grid-template-columns: repeat(5, 1fr);
          gap: 5px;
        }
        .lucky-farm .pet-btn {
          padding: 8px 2px;
          min-height: 56px;
          border-radius: 12px;
        }
        .lucky-farm .pet-btn-icon { font-size: 20px; }
        .lucky-farm .pet-btn-label { font-size: 10.5px; }
        .lucky-farm .pet-stats {
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
      }

      @media (max-width: 480px) {
        .lucky-farm .topbar {
          padding: 9px 12px;
          padding-top: max(9px, env(safe-area-inset-top));
          gap: 6px;
        }
        .lucky-farm .brand { font-size: 15px; gap: 7px; }
        .lucky-farm .brand-icon { width: 32px; height: 32px; border-radius: 12px; }
        .lucky-farm .brand-icon svg { width: 16px; height: 16px; }
        .lucky-farm .topbar .btn-icon { width: 34px; height: 34px; border-radius: 13px; }
        .lucky-farm .topbar .btn-icon svg { width: 15px; height: 15px; }
        .lucky-farm .user-profile { width: 34px; height: 34px; border-radius: 13px; }
        .lucky-farm .user-profile .avatar { width: 30px; height: 30px; border-radius: 11px; font-size: 11px; }

        .lucky-farm .container { padding: max(68px, calc(56px + env(safe-area-inset-top))) 10px max(36px, calc(24px + env(safe-area-inset-bottom))); }

        .lucky-farm .store-hero { padding: 18px 14px; border-radius: 20px; }
        .lucky-farm .hero-title { font-size: 20px; }
        .lucky-farm .hero-sub { font-size: 12px; }
        .lucky-farm .hero-meta { gap: 5px; }
        .lucky-farm .hero-meta-chip { padding: 4px 6px; font-size: 10px; }

        .lucky-farm .stat-card { padding: 12px 10px; border-radius: 16px; }
        .lucky-farm .stat-icon { width: 28px; height: 28px; }
        .lucky-farm .stat-icon svg { width: 14px; height: 14px; }
        .lucky-farm .stat-value { font-size: 18px; }

        /* 480px 时土地保持 2 列但更紧凑 */
        .lucky-farm .lands-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .lucky-farm .land-card { min-height: 138px; padding: 8px 6px 6px; border-radius: 14px; }
        .lucky-farm .land-soil { height: 68px; }
        .lucky-farm .land-soil svg { width: 56px; height: 56px; }
        .lucky-farm .land-emoji { font-size: 26px; }
        .lucky-farm .land-crow-img { width: 52px; height: 52px; }
        .lucky-farm .land-btn { padding: 6px 8px; font-size: 11px; }

        .lucky-farm .land-title-action { font-size: 10.5px; padding: 7px 5px; }
      }
    `}</style>
  );
}
