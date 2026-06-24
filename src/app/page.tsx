'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Album,
  ArrowRight,
  Calendar,
  ChevronRight,
  Gamepad2,
  Gift,
  Megaphone,
  Recycle,
  ShoppingBag,
  Sparkles,
  Sprout,
  Trophy,
  Users,
  UserRound,
  X,
} from 'lucide-react';
import SiteSidebar from '@/components/SiteSidebar';
import MarkdownPreview from '@/components/MarkdownPreview';
import TypewriterTitle from '@/components/TypewriterTitle';
import { formatChinaDateTime } from '@/lib/time';

interface Project {
  id: string;
  name: string;
  description?: string;
  maxClaims: number;
  claimedCount: number;
  codesCount: number;
  status: 'active' | 'paused' | 'exhausted';
  rewardType?: 'code' | 'direct';
  directPoints?: number;
  directDollars?: number;
}

interface HotReward {
  id: string;
  href: string;
  prize: string;
  status: string;
  remain: string;
  stock: string;
  remainCount: number;
  progress: number;
  hot: boolean;
  description?: string;
  rewardType?: 'code' | 'direct';
  directPoints?: number;
  directDollars?: number;
}

// 公告（来自 /api/announcements，需登录访问）
interface AnnouncementItem {
  id: string;
  title: string;
  content: string;
  publishedAt?: number;
  createdAt: number;
  createdBy: string;
}

// 多人抽奖活动（来自 /api/raffle?active=true）
interface RafflePrize {
  id: string;
  name: string;
  points?: number;
  dollars?: number;
  quantity: number;
}

interface RaffleItem {
  id: string;
  mode?: 'draw' | 'red_packet';
  title: string;
  description: string;
  coverImage?: string;
  prizes: RafflePrize[];
  triggerType: 'threshold' | 'manual' | 'scheduled';
  threshold: number;
  scheduledDrawAt?: number;
  status: 'draft' | 'active' | 'ended' | 'cancelled';
  participantsCount: number;
  winnersCount: number;
  drawnAt?: number;
  redPacketTotalPoints?: number;
  redPacketTotalSlots?: number;
  redPacketRemainingPoints?: number;
  redPacketRemainingSlots?: number;
  createdAt: number;
}

// 公告栏混合项
type BoardItem =
  | { kind: 'announcement'; data: AnnouncementItem }
  | { kind: 'reward'; data: HotReward }
  | { kind: 'raffle'; data: RaffleItem };

// 当前打开的弹窗
type ActiveModal =
  | { type: 'announcement'; data: AnnouncementItem }
  | { type: 'reward'; data: HotReward }
  | { type: 'raffle'; data: RaffleItem }
  | null;

function getRafflePrizePoints(prize: { points?: number; dollars?: number }): number {
  const normalize = (value: unknown) => {
    const points = Number(value);
    if (!Number.isFinite(points) || points <= 0) return null;
    return Math.max(0, Math.round(points));
  };
  return normalize(prize.points) ?? normalize(prize.dollars) ?? 0;
}

function formatRafflePoints(points: number): string {
  return `${points.toLocaleString('zh-CN')} 积分`;
}

// 相对时间格式化（公告时间显示）
function formatRelativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} 天前`;
  const target = new Date(ts);
  const M = String(target.getMonth() + 1).padStart(2, '0');
  const D = String(target.getDate()).padStart(2, '0');
  return `${M}-${D}`;
}

// 完整时间格式化（弹窗内显示）
function formatExactTime(ts: number): string {
  const target = new Date(ts);
  const Y = target.getFullYear();
  const M = String(target.getMonth() + 1).padStart(2, '0');
  const D = String(target.getDate()).padStart(2, '0');
  const h = String(target.getHours()).padStart(2, '0');
  const m = String(target.getMinutes()).padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}`;
}

const cards = [
  {
    href: '/rankings',
    className: 'card-1',
    title: '排行榜',
    desc: '查看最新排行情况，获取更多专属奖励。',
    icon: <Trophy />,
  },
  {
    href: '/games',
    className: 'card-2',
    title: '游戏中心',
    desc: '沉浸式游戏体验。玩游戏赚取海量积分。',
    icon: <Gamepad2 />,
  },
  {
    href: '/store',
    className: 'card-3',
    title: '福利商店',
    desc: '积分兑奖、免费福利、签到补签一站直达。',
    icon: <ShoppingBag />,
  },
  {
    href: '/lottery',
    className: 'card-4',
    title: '幸运抽奖',
    desc: '每日免费抽奖！最高可得 20刀 现金奖励。',
    icon: <Sparkles />,
  },
  {
    href: '/cards',
    className: 'card-5',
    title: '卡牌图鉴',
    desc: '开启卡包，集齐稀有精美卡牌图鉴赢大奖。',
    icon: <Album />,
  },
  {
    href: '/farm',
    className: 'card-6',
    title: '开心农场',
    desc: '种菜浇水、养宠物偷菜，经营庄园获得海量积分。',
    icon: <Sprout />,
  },
  {
    href: '/games/eco',
    className: 'card-7',
    title: '环保行动',
    desc: '拖垃圾进回收桶赚积分，挂机也能攒，升级商店越玩越高效。',
    icon: <Recycle />,
  },
];

function ArrowIcon() {
  return <ArrowRight />;
}

function buildHotRewards(projects: Project[]): HotReward[] {
  return projects.map((project, index) => {
    const maxClaims = Math.max(1, Number(project.maxClaims) || 1);
    const claimedCount = Math.max(0, Number(project.claimedCount) || 0);
    const codesCount = Math.max(0, Number(project.codesCount) || 0);
    const remain = Math.max(0, maxClaims - claimedCount);
    const stock = Math.max(0, codesCount - claimedCount);
    const progress = Math.min(100, Math.max(0, (remain / maxClaims) * 100));
    const directPoints = project.directPoints ?? project.directDollars ?? 0;
    const directPrize = project.rewardType === 'direct' && directPoints
      ? `${directPoints.toLocaleString('zh-CN')}积分`
      : '';

    return {
      id: project.id,
      href: `/project/${project.id}`,
      prize: project.name || directPrize || '福利活动',
      status: project.status === 'active' ? '进行中' : '已结束',
      remain: `剩 ${remain} 份`,
      stock: `库存 ${stock || remain}`,
      remainCount: remain,
      progress,
      hot: index === 0 || remain <= 2,
      description: project.description,
      rewardType: project.rewardType,
      directPoints,
      directDollars: project.directDollars,
    };
  });
}

// 福利卡（橙色玻璃态，点击触发弹窗）
function RewardCard({
  reward,
  onOpen,
}: {
  reward: HotReward;
  onOpen: (r: HotReward) => void;
}) {
  return (
    <button
      type="button"
      className="reward-card"
      onClick={() => onOpen(reward)}
      aria-label={`查看福利：${reward.prize}`}
    >
      <div className="reward-card-top">
        <span className="reward-tag">
          <Gift size={11} strokeWidth={2.4} />
          福利
        </span>
        <span className={reward.hot ? 'reward-status reward-status-hot' : 'reward-status'}>
          {reward.status}
        </span>
      </div>
      <h4 className="reward-prize">{reward.prize}</h4>
      <div className="reward-progress-wrapper">
        <div className="reward-progress-bar" style={{ width: `${reward.progress}%` }} />
      </div>
      <div className="reward-footer">
        <span>{reward.remain}</span>
        <span>{reward.stock}</span>
      </div>
    </button>
  );
}

// 抽奖卡（粉色玻璃态，点击触发弹窗）
function RaffleCard({
  raffle,
  onOpen,
}: {
  raffle: RaffleItem;
  onOpen: (r: RaffleItem) => void;
}) {
  const isRedPacket = raffle.mode === 'red_packet';
  const totalQuantity = isRedPacket
    ? raffle.redPacketTotalSlots ?? 0
    : raffle.prizes.reduce((acc, p) => acc + (p.quantity || 0), 0);
  const totalPool = isRedPacket
    ? raffle.redPacketTotalPoints ?? 0
    : raffle.prizes.reduce((acc, p) => acc + getRafflePrizePoints(p) * (p.quantity || 0), 0);
  const remainingSlots = isRedPacket
    ? raffle.redPacketRemainingSlots ?? Math.max(0, totalQuantity - raffle.participantsCount)
    : 0;
  const topPrize = raffle.prizes.reduce((best, p) => {
    if (!best) return p;
    return getRafflePrizePoints(p) > getRafflePrizePoints(best) ? p : best;
  }, raffle.prizes[0]);
  const progress =
    isRedPacket && totalQuantity > 0
      ? Math.min(100, Math.max(0, (raffle.participantsCount / totalQuantity) * 100))
      : raffle.triggerType === 'threshold' && raffle.threshold > 0
      ? Math.min(100, Math.max(0, (raffle.participantsCount / raffle.threshold) * 100))
      : Math.min(100, raffle.participantsCount > 0 ? 60 : 8);
  const isScheduled = raffle.triggerType === 'scheduled' && !!raffle.scheduledDrawAt;

  return (
    <button
      type="button"
      className="raffle-card"
      onClick={() => onOpen(raffle)}
      aria-label={`查看抽奖：${raffle.title}`}
    >
      <div className="raffle-card-top">
        <span className="raffle-tag">
          {isRedPacket ? <Gift size={11} strokeWidth={2.4} /> : <Users size={11} strokeWidth={2.4} />}
          {isRedPacket ? '红包' : '抽奖'}
        </span>
        <span className="raffle-status">
          {isRedPacket
            ? `${remainingSlots} 个剩余`
            : raffle.triggerType === 'threshold'
            ? `${raffle.participantsCount}/${raffle.threshold}`
            : isScheduled
            ? '到点开奖'
            : `${raffle.participantsCount} 人`}
        </span>
      </div>
      <h4 className="raffle-title">{raffle.title}</h4>
      <div className="raffle-progress-wrapper">
        <div className="raffle-progress-bar" style={{ width: `${progress}%` }} />
      </div>
      <div className="raffle-footer">
        <span>
          {isRedPacket
            ? `总额 ${formatRafflePoints(totalPool)}`
            : topPrize ? `最高 ${formatRafflePoints(getRafflePrizePoints(topPrize))}` : '丰厚奖品'}
        </span>
        <span>{isRedPacket ? `已抢 ${raffle.participantsCount}` : isScheduled ? formatChinaDateTime(raffle.scheduledDrawAt) : totalQuantity > 0 ? `${totalQuantity} 个名额` : '即将开奖'}</span>
      </div>
    </button>
  );
}

// 公告卡：紫色玻璃态，点击触发弹窗（不跳转）
function AnnounceCard({
  item,
  onOpen,
}: {
  item: AnnouncementItem;
  onOpen: (a: AnnouncementItem) => void;
}) {
  const ts = item.publishedAt ?? item.createdAt;
  return (
    <button
      type="button"
      className="announce-card"
      onClick={() => onOpen(item)}
      aria-label={`查看公告：${item.title}`}
    >
      <div className="ann-card-top">
        <span className="ann-tag">
          <Megaphone size={11} strokeWidth={2.4} />
          公告
        </span>
        <span className="ann-time">{formatRelativeTime(ts)}</span>
      </div>
      <h4 className="ann-title">{item.title}</h4>
      <p className="ann-content">{item.content}</p>
      <div className="ann-footer">
        <span className="ann-author">
          <UserRound size={11} strokeWidth={2.4} />
          {item.createdBy}
        </span>
        <ChevronRight size={14} strokeWidth={2.4} />
      </div>
    </button>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [raffles, setRaffles] = useState<RaffleItem[]>([]);
  const [claimedProjectIds, setClaimedProjectIds] = useState<Set<string>>(new Set());
  // announcementId -> { notificationId, isRead }，用于同步通知系统的已读状态
  const [annNotifMap, setAnnNotifMap] = useState<
    Map<string, { notificationId: string; isRead: boolean }>
  >(new Map());
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const [readingAnnouncement, setReadingAnnouncement] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      // 第一波（公开 + 探测登录态）：项目、抽奖、当前用户
      const [projRes, raffleRes, meRes] = await Promise.allSettled([
        fetch('/api/projects', { cache: 'no-store' }),
        fetch('/api/raffle?active=true', { cache: 'no-store' }),
        fetch('/api/auth/me', { cache: 'no-store' }),
      ]);

      if (cancelled) return;

      if (projRes.status === 'fulfilled' && projRes.value.ok) {
        try {
          const data = await projRes.value.json();
          if (!cancelled && data.success && Array.isArray(data.projects)) {
            setProjects(data.projects);
          }
        } catch (err) {
          console.error('Parse projects failed', err);
        }
      }

      if (raffleRes.status === 'fulfilled' && raffleRes.value.ok) {
        try {
          const data = await raffleRes.value.json();
          if (!cancelled && data.success && Array.isArray(data.raffles)) {
            setRaffles(data.raffles as RaffleItem[]);
          }
        } catch (err) {
          console.error('Parse raffles failed', err);
        }
      }

      const isLoggedIn =
        meRes.status === 'fulfilled' && meRes.value.ok;

      if (!isLoggedIn) {
        // 未登录：公告/通知/已领取均不可访问，静默降级
        return;
      }

      // 第二波（需登录）：公告、与公告相关的通知映射、已领取的项目
      const [annRes, notifRes, myClaimsRes] = await Promise.allSettled([
        fetch('/api/announcements?page=1&limit=10', { cache: 'no-store' }),
        fetch('/api/notifications?type=announcement&page=1&limit=50', {
          cache: 'no-store',
        }),
        fetch('/api/projects/my-claims', { cache: 'no-store' }),
      ]);

      if (cancelled) return;

      if (annRes.status === 'fulfilled' && annRes.value.ok) {
        try {
          const data = await annRes.value.json();
          if (
            !cancelled &&
            data?.success &&
            data.data &&
            Array.isArray(data.data.items)
          ) {
            setAnnouncements(data.data.items as AnnouncementItem[]);
          }
        } catch (err) {
          console.warn('Announcements parse failed', err);
        }
      }

      if (notifRes.status === 'fulfilled' && notifRes.value.ok) {
        try {
          const data = await notifRes.value.json();
          if (!cancelled && data?.success && Array.isArray(data.data?.items)) {
            const map = new Map<
              string,
              { notificationId: string; isRead: boolean }
            >();
            for (const item of data.data.items as Array<{
              id: string;
              isRead: boolean;
              data?: { announcementId?: string };
            }>) {
              const annId = item.data?.announcementId;
              if (annId && !map.has(annId)) {
                map.set(annId, {
                  notificationId: item.id,
                  isRead: !!item.isRead,
                });
              }
            }
            setAnnNotifMap(map);
          }
        } catch (err) {
          console.warn('Notifications parse failed', err);
        }
      }

      if (myClaimsRes.status === 'fulfilled' && myClaimsRes.value.ok) {
        try {
          const data = await myClaimsRes.value.json();
          if (
            !cancelled &&
            data?.success &&
            Array.isArray(data.data?.projectIds)
          ) {
            setClaimedProjectIds(
              new Set<string>((data.data.projectIds as string[]).filter(Boolean)),
            );
          }
        } catch (err) {
          console.warn('My-claims parse failed', err);
        }
      }
    }

    void fetchAll();

    return () => {
      cancelled = true;
    };
  }, []);

  // ESC 关闭弹窗 + body 锁定
  useEffect(() => {
    if (!activeModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveModal(null);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [activeModal]);

  // 福利数据（基于 projects 派生），公告栏只看未结束、有库存、未领取的
  const visibleRewards = useMemo<HotReward[]>(() => {
    const built = buildHotRewards(projects);
    return built.filter((r) => {
      if (claimedProjectIds.has(r.id)) return false;
      if (r.remainCount <= 0) return false;
      // status 字段在 buildHotRewards 中由 project.status 决定，仅 'active' 会显示「进行中」
      return r.status === '进行中';
    });
  }, [projects, claimedProjectIds]);

  // 公告：过滤掉已读（基于通知映射）
  const visibleAnnouncements = useMemo(
    () =>
      announcements.filter((a) => {
        const link = annNotifMap.get(a.id);
        // 没找到对应通知（公告早于通知 fanout 或刚发布）→ 视为未读，照常显示
        return !link || !link.isRead;
      }),
    [announcements, annNotifMap],
  );

  // 抽奖：仅显示进行中的活动
  const visibleRaffles = useMemo(
    () => raffles.filter((r) => r.status === 'active'),
    [raffles],
  );

  // 公告优先 → 福利 → 抽奖，混合到统一跑马灯
  const boardItems = useMemo<BoardItem[]>(
    () => [
      ...visibleAnnouncements.map((a) => ({ kind: 'announcement' as const, data: a })),
      ...visibleRewards.map((r) => ({ kind: 'reward' as const, data: r })),
      ...visibleRaffles.map((r) => ({ kind: 'raffle' as const, data: r })),
    ],
    [visibleAnnouncements, visibleRewards, visibleRaffles],
  );
  const shouldAnimate = boardItems.length >= 2;
  const visibleItems = shouldAnimate ? [...boardItems, ...boardItems] : boardItems;

  // 跑马灯首帧卡顿 + 接缝闪回规避：
  // 1) 数据稳定后用双 RAF 等浏览器完成布局 + 合成层建立，再切到 is-animated；
  // 2) 用 ResizeObserver 实测一组卡片的真实像素宽度，通过 CSS variable 精确注入，
  //    避免 calc(-50% - 12px) 的百分比亚像素舍入累积误差导致接缝闪回。
  const marqueeRef = useRef<HTMLDivElement | null>(null);
  const [animationReady, setAnimationReady] = useState(false);
  const [scrollPx, setScrollPx] = useState(0);
  useEffect(() => {
    if (!shouldAnimate) {
      setAnimationReady(false);
      setScrollPx(0);
      return;
    }
    const node = marqueeRef.current;
    if (!node) return;

    // 子元素 gap 与首页 .marquee-content 一致（24px）
    const GAP = 24;
    const measure = () => {
      const total = node.scrollWidth;
      if (total > 0) {
        // visibleItems = 2 组卡片，scrollWidth = 2 × W_single + (2N-1) × gap
        // 想要的滚动距离 = W_single + 1 个 gap = (total + gap) / 2
        setScrollPx((total + GAP) / 2);
      }
    };

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        measure();
        setAnimationReady(true);
      });
    });

    const ro = new ResizeObserver(measure);
    ro.observe(node);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [shouldAnimate, boardItems.length]);
  const isAnimated = shouldAnimate && animationReady && scrollPx > 0;

  // 公告：标记已读 → 调用通知系统的标记已读 → 立即从公告栏隐藏
  const handleMarkAnnouncementRead = async (announcementId: string) => {
    const link = annNotifMap.get(announcementId);
    if (!link) {
      // 公告未生成对应通知：仅本地记一笔已读，避免阻塞 UI
      setAnnNotifMap((prev) => {
        const next = new Map(prev);
        next.set(announcementId, {
          notificationId: '',
          isRead: true,
        });
        return next;
      });
      setActiveModal(null);
      return;
    }
    if (link.isRead) {
      setActiveModal(null);
      return;
    }
    setReadingAnnouncement(true);
    try {
      const res = await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [link.notificationId] }),
      });
      if (res.ok) {
        setAnnNotifMap((prev) => {
          const next = new Map(prev);
          next.set(announcementId, { ...link, isRead: true });
          return next;
        });
        setActiveModal(null);
      } else {
        console.warn('Mark announcement read failed: HTTP', res.status);
      }
    } catch (err) {
      console.warn('Mark announcement read failed', err);
    } finally {
      setReadingAnnouncement(false);
    }
  };

  return (
    <div className="lucky-home">
      <div className="mesh-bg" />

      <div className="layout">
        <SiteSidebar activeNav="home" />

        <main className="panel-right">
          <section className="mobile-typewriter-hero" aria-label="欢迎来到 Lucky 福利站">
            <h1 className="mobile-hero-title">
              <TypewriterTitle
                line1="Welcome to"
                line2="Lucky Station"
                spanClassName="mobile-hero-gradient"
              />
            </h1>
          </section>

          <div className="hot-rewards-section">
            <div className="section-header">
              <h2 className="section-title">
                <Megaphone />
                公告栏
              </h2>
            </div>
            <div className="marquee-container">
              {visibleItems.length > 0 ? (
                <div
                  ref={marqueeRef}
                  className={isAnimated ? 'marquee-content is-animated' : 'marquee-content is-static'}
                  style={
                    isAnimated && scrollPx > 0
                      ? ({ ['--marquee-scroll' as string]: `-${scrollPx}px` } as React.CSSProperties)
                      : undefined
                  }
                >
                  {visibleItems.map((item, index) => {
                    if (item.kind === 'announcement') {
                      return (
                        <AnnounceCard
                          key={`ann-${item.data.id}-${index}`}
                          item={item.data}
                          onOpen={(data) => setActiveModal({ type: 'announcement', data })}
                        />
                      );
                    }
                    if (item.kind === 'reward') {
                      return (
                        <RewardCard
                          key={`reward-${item.data.id}-${index}`}
                          reward={item.data}
                          onOpen={(data) => setActiveModal({ type: 'reward', data })}
                        />
                      );
                    }
                    return (
                      <RaffleCard
                        key={`raffle-${item.data.id}-${index}`}
                        raffle={item.data}
                        onOpen={(data) => setActiveModal({ type: 'raffle', data })}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="empty-hot-card">暂无公告或活动</div>
              )}
            </div>
          </div>

          {cards.map((card) => (
            <Link key={card.href} href={card.href} className={`card ${card.className}`}>
              <div className="icon-wrapper">{card.icon}</div>
              <div className="card-content">
                <h3>{card.title}</h3>
                <p>{card.desc}</p>
                <div className="card-btn">
                  立即查看 <ArrowIcon />
                </div>
              </div>
            </Link>
          ))}
        </main>
      </div>

      {/* 统一详情弹窗：紫(公告) / 橙(福利) / 粉(抽奖) */}
      {activeModal && (
        <div
          className={`board-modal-mask is-${activeModal.type}`}
          role="dialog"
          aria-modal="true"
          aria-label="详情"
          onClick={() => setActiveModal(null)}
        >
          <div
            className={`board-modal is-${activeModal.type}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="board-modal-header">
              <div className="board-modal-title">
                <span className="board-modal-icon">
                  {activeModal.type === 'announcement' && (
                    <Megaphone size={20} strokeWidth={2.4} />
                  )}
                  {activeModal.type === 'reward' && (
                    <Gift size={20} strokeWidth={2.4} />
                  )}
                  {activeModal.type === 'raffle' && (
                    activeModal.data.mode === 'red_packet'
                      ? <Gift size={20} strokeWidth={2.4} />
                      : <Users size={20} strokeWidth={2.4} />
                  )}
                </span>
                <div>
                  <h3>
                    {activeModal.type === 'announcement' && activeModal.data.title}
                    {activeModal.type === 'reward' && activeModal.data.prize}
                    {activeModal.type === 'raffle' && activeModal.data.title}
                  </h3>
                  <p>
                    {activeModal.type === 'announcement' && (
                      <>
                        <UserRound size={11} strokeWidth={2.4} />{' '}
                        {activeModal.data.createdBy}
                        <span className="board-modal-divider">·</span>
                        <Calendar size={11} strokeWidth={2.4} />
                        {formatExactTime(
                          activeModal.data.publishedAt ?? activeModal.data.createdAt,
                        )}
                      </>
                    )}
                    {activeModal.type === 'reward' && (
                      <>
                        <Gift size={11} strokeWidth={2.4} />
                        免费福利
                        <span className="board-modal-divider">·</span>
                        {activeModal.data.remain}
                        <span className="board-modal-divider">·</span>
                        {activeModal.data.stock}
                      </>
                    )}
                    {activeModal.type === 'raffle' && (
                      <>
                        {activeModal.data.mode === 'red_packet'
                          ? <Gift size={11} strokeWidth={2.4} />
                          : <Users size={11} strokeWidth={2.4} />}
                        {activeModal.data.mode === 'red_packet'
                          ? `${activeModal.data.participantsCount}/${activeModal.data.redPacketTotalSlots ?? 0} 人已抢`
                          : activeModal.data.triggerType === 'threshold'
                          ? `${activeModal.data.participantsCount}/${activeModal.data.threshold} 人`
                          : activeModal.data.triggerType === 'scheduled' && activeModal.data.scheduledDrawAt
                          ? `${formatChinaDateTime(activeModal.data.scheduledDrawAt)} 开奖`
                          : `${activeModal.data.participantsCount} 人参与`}
                        <span className="board-modal-divider">·</span>
                        <Calendar size={11} strokeWidth={2.4} />
                        {formatExactTime(activeModal.data.createdAt)}
                      </>
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="board-modal-close"
                onClick={() => setActiveModal(null)}
                aria-label="关闭"
              >
                <X size={18} strokeWidth={2.4} />
              </button>
            </div>
            <div className="board-modal-body">
              {activeModal.type === 'announcement' && (
                <MarkdownPreview
                  content={activeModal.data.content}
                  className="board-modal-content board-modal-markdown"
                />
              )}
              {activeModal.type === 'reward' && (
                <div className="board-modal-content">
                  {activeModal.data.description ? (
                    <p className="board-modal-desc">{activeModal.data.description}</p>
                  ) : (
                    <p className="board-modal-desc">
                      点击下方按钮前往领取页面查看详细信息。
                    </p>
                  )}
                  {activeModal.data.rewardType === 'direct' &&
                    activeModal.data.directPoints !== undefined && (
                      <div className="board-modal-highlight">
                        <span className="highlight-label">直充奖励</span>
                        <span className="highlight-value">
                          {activeModal.data.directPoints.toLocaleString('zh-CN')} 积分
                        </span>
                      </div>
                    )}
                </div>
              )}
              {activeModal.type === 'raffle' && (
                <div className="board-modal-content">
                  <p className="board-modal-desc">
                    {activeModal.data.description || (
                      activeModal.data.mode === 'red_packet'
                        ? '点击即可随机抢到整数积分，红包数量有限。'
                        : activeModal.data.triggerType === 'scheduled' && activeModal.data.scheduledDrawAt
                        ? `将于 ${formatChinaDateTime(activeModal.data.scheduledDrawAt)} 自动开奖。`
                        : '邀请好友免费参与，奖池满额即刻开奖。'
                    )}
                  </p>
                  {activeModal.data.mode === 'red_packet' ? (
                    <div className="board-modal-highlight">
                      <span className="highlight-label">红包总额</span>
                      <span className="highlight-value">
                        {formatRafflePoints(activeModal.data.redPacketTotalPoints ?? 0)}
                      </span>
                    </div>
                  ) : activeModal.data.prizes.length > 0 && (
                    <div className="board-modal-prizes">
                      {activeModal.data.prizes.slice(0, 3).map((p) => (
                        <div key={p.id} className="board-modal-prize-row">
                          <span className="prize-name">{p.name}</span>
                          <span className="prize-meta">
                            {formatRafflePoints(getRafflePrizePoints(p))} x {p.quantity}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="board-modal-footer">
              {activeModal.type === 'announcement' && (
                <>
                  <button
                    type="button"
                    className="board-modal-btn ghost"
                    onClick={() => handleMarkAnnouncementRead(activeModal.data.id)}
                    disabled={readingAnnouncement}
                  >
                    {readingAnnouncement ? '处理中…' : '标记已读'}
                  </button>
                  <button
                    type="button"
                    className="board-modal-btn primary"
                    onClick={() => {
                      setActiveModal(null);
                      router.push('/notifications');
                    }}
                  >
                    查看详情
                    <ArrowRight size={14} strokeWidth={2.4} />
                  </button>
                </>
              )}
              {activeModal.type === 'reward' && (
                <button
                  type="button"
                  className="board-modal-btn primary"
                  onClick={() => {
                    const id = activeModal.data.id;
                    setActiveModal(null);
                    router.push(`/project/${id}`);
                  }}
                >
                  前往领取
                  <ArrowRight size={14} strokeWidth={2.4} />
                </button>
              )}
              {activeModal.type === 'raffle' && (
                <button
                  type="button"
                  className="board-modal-btn primary"
                  onClick={() => {
                    const id = activeModal.data.id;
                    setActiveModal(null);
                    router.push(`/project/${id}?type=raffle`);
                  }}
                >
                  {activeModal.data.mode === 'red_packet' ? '前往抢红包' : '前往参与'}
                  <ArrowRight size={14} strokeWidth={2.4} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .lucky-home {
          --text-main: #0f172a;
          --text-light: #64748b;
          --card-bg: rgba(255, 255, 255, 0.65);
          --card-border: rgba(255, 255, 255, 1);
          --card-shadow: 0 24px 48px rgba(15, 23, 42, 0.05);
          --radius-xl: 32px;
          --radius-lg: 24px;
          --c-green: #10b981;
          --c-purple: #8b5cf6;
          --c-orange: #f97316;
          --c-red: #f43f5e;
          --c-blue: #3b82f6;
          --c-lime: #84cc16;
          --c-pink: #ec4899;
          --c-teal: #14b8a6;
          background-color: #f8fafc;
          color: var(--text-main);
          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
          height: 100vh;
          overflow: hidden;
          position: relative;
          isolation: isolate;
          -webkit-font-smoothing: antialiased;
        }

        .lucky-home * {
          box-sizing: border-box;
        }

        .lucky-home a {
          color: inherit;
          text-decoration: none;
        }

        .mesh-bg {
          position: fixed;
          inset: 0;
          z-index: -1;
          background-image:
            radial-gradient(circle at 15% 50%, rgba(255, 228, 230, 0.8) 0%, transparent 50%),
            radial-gradient(circle at 85% 30%, rgba(224, 231, 255, 0.8) 0%, transparent 50%),
            radial-gradient(circle at 50% 90%, rgba(254, 243, 199, 0.8) 0%, transparent 50%),
            radial-gradient(circle at 50% 10%, rgba(243, 232, 255, 0.8) 0%, transparent 50%);
          filter: blur(60px);
          animation: fluid 15s infinite alternate ease-in-out;
        }

        @keyframes fluid {
          0% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.05) rotate(2deg); }
          100% { transform: scale(1.1) rotate(-2deg); }
        }

        .layout {
          display: flex;
          height: 100vh;
          width: 100%;
          max-width: none;
          margin: 0;
          overflow: hidden;
        }

        .panel-left {
          width: 40%;
          padding: 4rem 5rem;
          position: sticky;
          top: 0;
          height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: var(--text-main);
        }

        .brand-icon {
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 10px 20px rgba(255, 122, 0, 0.3);
        }

        .brand-icon svg {
          width: 24px;
          height: 24px;
          color: #ffffff;
          stroke-width: 2.5;
        }

        .hero-content {
          margin-top: -5vh;
        }

        .hero-title {
          font-size: 64px;
          font-weight: 800;
          line-height: 1.1;
          letter-spacing: -2px;
          margin: 0 0 24px;
        }

        .hero-title span {
          background: linear-gradient(135deg, #ff5a00, #ff0080);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .nav-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px 24px;
          background: rgba(255, 255, 255, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.6);
          border-radius: 20px;
          font-size: 16px;
          font-weight: 600;
          color: var(--text-main);
          cursor: pointer;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
          width: fit-content;
          min-width: 200px;
        }

        .nav-item:hover {
          background: rgba(255, 255, 255, 0.9);
          transform: translateX(8px);
          box-shadow: 0 10px 20px rgba(0, 0, 0, 0.03);
          color: var(--c-orange);
        }

        .user-profile {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px;
          background: #ffffff;
          border-radius: 999px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
          width: fit-content;
          cursor: pointer;
          transition: transform 0.2s;
        }

        .user-profile:hover { transform: scale(1.02); }

        .avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
        }

        .user-info h4 {
          font-size: 16px;
          font-weight: 700;
          margin: 0 0 2px;
        }

        .user-info p {
          font-size: 13px;
          color: var(--text-light);
          margin: 0;
        }

        .profile-arrow {
          margin-left: auto;
        }

        .panel-right {
          flex: 1 1 0;
          width: auto;
          padding: 4rem 5rem 4rem 0;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          /* 第 1 行（热门福利）自适应；后续每行 = 卡片高度的 1/10
             这样错位 3 行 = 30%、同列卡间空 2 行 = 间距 */
          grid-template-rows: auto;
          grid-auto-rows: 22px;
          row-gap: 0;
          column-gap: 22px;
          align-content: start;
          max-width: none;
          min-width: 0;
          height: 100vh;
          overflow-y: auto;
          overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
          scrollbar-gutter: stable;
        }

        .panel-right > * {
          min-width: 0;
        }

        .mobile-typewriter-hero {
          display: none;
        }

        .mobile-hero-title {
          margin: 0;
          color: var(--text-main);
          font-size: 34px;
          font-weight: 900;
          line-height: 1.08;
          letter-spacing: 0;
        }

        .mobile-hero-gradient {
          background: linear-gradient(135deg, #ff5a00, #ff0080);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .mobile-hero-title .tw-cursor {
          color: #ff5a00;
          -webkit-text-fill-color: #ff5a00;
        }

        /* 平行四边形（30% 错位）布局：每张卡跨 10 行小格 = 200px 高度
           card-1 (1, 1)   → 列 1, 行 2-11
           card-2 (1, 1.3) → 列 2, 行 5-14（向下偏移 3 小格 = 60px = 30% 卡高）
           card-3 (2, 1)   → 列 1, 行 14-23（与 card-1 同列、间隔 2 行 = 40px）
           card-4 (2, 1.3) → 列 2, 行 17-26
           card-5 (3, 1)   → 列 1, 行 26-35 */
        .card-1 { grid-column: 1; grid-row: 2 / span 10; }
        .card-2 { grid-column: 2; grid-row: 5 / span 10; }
        .card-3 { grid-column: 1; grid-row: 14 / span 10; }
        .card-4 { grid-column: 2; grid-row: 17 / span 10; }
        .card-5 { grid-column: 1; grid-row: 26 / span 10; }
        .card-6 { grid-column: 2; grid-row: 29 / span 10; }
        .card-7 { grid-column: 1; grid-row: 38 / span 10; }

        .card {
          background: var(--card-bg);
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid var(--card-border);
          border-radius: var(--radius-lg);
          padding: 22px 22px;
          box-shadow: var(--card-shadow);
          transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
          overflow: hidden;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 12px;
          width: 100%;
          height: 100%;
          flex-shrink: 0;
        }

        /* 渐变色块装饰：每张卡右下角的主题色光晕 */
        .card::before {
          content: '';
          position: absolute;
          right: -35%;
          bottom: -35%;
          width: 160px;
          height: 160px;
          border-radius: 50%;
          opacity: 0.55;
          filter: blur(36px);
          transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
          pointer-events: none;
          z-index: 0;
        }

        .card-1::before { background: radial-gradient(circle, rgba(139, 92, 246, 0.55), transparent 70%); }
        .card-2::before { background: radial-gradient(circle, rgba(16, 185, 129, 0.55), transparent 70%); }
        .card-3::before { background: radial-gradient(circle, rgba(249, 115, 22, 0.55), transparent 70%); }
        .card-4::before { background: radial-gradient(circle, rgba(236, 72, 153, 0.55), transparent 70%); }
        .card-5::before { background: radial-gradient(circle, rgba(59, 130, 246, 0.55), transparent 70%); }
        .card-6::before { background: radial-gradient(circle, rgba(132, 204, 22, 0.55), transparent 70%); }
        .card-7::before { background: radial-gradient(circle, rgba(20, 184, 166, 0.55), transparent 70%); }

        .card::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0) 100%);
          opacity: 0;
          transition: opacity 0.4s;
          pointer-events: none;
          z-index: 1;
        }

        .card:hover {
          transform: translateY(-6px);
          box-shadow: 0 28px 48px rgba(15, 23, 42, 0.08);
        }

        .card:hover::before {
          right: -22%;
          bottom: -22%;
          opacity: 0.85;
          width: 200px;
          height: 200px;
        }

        .card:hover::after { opacity: 1; }

        .icon-wrapper {
          width: 50px;
          height: 50px;
          border-radius: 15px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          background: #ffffff;
          position: relative;
          z-index: 2;
          transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .icon-wrapper svg {
          width: 24px;
          height: 24px;
          transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        /* 增强的图标动画：弹跳 + 微旋转 + 内部图标小幅反向旋转 */
        .card:hover .icon-wrapper {
          transform: translateY(-3px) scale(1.12) rotate(-6deg);
        }

        .card:hover .icon-wrapper svg {
          transform: rotate(12deg);
        }

        .card-1 .icon-wrapper { color: var(--c-purple); box-shadow: 0 8px 18px rgba(139, 92, 246, 0.2), inset 0 2px 0 rgba(255, 255, 255, 1); }
        .card-2 .icon-wrapper { color: var(--c-green); box-shadow: 0 8px 18px rgba(16, 185, 129, 0.2), inset 0 2px 0 rgba(255, 255, 255, 1); }
        .card-3 .icon-wrapper { color: var(--c-orange); box-shadow: 0 8px 18px rgba(249, 115, 22, 0.2), inset 0 2px 0 rgba(255, 255, 255, 1); }
        .card-4 .icon-wrapper { color: var(--c-pink); box-shadow: 0 8px 18px rgba(236, 72, 153, 0.2), inset 0 2px 0 rgba(255, 255, 255, 1); }
        .card-5 .icon-wrapper { color: var(--c-blue); box-shadow: 0 8px 18px rgba(59, 130, 246, 0.2), inset 0 2px 0 rgba(255, 255, 255, 1); }
        .card-6 .icon-wrapper { color: var(--c-lime); box-shadow: 0 8px 18px rgba(132, 204, 22, 0.2), inset 0 2px 0 rgba(255, 255, 255, 1); }
        .card-7 .icon-wrapper { color: var(--c-teal); box-shadow: 0 8px 18px rgba(20, 184, 166, 0.2), inset 0 2px 0 rgba(255, 255, 255, 1); }

        .card-content {
          display: flex;
          flex-direction: column;
          flex-grow: 1;
          min-width: 0;
          width: 100%;
          position: relative;
          z-index: 2;
        }

        .card h3,
        .card p {
          transition: color 0.3s ease;
        }

        .card h3 {
          font-size: 16px;
          font-weight: 800;
          margin: 0 0 5px;
          position: relative;
          z-index: 2;
          letter-spacing: -0.3px;
          line-height: 1.25;
        }

        .card p {
          font-size: 12px;
          color: var(--text-light);
          line-height: 1.5;
          margin: 0 0 12px;
          position: relative;
          z-index: 2;
        }

        .card-btn {
          align-self: flex-start;
          margin-top: auto;
          height: 30px;
          padding: 0 13px;
          border-radius: 999px;
          background: #ffffff;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: var(--text-main);
          font-size: 12px;
          font-weight: 700;
          box-shadow: 0 6px 14px rgba(0, 0, 0, 0.05);
          transition: all 0.3s ease;
          position: relative;
          z-index: 2;
          white-space: nowrap;
        }

        .card-btn svg { width: 12px; height: 12px; }

        .card:hover .card-btn { transform: translateX(6px); }
        .card-1:hover h3, .card-1:hover p { color: var(--c-purple); }
        .card-1:hover .card-btn { background: var(--c-purple); color: #ffffff; }
        .card-2:hover h3, .card-2:hover p { color: var(--c-green); }
        .card-2:hover .card-btn { background: var(--c-green); color: #ffffff; }
        .card-3:hover h3, .card-3:hover p { color: var(--c-orange); }
        .card-3:hover .card-btn { background: var(--c-orange); color: #ffffff; }
        .card-4:hover h3, .card-4:hover p { color: var(--c-red); }
        .card-4:hover .card-btn { background: var(--c-red); color: #ffffff; }
        .card-5:hover h3, .card-5:hover p { color: var(--c-blue); }
        .card-5:hover .card-btn { background: var(--c-blue); color: #ffffff; }
        .card-6:hover h3, .card-6:hover p { color: var(--c-lime); }
        .card-6:hover .card-btn { background: var(--c-lime); color: #ffffff; }
        .card-7:hover h3, .card-7:hover p { color: var(--c-teal); }
        .card-7:hover .card-btn { background: var(--c-teal); color: #ffffff; }

        .hot-rewards-section {
          grid-column: 1 / -1;
          grid-row: 1;
          margin-top: 0;
          /* 与下方 6 张卡片之间拉开距离 */
          margin-bottom: 40px;
          width: 100%;
          min-width: 0;
          min-height: 184px;
          /* 不再裁剪：marquee-container 自身已有 overflow:hidden 用于跑马灯遮罩，
             这里需要 overflow:visible，避免卡片 hover 上浮被切掉 */
          overflow: visible;
          padding-bottom: 14px;
          flex-shrink: 0;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }

        .section-title {
          font-size: 20px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--text-main);
          margin: 0;
        }

        .marquee-container {
          width: 100%;
          overflow: hidden;
          position: relative;
          /* 给 hover 上浮 + 阴影留出垂直空间，并避免遮罩裁剪 */
          padding: 8px 0 16px;
          -webkit-mask-image: linear-gradient(to right, transparent, black 5%, black 95%, transparent);
          mask-image: linear-gradient(to right, transparent, black 5%, black 95%, transparent);
        }

        .marquee-content {
          display: flex;
          gap: 24px;
          width: max-content;
          /* 提前提示浏览器：本元素会做 transform 动画，避免首次合成时的卡顿 */
          will-change: transform;
          transform: translateZ(0);
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }

        .marquee-content.is-animated {
          animation: scroll-left 15s linear infinite;
          /* 让动画从 0% 状态平滑接管，避免初始帧出现"跳一下" */
          animation-fill-mode: both;
        }

        .marquee-content.is-static {
          width: 100%;
          justify-content: flex-start;
        }

        .marquee-content.is-static .reward-card,
        .marquee-content.is-static .raffle-card,
        .marquee-content.is-static .announce-card {
          width: 280px;
        }

        .marquee-content.is-animated:hover { animation-play-state: paused; }

        /* 跑马灯卡片提前进入合成层，避免动画启动时多卡片同时建层导致的首帧卡顿 */
        .marquee-content .reward-card,
        .marquee-content .raffle-card,
        .marquee-content .announce-card {
          transform: translateZ(0);
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }

        @keyframes scroll-left {
          0% { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(var(--marquee-scroll, calc(-50% - 12px)), 0, 0); }
        }

        .empty-hot-card {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border: 1px solid var(--card-border);
          border-radius: 20px;
          padding: 24px;
          color: var(--text-light);
          font-size: 14px;
          font-weight: 600;
          text-align: center;
        }

        /* === 福利卡（橙色玻璃态） === */
        .reward-card {
          all: unset;
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: linear-gradient(135deg, rgba(249, 115, 22, 0.11), rgba(251, 146, 60, 0.05));
          backdrop-filter: blur(20px);
          border: 1px solid rgba(249, 115, 22, 0.22);
          border-radius: 20px;
          padding: 18px 22px;
          width: 280px;
          flex-shrink: 0;
          box-shadow: 0 10px 30px rgba(249, 115, 22, 0.06);
          transition: transform 0.3s, box-shadow 0.3s, border-color 0.3s;
          cursor: pointer;
          font-family: inherit;
          color: var(--text-main);
          text-align: left;
          box-sizing: border-box;
        }

        .reward-card:hover {
          transform: translateY(-5px);
          border-color: rgba(249, 115, 22, 0.42);
          box-shadow: 0 18px 40px rgba(249, 115, 22, 0.18);
        }

        .reward-card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }

        .reward-tag {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 9px;
          background: linear-gradient(135deg, rgba(249, 115, 22, 0.22), rgba(251, 146, 60, 0.16));
          color: #c2410c;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.5px;
          border-radius: 999px;
          border: 1px solid rgba(249, 115, 22, 0.28);
        }

        .reward-status {
          font-size: 12px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(16, 185, 129, 0.1);
          color: #10b981;
          flex-shrink: 0;
          white-space: nowrap;
        }

        .reward-status-hot {
          background: rgba(249, 115, 22, 0.12);
          color: #f97316;
        }

        .reward-prize {
          font-size: 18px;
          font-weight: 800;
          color: var(--text-main);
          margin: 0;
          line-height: 1.3;
          letter-spacing: -0.2px;
          display: -webkit-box;
          -webkit-line-clamp: 1;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .reward-progress-wrapper {
          height: 6px;
          background: rgba(0, 0, 0, 0.05);
          border-radius: 999px;
          overflow: hidden;
        }

        .reward-progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #f97316, #fb923c);
          border-radius: 999px;
        }

        .reward-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          padding-top: 6px;
          border-top: 1px dashed rgba(249, 115, 22, 0.18);
          font-size: 11.5px;
          color: var(--text-light);
          font-weight: 600;
        }

        /* === 抽奖卡（粉色玻璃态） === */
        .raffle-card {
          all: unset;
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: linear-gradient(135deg, rgba(236, 72, 153, 0.11), rgba(244, 114, 182, 0.06));
          backdrop-filter: blur(20px);
          border: 1px solid rgba(236, 72, 153, 0.22);
          border-radius: 20px;
          padding: 18px 22px;
          width: 280px;
          flex-shrink: 0;
          box-shadow: 0 10px 30px rgba(236, 72, 153, 0.06);
          transition: transform 0.3s, box-shadow 0.3s, border-color 0.3s;
          cursor: pointer;
          font-family: inherit;
          color: var(--text-main);
          text-align: left;
          box-sizing: border-box;
        }

        .raffle-card:hover {
          transform: translateY(-5px);
          border-color: rgba(236, 72, 153, 0.42);
          box-shadow: 0 18px 40px rgba(236, 72, 153, 0.18);
        }

        .raffle-card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }

        .raffle-tag {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 9px;
          background: linear-gradient(135deg, rgba(236, 72, 153, 0.22), rgba(244, 114, 182, 0.18));
          color: #be185d;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.5px;
          border-radius: 999px;
          border: 1px solid rgba(236, 72, 153, 0.28);
        }

        .raffle-status {
          font-size: 12px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(236, 72, 153, 0.12);
          color: #be185d;
          flex-shrink: 0;
          white-space: nowrap;
        }

        .raffle-title {
          font-size: 16px;
          font-weight: 800;
          color: var(--text-main);
          margin: 0;
          line-height: 1.3;
          letter-spacing: -0.2px;
          display: -webkit-box;
          -webkit-line-clamp: 1;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .raffle-progress-wrapper {
          height: 6px;
          background: rgba(0, 0, 0, 0.05);
          border-radius: 999px;
          overflow: hidden;
        }

        .raffle-progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #ec4899, #f472b6);
          border-radius: 999px;
        }

        .raffle-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          padding-top: 6px;
          border-top: 1px dashed rgba(236, 72, 153, 0.18);
          font-size: 11.5px;
          color: var(--text-light);
          font-weight: 600;
        }

        /* === 公告卡（紫色玻璃态，与福利卡共用 280px 宽） === */
        .announce-card {
          all: unset;
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.10), rgba(99, 102, 241, 0.05));
          backdrop-filter: blur(20px);
          border: 1px solid rgba(139, 92, 246, 0.22);
          border-radius: 20px;
          padding: 18px 22px;
          width: 280px;
          flex-shrink: 0;
          box-shadow: 0 10px 30px rgba(139, 92, 246, 0.06);
          transition: transform 0.3s, box-shadow 0.3s, border-color 0.3s;
          cursor: pointer;
          font-family: inherit;
          color: var(--text-main);
          text-align: left;
          box-sizing: border-box;
        }

        .announce-card:hover {
          transform: translateY(-5px);
          border-color: rgba(139, 92, 246, 0.42);
          box-shadow: 0 18px 40px rgba(139, 92, 246, 0.18);
        }

        .announce-card .ann-card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }

        .announce-card .ann-tag {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 9px;
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(99, 102, 241, 0.18));
          color: #6d28d9;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.5px;
          border-radius: 999px;
          border: 1px solid rgba(139, 92, 246, 0.28);
        }

        .announce-card .ann-time {
          font-size: 11px;
          color: var(--text-light);
          font-weight: 600;
        }

        .announce-card .ann-title {
          font-size: 16px;
          font-weight: 800;
          color: var(--text-main);
          margin: 0;
          line-height: 1.3;
          letter-spacing: -0.2px;
          display: -webkit-box;
          -webkit-line-clamp: 1;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .announce-card .ann-content {
          font-size: 12.5px;
          color: var(--text-light);
          line-height: 1.5;
          margin: 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          flex: 1;
        }

        .announce-card .ann-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          padding-top: 6px;
          border-top: 1px dashed rgba(139, 92, 246, 0.18);
        }

        .announce-card .ann-author {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11.5px;
          font-weight: 700;
          color: #6d28d9;
        }

        /* === 统一详情弹窗（三色主题：紫/橙/粉） === */
        .board-modal-mask {
          position: fixed;
          inset: 0;
          z-index: 200;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          animation: board-mask-in 0.25s ease;
        }
        .board-modal-mask.is-announcement {
          background: radial-gradient(circle at 50% 50%, rgba(124, 58, 237, 0.45) 0%, rgba(30, 27, 75, 0.78) 45%, rgba(15, 23, 42, 0.92) 100%);
        }
        .board-modal-mask.is-reward {
          background: radial-gradient(circle at 50% 50%, rgba(249, 115, 22, 0.45) 0%, rgba(124, 45, 18, 0.78) 45%, rgba(15, 23, 42, 0.92) 100%);
        }
        .board-modal-mask.is-raffle {
          background: radial-gradient(circle at 50% 50%, rgba(236, 72, 153, 0.45) 0%, rgba(131, 24, 67, 0.78) 45%, rgba(15, 23, 42, 0.92) 100%);
        }
        @keyframes board-mask-in { from { opacity: 0; } to { opacity: 1; } }

        .board-modal {
          width: min(640px, 100%);
          max-height: min(82vh, 760px);
          border: 1px solid rgba(255, 255, 255, 1);
          border-radius: 28px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          position: relative;
          min-height: 0;
          animation: board-pop 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .board-modal.is-announcement {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(245, 243, 255, 0.92));
          box-shadow: 0 30px 60px rgba(76, 29, 149, 0.4), inset 0 1px 0 rgba(255, 255, 255, 1);
        }
        .board-modal.is-reward {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(255, 244, 230, 0.92));
          box-shadow: 0 30px 60px rgba(154, 52, 18, 0.35), inset 0 1px 0 rgba(255, 255, 255, 1);
        }
        .board-modal.is-raffle {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(253, 232, 244, 0.92));
          box-shadow: 0 30px 60px rgba(157, 23, 77, 0.35), inset 0 1px 0 rgba(255, 255, 255, 1);
        }
        @keyframes board-pop {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .board-modal::before {
          content: '';
          position: absolute;
          top: -40%;
          right: -20%;
          width: 360px;
          height: 360px;
          border-radius: 50%;
          filter: blur(40px);
          pointer-events: none;
        }
        .board-modal.is-announcement::before {
          background: radial-gradient(circle, rgba(167, 139, 250, 0.25), transparent 60%);
        }
        .board-modal.is-reward::before {
          background: radial-gradient(circle, rgba(251, 146, 60, 0.25), transparent 60%);
        }
        .board-modal.is-raffle::before {
          background: radial-gradient(circle, rgba(244, 114, 182, 0.25), transparent 60%);
        }

        .board-modal-header {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 22px 26px;
          flex-shrink: 0;
          position: relative;
          z-index: 1;
        }
        .board-modal.is-announcement .board-modal-header {
          border-bottom: 1px solid rgba(139, 92, 246, 0.12);
          background: linear-gradient(135deg, rgba(243, 232, 255, 0.7), rgba(224, 231, 255, 0.5));
        }
        .board-modal.is-reward .board-modal-header {
          border-bottom: 1px solid rgba(249, 115, 22, 0.14);
          background: linear-gradient(135deg, rgba(255, 237, 213, 0.7), rgba(255, 228, 230, 0.5));
        }
        .board-modal.is-raffle .board-modal-header {
          border-bottom: 1px solid rgba(236, 72, 153, 0.14);
          background: linear-gradient(135deg, rgba(252, 231, 243, 0.7), rgba(255, 228, 230, 0.5));
        }
        .board-modal-title {
          display: flex;
          align-items: center;
          gap: 14px;
          flex: 1;
          min-width: 0;
        }
        .board-modal-icon {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .board-modal.is-announcement .board-modal-icon {
          background: linear-gradient(135deg, #a78bfa, #7c3aed);
          box-shadow: 0 12px 24px rgba(139, 92, 246, 0.35);
        }
        .board-modal.is-reward .board-modal-icon {
          background: linear-gradient(135deg, #fb923c, #f97316);
          box-shadow: 0 12px 24px rgba(249, 115, 22, 0.35);
        }
        .board-modal.is-raffle .board-modal-icon {
          background: linear-gradient(135deg, #f472b6, #ec4899);
          box-shadow: 0 12px 24px rgba(236, 72, 153, 0.35);
        }
        .board-modal-title h3 {
          font-size: 18px;
          font-weight: 900;
          color: #0f172a;
          margin: 0;
          letter-spacing: -0.3px;
          word-break: break-word;
        }
        .board-modal-title p {
          font-size: 12px;
          color: #64748b;
          margin: 4px 0 0;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          flex-wrap: wrap;
        }
        .board-modal-title p svg { vertical-align: middle; }
        .board-modal-divider {
          margin: 0 6px;
          color: rgba(15, 23, 42, 0.32);
        }

        .board-modal-close {
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
        .board-modal-close:hover {
          transform: rotate(90deg);
        }
        .board-modal.is-announcement .board-modal-close:hover {
          background: rgba(139, 92, 246, 0.18);
          color: #6d28d9;
        }
        .board-modal.is-reward .board-modal-close:hover {
          background: rgba(249, 115, 22, 0.18);
          color: #c2410c;
        }
        .board-modal.is-raffle .board-modal-close:hover {
          background: rgba(236, 72, 153, 0.18);
          color: #be185d;
        }

        .board-modal-body {
          padding: 22px 26px 18px;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
          position: relative;
          z-index: 1;
        }
        .board-modal-body::-webkit-scrollbar { width: 6px; }
        .board-modal.is-announcement .board-modal-body::-webkit-scrollbar-thumb {
          background: rgba(139, 92, 246, 0.3);
          border-radius: 6px;
        }
        .board-modal.is-reward .board-modal-body::-webkit-scrollbar-thumb {
          background: rgba(249, 115, 22, 0.3);
          border-radius: 6px;
        }
        .board-modal.is-raffle .board-modal-body::-webkit-scrollbar-thumb {
          background: rgba(236, 72, 153, 0.3);
          border-radius: 6px;
        }
        .board-modal-content {
          font-size: 14px;
          line-height: 1.75;
          color: #334155;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .board-modal-content.board-modal-markdown {
          white-space: normal;
        }
        .board-modal-desc {
          font-size: 14px;
          line-height: 1.75;
          color: #334155;
          margin: 0 0 14px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .board-modal-highlight {
          margin-top: 12px;
          padding: 14px 18px;
          border-radius: 16px;
          background: linear-gradient(135deg, rgba(251, 146, 60, 0.15), rgba(249, 115, 22, 0.09));
          border: 1px solid rgba(249, 115, 22, 0.25);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .board-modal-highlight .highlight-label {
          font-size: 12px;
          font-weight: 700;
          color: #c2410c;
          letter-spacing: 0.5px;
        }
        .board-modal-highlight .highlight-value {
          font-size: 22px;
          font-weight: 900;
          color: #ea580c;
          letter-spacing: -0.5px;
        }
        .board-modal-prizes {
          margin-top: 6px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .board-modal-prize-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          border-radius: 12px;
          background: rgba(236, 72, 153, 0.08);
          border: 1px solid rgba(236, 72, 153, 0.18);
          font-size: 13px;
        }
        .board-modal-prize-row .prize-name {
          font-weight: 700;
          color: #be185d;
        }
        .board-modal-prize-row .prize-meta {
          font-weight: 700;
          color: #db2777;
        }

        .board-modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding: 14px 26px 22px;
          border-top: 1px solid rgba(15, 23, 42, 0.06);
          position: relative;
          z-index: 1;
          flex-shrink: 0;
        }
        .board-modal-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 10px 18px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.2px;
          border: none;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
        }
        .board-modal-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .board-modal-btn.ghost {
          background: rgba(15, 23, 42, 0.05);
          color: #475569;
        }
        .board-modal-btn.ghost:hover:not(:disabled) {
          background: rgba(15, 23, 42, 0.10);
          transform: translateY(-1px);
        }
        .board-modal-btn.primary {
          color: #ffffff;
        }
        .board-modal.is-announcement .board-modal-btn.primary {
          background: linear-gradient(135deg, #a78bfa, #7c3aed);
          box-shadow: 0 10px 20px rgba(139, 92, 246, 0.35);
        }
        .board-modal.is-reward .board-modal-btn.primary {
          background: linear-gradient(135deg, #fb923c, #f97316);
          box-shadow: 0 10px 20px rgba(249, 115, 22, 0.35);
        }
        .board-modal.is-raffle .board-modal-btn.primary {
          background: linear-gradient(135deg, #f472b6, #ec4899);
          box-shadow: 0 10px 20px rgba(236, 72, 153, 0.35);
        }
        .board-modal-btn.primary:hover:not(:disabled) {
          transform: translateY(-1px) scale(1.02);
        }
        .board-modal-btn svg { width: 14px; height: 14px; }

        @media (max-width: 1280px) {
          .panel-right { column-gap: 18px; grid-template-rows: auto; grid-auto-rows: 20px; }
          .card { padding: 20px 18px; }
          .card h3 { font-size: 15px; }
          .card p { font-size: 11.5px; }
          .icon-wrapper { width: 46px; height: 46px; border-radius: 14px; }
          .icon-wrapper svg { width: 22px; height: 22px; }
        }

        @media (max-width: 1200px) {
          .hero-title { font-size: 42px; }
          .panel-left { padding: 3rem; }
          .panel-right {
            padding: 3rem 3rem 3rem 0;
            column-gap: 16px;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            grid-template-rows: auto;
            grid-auto-rows: 18px;
          }
          .card { padding: 18px 16px; }
          .card h3 { font-size: 14.5px; }
          .icon-wrapper { width: 44px; height: 44px; }
          .icon-wrapper svg { width: 20px; height: 20px; }
        }

        @media (max-width: 992px) {
          .lucky-home {
            height: 100dvh;
            overflow: hidden;
          }

          .layout {
            height: 100dvh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }

          .panel-left {
            width: 100%;
            height: auto;
            position: relative;
            padding: 1.5rem 2rem 0;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            text-align: left;
            z-index: 10;
          }

          .brand { font-size: 20px; }
          .brand-icon { width: 32px; height: 32px; border-radius: 10px; }

          .user-profile {
            position: absolute;
            top: 1.5rem;
            right: 2rem;
            margin: 0;
            padding: 0;
            width: auto;
            background: transparent;
            border: none;
            box-shadow: none;
          }

          .user-profile .user-info,
          .user-profile svg {
            display: none;
          }

          .user-profile .avatar {
            width: 40px;
            height: 40px;
            margin: 0;
          }

          .hero-content {
            margin-top: 1rem;
            width: 100%;
            align-items: flex-start;
          }

          .hero-title {
            font-size: 36px;
            margin-bottom: 16px;
          }

          .nav-list {
            flex-direction: row;
            flex-wrap: nowrap;
            overflow-x: auto;
            width: 100%;
            gap: 12px;
            padding-bottom: 16px;
            margin-bottom: 0;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
          }

          .nav-list::-webkit-scrollbar { display: none; }

          .nav-item {
            flex: 0 0 auto;
            padding: 10px 16px;
            font-size: 14px;
            min-width: 0;
          }

          /* 中屏：取消错位，改为常规 2 列 */
          .panel-right {
            flex: 1;
            width: 100%;
            padding: 1rem 2rem 4rem;
            overflow-y: auto;
            overflow-x: hidden;
            -webkit-overflow-scrolling: touch;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            grid-auto-rows: auto;
            gap: 16px;
          }

          .hot-rewards-section { grid-row: auto; margin-bottom: 24px; }
          .card-1, .card-2, .card-3, .card-4, .card-5, .card-6, .card-7 {
            grid-column: auto;
            grid-row: auto;
          }

          .card {
            padding: 22px 20px;
            gap: 14px;
            min-height: 200px;
            height: auto;
          }

          .icon-wrapper {
            margin-bottom: 0;
            flex-shrink: 0;
          }

          .card-btn {
            align-self: flex-start;
            margin-top: auto;
          }

          .card:hover .card-btn { transform: translateX(6px); }

          .card-content {
            width: 100%;
            display: flex;
            flex-direction: column;
            flex-grow: 1;
          }

          .card h3 {
            white-space: normal;
            overflow: visible;
          }

          .card p {
            display: block;
            overflow: visible;
          }
        }

        @media (max-width: 640px) {
          .lucky-home {
            height: auto;
            min-height: 100dvh;
            overflow-x: hidden;
            overflow-y: auto;
          }

          .layout {
            height: auto;
            min-height: 100dvh;
            overflow: visible;
          }

          .panel-left { padding: 1.5rem 1.5rem 0; }
          .user-profile { top: 1.5rem; right: 1.5rem; }
          .panel-right {
            display: grid;
            grid-template-columns: 1fr;
            padding: 0.875rem 1rem max(3rem, calc(2rem + env(safe-area-inset-bottom)));
            gap: 12px;
            height: auto;
            overflow: visible;
          }

          .mobile-typewriter-hero {
            display: block;
            padding: 0.25rem 0 0.5rem;
          }

          .mobile-hero-title {
            min-height: calc(2 * 1.08em);
          }

          .hero-title {
            font-size: 32px;
            line-height: 1.2;
            word-wrap: break-word;
          }

          .card {
            padding: 16px;
            gap: 14px;
            align-items: center;
            flex-direction: row;
            min-height: auto;
            height: auto;
            border-radius: 20px;
          }

          .icon-wrapper {
            width: 46px;
            height: 46px;
            border-radius: 14px;
            margin-bottom: 0;
            flex-shrink: 0;
          }

          .icon-wrapper svg {
            width: 24px;
            height: 24px;
          }

          .card-content {
            width: 100%;
            display: flex;
            flex-direction: column;
            flex-grow: 1;
          }

          .card h3 {
            font-size: 16px;
            margin-bottom: 6px;
            white-space: normal;
            overflow: visible;
          }

          .card p {
            font-size: 12.5px;
            margin-bottom: 10px;
            line-height: 1.45;
            display: -webkit-box;
            overflow: hidden;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
          }

          .card-btn {
            align-self: flex-start;
            height: 32px;
            padding: 0 13px;
            font-size: 12px;
            margin-top: auto;
          }

          .card:hover .card-btn { transform: translateX(4px); }
          .hot-rewards-section { margin-bottom: 4px; }
          .section-header { margin-bottom: 16px; }
          .section-title { font-size: 18px; }
          .marquee-container {
            margin-right: -1rem;
            padding-right: 1rem;
            overflow: hidden;
            -webkit-mask-image: linear-gradient(to right, transparent, black 5%, black 95%, transparent);
            mask-image: linear-gradient(to right, transparent, black 5%, black 95%, transparent);
            scrollbar-width: none;
            -webkit-overflow-scrolling: touch;
          }
          .marquee-container::-webkit-scrollbar { display: none; }
          .marquee-content.is-animated { animation-duration: 18s; }
          .reward-card,
          .raffle-card,
          .announce-card { width: 270px; max-width: 78vw; padding: 14px 16px; }
          .reward-card .reward-prize { font-size: 16px; }
          .raffle-card .raffle-title { font-size: 15px; }
          .announce-card .ann-title { font-size: 15px; }
          .board-modal-mask { padding: 12px; }
          .board-modal { border-radius: 22px; max-height: 88vh; }
          .board-modal-header { padding: 18px 20px; gap: 10px; }
          .board-modal-title h3 { font-size: 16px; }
          .board-modal-icon { width: 38px; height: 38px; }
          .board-modal-body { padding: 18px 20px 16px; }
          .board-modal-content,
          .board-modal-desc { font-size: 13px; }
          .board-modal-footer { padding: 12px 20px 18px; }
          .board-modal-btn { padding: 9px 14px; font-size: 12.5px; }
        }

        @media (max-width: 480px) {
          .panel-right { padding: 0.75rem 0.875rem 2.5rem; }
          .card { padding: 14px; border-radius: 18px; }
          .icon-wrapper { width: 42px; height: 42px; border-radius: 13px; }
          .card h3 { font-size: 15.5px; }
          .card p { font-size: 12px; }
          .card-btn { height: 30px; padding: 0 12px; }
        }
      `}</style>
    </div>
  );
}
