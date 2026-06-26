'use client';

import { useEffect, useRef, useState, use, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  Check,
  Clock,
  Copy,
  Crown,
  Gift,
  Info,
  Loader2,
  Package,
  PartyPopper,
  RefreshCw,
  Sparkles,
  Star,
  Trophy,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { formatChinaDateTime } from '@/lib/time';

// ============================================================================
// 顶层路由分发：按 ?type=raffle 切换免费福利项目详情类型
// ============================================================================
export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<ProjectDetailLoading />}>
      <ProjectDetailRouter id={id} />
    </Suspense>
  );
}

function ProjectDetailRouter({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const detailType = searchParams.get('type');
  if (detailType === 'raffle') return <RaffleDetailView id={id} />;
  return <ProjectDetailView id={id} />;
}

function ProjectDetailLoading() {
  return (
    <div className="lwf-project lwf-project-loading">
      <div className="mesh-bg" />
      <Loader2 className="lwf-spin" />
      <p>加载中...</p>
      <style jsx global>{LWF_PROJECT_STYLES}</style>
    </div>
  );
}

// ============================================================================
// 类型
// ============================================================================
interface Project {
  id: string;
  name: string;
  description: string;
  maxClaims: number;
  claimedCount: number;
  codesCount: number;
  status: 'active' | 'paused' | 'exhausted';
  createdAt: number;
  createdBy: string;
  rewardType?: 'code' | 'direct';
  directPoints?: number;
  directDollars?: number;
  newUserOnly?: boolean;
}

interface UserData {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

interface ClaimedInfo {
  code: string;
  claimedAt: number;
  directCredit?: boolean;
  creditedPoints?: number;
  creditedDollars?: number;
  creditStatus?: 'pending' | 'success' | 'uncertain';
  creditMessage?: string;
}

// ============================================================================
// 辅助
// ============================================================================
function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN');
}

function formatDateTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// ============================================================================
// 主组件
// ============================================================================
function ProjectDetailView({ id }: { id: string }) {
  const router = useRouter();

  const [project, setProject] = useState<Project | null>(null);
  const [user, setUser] = useState<UserData | null>(null);
  const [claimedInfo, setClaimedInfo] = useState<ClaimedInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---------- 数据加载 ----------
  const fetchData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);

      const [projectRes, userRes] = await Promise.all([
        fetch(`/api/projects/${id}`, { cache: 'no-store' }),
        fetch('/api/auth/me', { cache: 'no-store' }),
      ]);

      if (userRes.ok) {
        const userData = await userRes.json().catch(() => ({ success: false }));
        if (userData?.success) setUser(userData.user);
      }

      if (projectRes.ok) {
        const projectData = await projectRes.json().catch(() => ({ success: false }));
        if (projectData?.success) {
          setProject(projectData.project);
          setClaimedInfo(projectData.claimed);
        } else {
          setError(projectData?.message || '获取项目信息失败');
        }
      } else {
        setError('项目不存在或已被删除');
      }
    } catch {
      setError('网络请求失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  // ---------- 刷新（与商店保持一致：旋转动画 + 静默拉取） ----------
  const triggerRefresh = () => {
    if (refreshSpin) return;
    setRefreshSpin(true);
    void fetchData(true).finally(() => {
      setTimeout(() => setRefreshSpin(false), 600);
    });
  };

  // ---------- 领取 ----------
  const handleClaim = async () => {
    if (!user) {
      router.push(`/login?redirect=/project/${id}`);
      return;
    }

    try {
      setClaiming(true);
      setError(null);

      const res = await fetch(`/api/projects/${id}`, { method: 'POST' });
      const data = await res.json().catch(() => ({ success: false }));

      if (data?.success) {
        setClaimedInfo({
          code: data.code || '',
          claimedAt: Date.now(),
          directCredit: data.directCredit,
          creditedPoints: data.creditedPoints,
          creditedDollars: data.creditedDollars,
          creditStatus: data.creditStatus,
          creditMessage: data.message,
        });
        void fetchData();
      } else {
        setError(data?.message || '领取失败');
      }
    } catch {
      setError('领取请求失败，请稍后重试');
    } finally {
      setClaiming(false);
    }
  };

  // ---------- 复制兑换码 ----------
  const handleCopy = async () => {
    if (!claimedInfo?.code) return;
    try {
      await navigator.clipboard.writeText(claimedInfo.code);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 2000);
    } catch {
      setError('复制失败，请手动复制');
    }
  };

  // ---------- 加载/错误状态 ----------
  if (loading) {
    return (
      <div className="lwf-project lwf-project-loading">
        <div className="mesh-bg" />
        <Loader2 className="lwf-spin" />
        <p>加载中...</p>
        <style jsx global>{LWF_PROJECT_STYLES}</style>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="lwf-project lwf-project-error">
        <div className="mesh-bg" />
        <div className="error-card">
          <div className="error-icon">
            <AlertCircle />
          </div>
          <h2>出错了</h2>
          <p>{error || '找不到该项目'}</p>
        </div>
        <style jsx global>{LWF_PROJECT_STYLES}</style>
      </div>
    );
  }

  // ---------- 派生状态 ----------
  const isPaused = project.status === 'paused';
  const isSoldOut = project.status === 'exhausted' || project.claimedCount >= project.maxClaims;
  const canClaim = !isPaused && !isSoldOut && !claimedInfo && !!user;
  const remaining = Math.max(0, project.maxClaims - project.claimedCount);
  const progress = project.maxClaims > 0
    ? Math.min(100, Math.round((project.claimedCount / project.maxClaims) * 100))
    : 0;
  const isDirectProject = project.rewardType === 'direct';
  const directPoints = project.directPoints ?? project.directDollars ?? 0;
  // 主题色：直充 → t-pink，兑换码 → t-orange
  const cardTheme = isDirectProject ? 't-pink' : 't-orange';

  // 直充三态
  const isDirectPending = isDirectProject && claimedInfo?.creditStatus === 'pending';
  const isDirectUncertain = isDirectProject && claimedInfo?.creditStatus === 'uncertain';
  const isDirectSuccess = isDirectProject && claimedInfo?.creditStatus === 'success';

  return (
    <div className="lwf-project">
      <div className="mesh-bg" />

      {/* 顶部导航栏：同步扫雷游戏的 EXIT 胶囊 */}
      <header className="topbar">
        <Link href="/store" className="detail-exit-btn" aria-label="退出到福利商店">
          <span className="arrow">
            <ArrowLeft size={14} strokeWidth={2.4} />
          </span>
          EXIT
        </Link>
      </header>

      <main className="container">
        {/* 错误提示 */}
        {error && (
          <div className="store-message error">
            <Info />
            <span>{error}</span>
            <button
              type="button"
              className="store-message-close"
              onClick={() => setError(null)}
              aria-label="关闭提示"
            >
              <X />
            </button>
          </div>
        )}

        {/* 章节标题 */}
        <div className="page-header">
          <div className="header-left">
            <h2 className="section-title">
              <span className="title-icon">
                <Gift strokeWidth={2.5} />
              </span>
              福利信息
            </h2>
            <p className="header-subtitle">
              查看本福利的剩余名额、领取进度与详细规则，确认后即可一键领取专属奖励。
            </p>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className={`btn-icon ${refreshSpin ? 'spinning' : ''}`}
              onClick={triggerRefresh}
              disabled={refreshSpin}
              aria-label="刷新"
            >
              <RefreshCw />
            </button>
          </div>
        </div>

        {/* 数据概览：与商店统计卡保持一致的 4 张主题卡 */}
        <section className="stats-grid">
          <div className="stat-card t-amber">
            <div className="stat-head">
              <div className="stat-icon">
                <Users strokeWidth={2.4} />
              </div>
              <div className="stat-label">已领取</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{formatNumber(project.claimedCount)}</span>
              <span className="stat-unit">人</span>
            </div>
          </div>

          <div className="stat-card t-orange">
            <div className="stat-head">
              <div className="stat-icon">
                <Gift strokeWidth={2.4} />
              </div>
              <div className="stat-label">剩余名额</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{formatNumber(remaining)}</span>
              <span className="stat-unit">份</span>
            </div>
          </div>

          <div className="stat-card t-green">
            <div className="stat-head">
              <div className="stat-icon">
                <Sparkles strokeWidth={2.4} />
              </div>
              <div className="stat-label">完成进度</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{progress}</span>
              <span className="stat-unit">%</span>
            </div>
          </div>

          <div className="stat-card t-purple">
            <div className="stat-head">
              <div className="stat-icon">
                {isDirectProject ? <Wallet strokeWidth={2.4} /> : <BadgeCheck strokeWidth={2.4} />}
              </div>
              <div className="stat-label">福利类型</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">
                {isDirectProject ? formatNumber(directPoints) : formatNumber(project.maxClaims)}
              </span>
              <span className="stat-unit">{isDirectProject ? '积分直充' : '张兑换码'}</span>
            </div>
          </div>
        </section>

        {/* 主详情卡 */}
        <section className={`item-card detail-card ${cardTheme}`}>
          {/* 角标 */}
          {claimedInfo ? (
            <span className="corner-tag claimed">
              <BadgeCheck size={12} />
              已领取
            </span>
          ) : isSoldOut ? (
            <span className="corner-tag soldout">
              <Package size={12} />
              已领完
            </span>
          ) : (
            <span className="corner-tag hot">
              <Sparkles size={12} />
              热门福利
            </span>
          )}

          {/* 头区 */}
          <div className="ic-head">
            <div className="ic-icon">
              <Gift strokeWidth={2.2} />
            </div>
            <div className="ic-title-area">
              <div className="ic-title">{project.name}</div>
              <div className="ic-tags">
                <span className="ic-tag cat-welfare">福利</span>
                {project.newUserOnly && <span className="ic-tag limit">仅限新人</span>}
                {isDirectProject && directPoints ? (
                  <span className="ic-tag cat-topup">直充 {formatNumber(directPoints)} 积分</span>
                ) : (
                  <span className="ic-tag cat-card">兑换码</span>
                )}
                {isPaused ? (
                  <span className="ic-status paused">
                    <span className="dot" />
                    已暂停
                  </span>
                ) : isSoldOut ? (
                  <span className="ic-status ended">
                    <span className="dot" />
                    已领完
                  </span>
                ) : (
                  <span className="ic-status active">
                    <span className="dot" />
                    进行中
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 描述区 */}
          <div className="ic-desc">{project.description || '该项目暂无详细描述。'}</div>

          {/* 进度区 */}
          <div className="ic-progress-section">
            <div className="ic-progress-text">
              <span>
                已领 <span className="num received">{formatNumber(project.claimedCount)}</span>
              </span>
              <span>
                剩 <span className="num">{formatNumber(remaining)}</span> / {formatNumber(project.maxClaims)}
              </span>
            </div>
            <div className="ic-progress-track">
              <div className="ic-progress-bar" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {/* 操作面板 */}
          <div className="action-panel">
            {claimedInfo ? (
              // —— 已领取分支 ——
              <div className="claimed-block">
                <div className={`claimed-icon ${isDirectPending ? 'pending' : isDirectUncertain ? 'uncertain' : 'success'}`}>
                  {isDirectPending ? (
                    <Loader2 className="ic-action-spin" />
                  ) : isDirectUncertain ? (
                    <AlertCircle />
                  ) : (
                    <Check />
                  )}
                </div>
                <h3 className="claimed-title">
                  {isDirectPending ? '领取处理中' : isDirectUncertain ? '领取已提交' : '领取成功！'}
                </h3>

                {claimedInfo.directCredit ? (
                  <>
                    <p className="claimed-sub">
                      {isDirectUncertain
                        ? '积分发放结果不确定，请稍后检查积分余额。如有问题请联系管理员。'
                        : isDirectPending
                          ? '正在处理积分发放，请稍后刷新页面查看结果。'
                          : `已发放 ${formatNumber(claimedInfo.creditedPoints ?? claimedInfo.creditedDollars ?? directPoints)} 积分到您的账户`}
                    </p>

                    <div className="direct-card">
                      <div className="direct-card-row">
                        <span className="direct-label">直充积分</span>
                        <span className="direct-value">
                          {formatNumber(claimedInfo.creditedPoints ?? claimedInfo.creditedDollars ?? directPoints)}
                        </span>
                      </div>
                      <div className="direct-card-foot">
                        <span className={`direct-status ${isDirectPending ? 'pending' : isDirectUncertain ? 'uncertain' : 'success'}`}>
                          {isDirectPending ? '处理中' : isDirectUncertain ? '待确认' : isDirectSuccess ? '已发放' : '已发放'}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="claimed-sub">这是您的专属兑换码，请妥善保管。</p>
                    <div className="code-box">
                      <div className="code-text">{claimedInfo.code}</div>
                      <button
                        type="button"
                        onClick={handleCopy}
                        className={`code-copy-btn ${copied ? 'is-copied' : ''}`}
                        aria-label="复制兑换码"
                      >
                        {copied ? <Check /> : <Copy />}
                      </button>
                    </div>
                  </>
                )}

                <div className="claimed-meta">领取时间：{formatDateTime(claimedInfo.claimedAt)}</div>
              </div>
            ) : !user ? (
              // —— 未登录分支 ——
              <div className="login-block">
                <div className="login-icon">
                  <Sparkles />
                </div>
                <h3 className="login-title">请先登录</h3>
                <p className="login-sub">
                  登录账号后即可领取{isDirectProject ? '积分福利' : '专属兑换码'}
                </p>
                <Link
                  href={`/login?redirect=/project/${id}`}
                  className="ic-action-btn primary big"
                >
                  <Sparkles size={16} />
                  立即登录
                </Link>
              </div>
            ) : canClaim ? (
              // —— 可领取分支 ——
              <div className="claim-block">
                <p className="claim-tip">点击下方按钮即可领取，每人限领一次。</p>
                <button
                  type="button"
                  onClick={handleClaim}
                  disabled={claiming}
                  className="ic-action-btn pink big"
                >
                  {claiming ? (
                    <>
                      <Loader2 className="ic-action-spin" size={18} />
                      正在领取...
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      {isDirectProject ? '立即领取积分' : '立即领取兑换码'}
                    </>
                  )}
                </button>
              </div>
            ) : (
              // —— 暂停 / 已领完 ——
              <div className="disabled-block">
                <div className="disabled-icon">
                  <Package />
                </div>
                <button type="button" disabled className="ic-action-btn disabled big">
                  {isPaused ? '项目暂停中' : '已领完'}
                </button>
                <p className="disabled-sub">
                  {isPaused ? '管理员暂停了该项目的领取' : '手慢了，下次早点来哦'}
                </p>
              </div>
            )}
          </div>
        </section>
      </main>

      <style jsx global>{LWF_PROJECT_STYLES}</style>
    </div>
  );
}

// ============================================================================
// 多人抽奖详情视图（融入福利商店免费福利项目）
// ============================================================================
interface RafflePrize {
  id: string;
  name: string;
  points?: number;
  dollars?: number;
  quantity: number;
}

interface RaffleWinner {
  entryId: string;
  userId: number;
  username: string;
  prizeId: string;
  prizeName: string;
  points?: number;
  dollars?: number;
  rewardStatus: 'pending' | 'delivered' | 'failed';
}

interface RaffleEntry {
  id: string;
  raffleId: string;
  userId: number;
  username: string;
  entryNumber: number;
  createdAt: number;
}

interface Raffle {
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
  winners?: RaffleWinner[];
  redPacketTotalPoints?: number;
  redPacketTotalSlots?: number;
  redPacketRemainingPoints?: number;
  redPacketRemainingSlots?: number;
  createdAt: number;
}

interface RaffleUserStatus {
  hasJoined: boolean;
  entry?: RaffleEntry;
  isWinner: boolean;
  prize?: RaffleWinner;
}

function getTotalPrizeValue(prizes: RafflePrize[]): number {
  return prizes.reduce((sum, p) => sum + getRafflePrizePoints(p) * (p.quantity || 0), 0);
}

function getTotalPrizeQuantity(prizes: RafflePrize[]): number {
  return prizes.reduce((sum, p) => sum + (p.quantity || 0), 0);
}

function getRafflePrizePoints(prize: { points?: number; dollars?: number }): number {
  const normalize = (value: unknown) => {
    const points = Number(value);
    if (!Number.isFinite(points) || points <= 0) return null;
    return Math.max(0, Math.round(points));
  };
  return normalize(prize.points) ?? normalize(prize.dollars) ?? 0;
}

function formatRafflePoints(points: number): string {
  return `${formatNumber(points)} 积分`;
}

function RaffleDetailView({ id }: { id: string }) {
  const router = useRouter();

  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [joining, setJoining] = useState(false);
  const [raffle, setRaffle] = useState<Raffle | null>(null);
  const [entries, setEntries] = useState<RaffleEntry[]>([]);
  const [userStatus, setUserStatus] = useState<RaffleUserStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);

  // ---------- 数据加载 ----------
  const fetchData = useCallback(async (silent = false) => {
    try {
      const [userRes, raffleRes] = await Promise.all([
        fetch('/api/auth/me', { cache: 'no-store' }),
        fetch(`/api/raffle/${id}`, { cache: 'no-store' }),
      ]);

      if (userRes.ok) {
        const userData = await userRes.json().catch(() => ({ success: false }));
        if (userData?.success) setUser(userData.user);
      }

      if (raffleRes.ok) {
        const data = await raffleRes.json().catch(() => ({ success: false }));
        if (data?.success) {
          setRaffle(data.raffle);
          setEntries(data.entries || []);
          setUserStatus(data.userStatus);
          if (data.userStatus?.isWinner) setShowConfetti(true);
        } else {
          setError(data?.message || '活动不存在');
        }
      } else {
        setError('活动不存在');
      }
    } catch (err) {
      console.error('加载失败:', err);
      setError('加载失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // ---------- 刷新（与商店一致：旋转动画 + 静默拉取） ----------
  const triggerRefresh = () => {
    if (refreshSpin) return;
    setRefreshSpin(true);
    void fetchData(true).finally(() => {
      setTimeout(() => setRefreshSpin(false), 600);
    });
  };

  // ---------- 中奖庆祝动画 ----------
  useEffect(() => {
    if (!showConfetti) return;
    void import('canvas-confetti').then(({ default: confetti }) => {
      const duration = 3000;
      const end = Date.now() + duration;
      const frame = () => {
        confetti({
          particleCount: 3,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ['#ec4899', '#8b5cf6', '#fbbf24'],
        });
        confetti({
          particleCount: 3,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ['#ec4899', '#8b5cf6', '#fbbf24'],
        });
        if (Date.now() < end) requestAnimationFrame(frame);
      };
      frame();
    });
  }, [showConfetti]);

  // ---------- 参与抽奖 ----------
  const handleJoin = async () => {
    if (!user) {
      router.push(`/login?redirect=/project/${id}?type=raffle`);
      return;
    }

    setJoining(true);
    setError(null);

    try {
      const res = await fetch(`/api/raffle/${id}/join`, { method: 'POST' });
      const data = await res.json().catch(() => ({ success: false }));

      if (data?.success) {
        await fetchData();
      } else {
        setError(data?.message || '参与失败');
      }
    } catch (err) {
      console.error('参与失败:', err);
      setError('参与失败，请稍后重试');
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="lwf-project lwf-project-loading">
        <div className="mesh-bg" />
        <Loader2 className="lwf-spin" />
        <p>加载活动中…</p>
        <style jsx global>{LWF_PROJECT_STYLES}</style>
      </div>
    );
  }

  if (error && !raffle) {
    return (
      <div className="lwf-project lwf-project-error">
        <div className="mesh-bg" />
        <div className="error-card">
          <div className="error-icon">
            <AlertCircle />
          </div>
          <h2>出错了</h2>
          <p>{error || '活动不存在'}</p>
        </div>
        <style jsx global>{LWF_PROJECT_STYLES}</style>
      </div>
    );
  }

  if (!raffle) return null;

  const isRedPacket = raffle.mode === 'red_packet';
  const totalPool = isRedPacket ? raffle.redPacketTotalPoints ?? 0 : getTotalPrizeValue(raffle.prizes);
  const totalQuantity = isRedPacket ? raffle.redPacketTotalSlots ?? 0 : getTotalPrizeQuantity(raffle.prizes);
  const remainingSlots = isRedPacket
    ? raffle.redPacketRemainingSlots ?? Math.max(0, totalQuantity - raffle.participantsCount)
    : 0;
  const remainingPoints = isRedPacket ? raffle.redPacketRemainingPoints ?? 0 : 0;
  const isThreshold = raffle.triggerType === 'threshold' && raffle.threshold > 0;
  const isScheduled = raffle.triggerType === 'scheduled' && !!raffle.scheduledDrawAt;
  const progressPercent = isRedPacket && totalQuantity > 0
    ? Math.min(100, Math.round((raffle.participantsCount / totalQuantity) * 100))
    : isThreshold
    ? Math.min(100, Math.round((raffle.participantsCount / raffle.threshold) * 100))
    : 0;
  const remainingNeeded = isThreshold
    ? Math.max(0, raffle.threshold - raffle.participantsCount)
    : 0;
  const isActive = raffle.status === 'active';
  const isEnded = raffle.status === 'ended';

  return (
    <div className="lwf-project">
      <div className="mesh-bg" />

      {/* 顶部导航栏：同步扫雷游戏的 EXIT 胶囊 */}
      <header className="topbar">
        <Link href="/store" className="detail-exit-btn" aria-label="退出到福利商店">
          <span className="arrow">
            <ArrowLeft size={14} strokeWidth={2.4} />
          </span>
          EXIT
        </Link>
      </header>

      <main className="container">
        {/* 错误提示 */}
        {error && (
          <div className="store-message error">
            <Info />
            <span>{error}</span>
            <button
              type="button"
              className="store-message-close"
              onClick={() => setError(null)}
              aria-label="关闭提示"
            >
              <X />
            </button>
          </div>
        )}

        {/* 章节标题 */}
        <div className="page-header">
          <div className="header-left">
            <h2 className="section-title">
              <span className="title-icon">
                {isRedPacket ? <Gift strokeWidth={2.5} /> : <Users strokeWidth={2.5} />}
              </span>
              {isRedPacket ? '抢红包详情' : '抽奖详情'}
            </h2>
            <p className="header-subtitle">
              {isRedPacket
                ? '查看红包总积分、剩余名额与领取进度，点击即可随机抢到整数积分。'
                : '查看奖品池构成、参与人数与开奖进度，立即免费参与，把握每一次锁定大奖的机会。'}
            </p>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className={`btn-icon ${refreshSpin ? 'spinning' : ''}`}
              onClick={triggerRefresh}
              disabled={refreshSpin}
              aria-label="刷新"
            >
              <RefreshCw />
            </button>
          </div>
        </div>

        {/* 数据概览：与商店统计卡保持一致的 4 张主题卡 */}
        <section className="stats-grid">
          <div className="stat-card t-amber">
            <div className="stat-head">
              <div className="stat-icon">
                <Trophy strokeWidth={2.4} />
              </div>
              <div className="stat-label">{isRedPacket ? '红包总额' : '总奖池'}</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{formatNumber(totalPool)}</span>
              <span className="stat-unit">积分</span>
            </div>
          </div>

          <div className="stat-card t-orange">
            <div className="stat-head">
              <div className="stat-icon">
                <Users strokeWidth={2.4} />
              </div>
              <div className="stat-label">{isRedPacket ? '已抢人数' : '参与人数'}</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{formatNumber(raffle.participantsCount)}</span>
              <span className="stat-unit">人</span>
            </div>
          </div>

          <div className="stat-card t-green">
            <div className="stat-head">
              <div className="stat-icon">
                <Gift strokeWidth={2.4} />
              </div>
              <div className="stat-label">{isRedPacket ? '剩余名额' : '奖品档数'}</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">{formatNumber(isRedPacket ? remainingSlots : raffle.prizes.length)}</span>
              <span className="stat-unit">{isRedPacket ? `名 · 剩 ${formatRafflePoints(remainingPoints)}` : `档 · ${formatNumber(totalQuantity)} 名`}</span>
            </div>
          </div>

          <div className="stat-card t-purple">
            <div className="stat-head">
              <div className="stat-icon">
                {isThreshold ? <Sparkles strokeWidth={2.4} /> : <Clock strokeWidth={2.4} />}
              </div>
              <div className="stat-label">{isRedPacket ? '红包名额' : '开奖触发'}</div>
            </div>
            <div className="stat-value-row">
              <span className="stat-value">
                {isRedPacket
                  ? formatNumber(totalQuantity)
                  : isThreshold
                    ? formatNumber(raffle.threshold)
                    : isScheduled
                      ? '到点'
                      : '手动'}
              </span>
              <span className="stat-unit">{isRedPacket ? '人可抢' : isThreshold ? '人开奖' : isScheduled ? formatChinaDateTime(raffle.scheduledDrawAt) : '管理员开奖'}</span>
            </div>
          </div>
        </section>

        {/* 活动主卡 */}
        <section className="item-card detail-card t-pink">
          {isActive ? (
            <span className="corner-tag hot">
              <Sparkles size={11} />
              进行中
            </span>
          ) : isEnded ? (
            <span className="corner-tag soldout">
              <Clock size={11} />
              {isRedPacket ? '已抢完' : '已开奖'}
            </span>
          ) : (
            <span className="corner-tag soldout">
              <Clock size={11} />
              已取消
            </span>
          )}

          <div className="ic-head">
            <div className="ic-icon">
              {isRedPacket ? <Gift strokeWidth={2.2} /> : <Users strokeWidth={2.2} />}
            </div>
            <div className="ic-title-area">
              <div className="ic-title">{raffle.title}</div>
              <div className="ic-tags">
                <span className="ic-tag cat-welfare">福利</span>
                <span className="ic-tag cat-makeup">{isRedPacket ? '抢红包' : '多人抽奖'}</span>
                {isRedPacket ? (
                  <span className="ic-tag limit">{formatNumber(totalQuantity)} 个红包</span>
                ) : isThreshold ? (
                  <span className="ic-tag limit">满 {raffle.threshold} 人开奖</span>
                ) : isScheduled ? (
                  <span className="ic-tag limit">{formatChinaDateTime(raffle.scheduledDrawAt)} 开奖</span>
                ) : (
                  <span className="ic-tag limit">手动开奖</span>
                )}
                {isActive && (
                  <span className="ic-status active">
                    <span className="dot" />
                    进行中
                  </span>
                )}
                {isEnded && (
                  <span className="ic-status ended">
                    <span className="dot" />
                    {isRedPacket ? '已抢完' : '已开奖'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {raffle.description && <div className="ic-desc">{raffle.description}</div>}

          {isActive && (isRedPacket || isThreshold || isScheduled) && (
            <div className="ic-progress-section">
              <div className="ic-progress-text">
                <span>
                  {isRedPacket ? '已抢' : '已参与'} <span className="num received">{formatNumber(raffle.participantsCount)}</span>
                </span>
                <span>
                  {isRedPacket ? (
                    <>剩 <span className="num">{formatNumber(remainingSlots)}</span> 个 · {progressPercent}%</>
                  ) : isScheduled ? (
                    <>北京时间 <span className="num">{formatChinaDateTime(raffle.scheduledDrawAt)}</span></>
                  ) : (
                    <>目标 <span className="num">{formatNumber(raffle.threshold)}</span> 人 · {progressPercent}%</>
                  )}
                </span>
              </div>
              <div className="ic-progress-track">
                <div className="ic-progress-bar" style={{ width: `${progressPercent}%` }} />
              </div>
              {isRedPacket ? (
                <p className="progress-tip">
                  剩余 <strong>{formatNumber(remainingSlots)}</strong> 个红包，剩余积分 <strong>{formatRafflePoints(remainingPoints)}</strong>。
                </p>
              ) : remainingNeeded > 0 && (
                <p className="progress-tip">
                  还差 <strong>{formatNumber(remainingNeeded)}</strong> 人即可开奖，邀请好友一起参与吧～
                </p>
              )}
              {isScheduled && (
                <p className="progress-tip">
                  将于 <strong>{formatChinaDateTime(raffle.scheduledDrawAt)}</strong> 自动开奖。
                </p>
              )}
            </div>
          )}

          {/* 操作面板 */}
          {isActive && (
            <div className="action-panel">
              {userStatus?.hasJoined ? (
                <div className="claimed-block">
                  <div className="claimed-icon success">
                    <Check />
                  </div>
                  <h3 className="claimed-title">{isRedPacket ? '已抢到红包' : '已参与'}</h3>
                  {isRedPacket && userStatus.prize ? (
                    <>
                      <p className="claimed-sub">
                        本次获得：
                        <span className="entry-number">{formatRafflePoints(getRafflePrizePoints(userStatus.prize))}</span>
                      </p>
                      <p className="claimed-meta">
                        {userStatus.prize.rewardStatus === 'delivered'
                          ? '积分已发放到账。'
                          : '积分发放确认中，请稍后刷新查看。'}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="claimed-sub">
                        您的抽奖号码：
                        <span className="entry-number">#{userStatus.entry?.entryNumber ?? '-'}</span>
                      </p>
                      <p className="claimed-meta">耐心等待开奖结果，祝您好运！</p>
                    </>
                  )}
                </div>
              ) : !user ? (
                <div className="login-block">
                  <div className="login-icon">
                    <Sparkles />
                  </div>
                  <h3 className="login-title">请先登录</h3>
                  <p className="login-sub">登录账号后即可免费{isRedPacket ? '抢红包' : '参与本次抽奖'}。</p>
                  <Link
                    href={`/login?redirect=${encodeURIComponent(`/project/${id}?type=raffle`)}`}
                    className="ic-action-btn primary big"
                  >
                    <Sparkles size={16} />
                    立即登录
                  </Link>
                </div>
              ) : (
                <div className="claim-block">
                  <p className="claim-tip">
                    {isRedPacket
                      ? '每人限抢一次，积分随机分配且全部为整数。'
                      : '每人限参与一次，免费名额有限，立即报名锁定机会。'}
                  </p>
                  <button
                    type="button"
                    onClick={handleJoin}
                    disabled={joining}
                    className="ic-action-btn pink big"
                  >
                    {joining ? (
                      <>
                        <Loader2 className="ic-action-spin" size={18} />
                        {isRedPacket ? '抢红包中...' : '参与中...'}
                      </>
                    ) : (
                      <>
                        <Gift size={16} />
                        {isRedPacket ? '立即抢红包' : '免费参与抽奖'}
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {isEnded && !userStatus?.isWinner && (
            <div className="action-panel ended-panel">
              <div className="disabled-icon">
                <Clock />
              </div>
              <h3 className="claimed-title">{isRedPacket ? '本次红包已抢完' : '本次抽奖已开奖'}</h3>
              <p className="claimed-sub">
                {isRedPacket
                  ? userStatus?.hasJoined
                    ? '您已抢过本次红包，领取结果已在上方展示。'
                    : '本次红包已全部抢完，请关注其它进行中的福利项目。'
                  : userStatus?.hasJoined
                  ? '您参与了本次抽奖，但很遗憾未能中奖，下次再来吧～'
                  : '本次活动已结束，请关注其它进行中的福利项目。'}
              </p>
            </div>
          )}
        </section>

        {/* 中奖横幅 */}
        {userStatus?.isWinner && userStatus.prize && (
          <section className="item-card winner-banner t-pink">
            <span className="corner-tag hot">
              <PartyPopper size={11} />
              {isRedPacket ? '红包' : '中奖'}
            </span>
            <div className="winner-row">
              <div className="winner-icon">
                <PartyPopper />
              </div>
              <div className="winner-content">
                <div className="winner-eyebrow">{isRedPacket ? '恭喜抢到' : '恭喜中奖'}</div>
                <h3 className="winner-title">{isRedPacket ? '随机红包' : userStatus.prize.prizeName}</h3>
                <div className="winner-amount">{formatRafflePoints(getRafflePrizePoints(userStatus.prize))}</div>
              </div>
              <div className="winner-status-wrap">
                {userStatus.prize.rewardStatus === 'delivered' && (
                  <span className="direct-status success">
                    <Check size={12} />
                    已发放到账
                  </span>
                )}
                {userStatus.prize.rewardStatus === 'pending' && (
                  <span className="direct-status pending">
                    <Loader2 size={12} className="ic-action-spin" />
                    发放中
                  </span>
                )}
                {userStatus.prize.rewardStatus === 'failed' && (
                  <span className="direct-status uncertain">
                    <AlertCircle size={12} />
                    发放失败
                  </span>
                )}
              </div>
            </div>
          </section>
        )}

        {/* 奖品池 */}
        <section className="item-card prize-pool-card t-orange">
          <div className="section-head">
            <div className="sh-icon">
              <Trophy />
            </div>
            <div className="sh-text">
              <div className="sh-title">{isRedPacket ? '红包池' : '奖品池'}</div>
              <div className="sh-sub">
                {isRedPacket ? (
                  <>
                    共 {formatNumber(totalQuantity)} 个红包 · 总积分
                    <strong> {formatRafflePoints(totalPool)}</strong>
                  </>
                ) : (
                  <>
                    共 {formatNumber(raffle.prizes.length)} 档奖品 · {formatNumber(totalQuantity)} 个名额 · 总积分
                    <strong> {formatRafflePoints(totalPool)}</strong>
                  </>
                )}
              </div>
            </div>
          </div>

          {isRedPacket ? (
            <div className="prize-list">
              <div className="prize-row rank-1">
                <div className="prize-rank">
                  <Gift />
                </div>
                <div className="prize-meta">
                  <div className="prize-name">随机整数红包</div>
                  <div className="prize-quantity">每人最多抢 1 次，每份至少 1 积分</div>
                </div>
                <div className="prize-amount">剩 {formatRafflePoints(remainingPoints)}</div>
              </div>
            </div>
          ) : (
          <div className="prize-list">
            {raffle.prizes.map((prize, index) => {
              const rankClass = index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : 'rank-n';
              return (
                <div key={prize.id} className={`prize-row ${rankClass}`}>
                  <div className="prize-rank">
                    {index === 0 ? <Crown /> : index === 1 ? <Star /> : index === 2 ? <Trophy /> : <span>{index + 1}</span>}
                  </div>
                  <div className="prize-meta">
                    <div className="prize-name">{prize.name}</div>
                    <div className="prize-quantity">{formatNumber(prize.quantity)} 名中奖者</div>
                  </div>
                  <div className="prize-amount">{formatRafflePoints(getRafflePrizePoints(prize))}</div>
                </div>
              );
            })}
          </div>
          )}
        </section>

        {/* 中奖名单 */}
        {isEnded && raffle.winners && raffle.winners.length > 0 && (
          <section className="item-card winners-card t-amber">
            <div className="section-head">
              <div className="sh-icon">
                <Crown />
              </div>
              <div className="sh-text">
                <div className="sh-title">{isRedPacket ? '红包领取名单' : '中奖名单'}</div>
                <div className="sh-sub">本次共 {formatNumber(raffle.winners.length)} 人{isRedPacket ? '抢到红包' : '中奖'}</div>
              </div>
            </div>
            <div className="winners-list">
              {raffle.winners.map((winner, index) => {
                const rankClass = index === 0 ? 'rank-1' : index === 1 ? 'rank-2' : index === 2 ? 'rank-3' : 'rank-n';
                const mine = winner.userId === user?.id;
                return (
                  <div key={winner.entryId} className={`winner-item ${rankClass} ${mine ? 'mine' : ''}`}>
                    <div className="winner-rank">{index + 1}</div>
                    <div className="winner-info">
                      <div className="winner-name">
                        {winner.username}
                        {mine && <span className="mine-pill">我</span>}
                      </div>
                      <div className="winner-prize">{isRedPacket ? '随机红包' : winner.prizeName}</div>
                    </div>
                    <div className="winner-money">{formatRafflePoints(getRafflePrizePoints(winner))}</div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 参与者网格 */}
        <section className="item-card participants-card t-purple">
          <div className="section-head">
            <div className="sh-icon">
              <Users />
            </div>
            <div className="sh-text">
              <div className="sh-title">{isRedPacket ? '已抢用户' : '参与者'}</div>
              <div className="sh-sub">共 {formatNumber(raffle.participantsCount)} 人已{isRedPacket ? '抢到' : '参与'}（最多展示最近 50 位）</div>
            </div>
          </div>

          {entries.length === 0 ? (
            <div className="empty-participants">
              <Users />
              <p>{isRedPacket ? '暂无用户抢到红包，成为第一位吧～' : '暂无参与者，成为第一位参与的小伙伴吧～'}</p>
            </div>
          ) : (
            <div className="participants-grid">
              {entries.map((entry) => {
                const mine = entry.userId === user?.id;
                return (
                  <div key={entry.id} className={`participant-item ${mine ? 'mine' : ''}`}>
                    <div className="participant-name">
                      {entry.username}
                      {mine && <BadgeCheck size={12} />}
                    </div>
                    <div className="participant-no">#{entry.entryNumber}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <style jsx global>{LWF_PROJECT_STYLES}</style>
    </div>
  );
}

// ============================================================================
// 样式（前缀化 .lwf-project，避免与 .lucky-store 冲突）
// ============================================================================
const LWF_PROJECT_STYLES = `
  .lwf-project {
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
    --c-pink: #ec4899;
    --c-amber: #fbbf24;

    --grad-primary: linear-gradient(135deg, #ff7a00, #ff004c);
    --grad-gold: linear-gradient(135deg, #fde047, #f59e0b 50%, #ea580c);
    --grad-orange: linear-gradient(135deg, #fb923c, #f97316);
    --grad-pink: linear-gradient(135deg, #fb7185, #ec4899);
    --grad-blue: linear-gradient(135deg, #60a5fa, #3b82f6);
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
  .lwf-project * { box-sizing: border-box; }
  .lwf-project a { color: inherit; text-decoration: none; }
  .lwf-project button { font-family: inherit; }

  .lwf-project .mesh-bg {
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

  /* 加载/错误页 */
  .lwf-project.lwf-project-loading,
  .lwf-project.lwf-project-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 24px;
    min-height: 100vh;
  }
  .lwf-project .lwf-spin {
    width: 36px;
    height: 36px;
    color: var(--c-orange);
    animation: lwfSpin 1s linear infinite;
  }
  @keyframes lwfSpin {
    from { transform: rotate(0); }
    to { transform: rotate(360deg); }
  }
  .lwf-project.lwf-project-loading p {
    font-size: 14px;
    color: var(--text-light);
    font-weight: 600;
  }
  .lwf-project .error-card {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.6));
    backdrop-filter: blur(30px);
    border: 1px solid rgba(255, 255, 255, 0.9);
    border-radius: 28px;
    padding: 36px 32px;
    box-shadow: var(--card-shadow);
    max-width: 420px;
    width: 100%;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }
  .lwf-project .error-icon {
    width: 64px; height: 64px;
    border-radius: 20px;
    background: rgba(244, 63, 94, 0.12);
    color: var(--c-red);
    display: flex; align-items: center; justify-content: center;
  }
  .lwf-project .error-icon svg { width: 32px; height: 32px; }
  .lwf-project .error-card h2 { font-size: 20px; font-weight: 800; margin: 0; color: var(--text-main); }
  .lwf-project .error-card p { font-size: 13.5px; color: var(--text-light); margin: 0; line-height: 1.6; }

  /* topbar */
  .lwf-project .topbar {
    position: relative;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: 18px 48px;
    padding-top: max(18px, env(safe-area-inset-top));
    background:
      linear-gradient(135deg, rgba(255, 237, 213, 0.82), rgba(255, 247, 237, 0.72));
    border-bottom: 1px solid rgba(251, 146, 60, 0.22);
    backdrop-filter: blur(22px) saturate(1.45);
    -webkit-backdrop-filter: blur(22px) saturate(1.45);
  }
  .lwf-project .detail-exit-btn {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    border-radius: 999px;
    border: 1px solid rgba(251, 146, 60, 0.36);
    background: rgba(255, 247, 237, 0.78);
    padding: 8px 18px 8px 8px;
    color: #c2410c;
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 1.5px;
    box-shadow: 0 10px 24px rgba(249, 115, 22, 0.12);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    text-decoration: none;
    transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
  }
  .lwf-project .detail-exit-btn:hover {
    transform: translateY(-1px);
    background: rgba(255, 237, 213, 0.92);
    box-shadow: 0 14px 28px rgba(249, 115, 22, 0.16);
  }
  .lwf-project .detail-exit-btn .arrow {
    display: inline-flex;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: #fff;
    background: var(--grad-orange);
    box-shadow: 0 8px 14px rgba(249, 115, 22, 0.3);
  }
  /* container：与福利商店统一 1280px，承载更丰富的内容 */
  .lwf-project .container {
    max-width: 1280px;
    margin: 0 auto;
    padding: 22px 48px 64px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  /* 消息 */
  .lwf-project .store-message {
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
  .lwf-project .store-message.error { background: rgba(244, 63, 94, 0.08); border-color: rgba(244, 63, 94, 0.25); color: var(--c-red); }
  .lwf-project .store-message svg { width: 18px; height: 18px; flex-shrink: 0; }
  .lwf-project .store-message-close {
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
  .lwf-project .store-message-close:hover { opacity: 1; }
  .lwf-project .store-message-close svg { width: 14px; height: 14px; }

  /* 详情主卡 */
  .lwf-project .item-card {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.6));
    backdrop-filter: blur(30px);
    -webkit-backdrop-filter: blur(30px);
    border: 1px solid rgba(255, 255, 255, 0.9);
    border-radius: 28px;
    padding: 32px;
    box-shadow: var(--card-shadow), inset 0 1px 0 rgba(255, 255, 255, 1);
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .lwf-project .item-card::before {
    content: '';
    position: absolute;
    top: -40%;
    right: -25%;
    width: 360px;
    height: 360px;
    border-radius: 50%;
    opacity: 0.35;
    filter: blur(60px);
    pointer-events: none;
  }
  .lwf-project .item-card.t-orange::before { background: rgba(249, 115, 22, 0.5); }
  .lwf-project .item-card.t-pink::before { background: rgba(236, 72, 153, 0.45); }
  .lwf-project .item-card.t-purple::before { background: rgba(139, 92, 246, 0.45); }

  .lwf-project .corner-tag {
    position: absolute;
    top: 18px;
    right: 18px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 12px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.3px;
    z-index: 2;
    color: #fff;
  }
  .lwf-project .corner-tag.hot { background: var(--grad-primary); box-shadow: 0 6px 12px rgba(255, 122, 0, 0.35); }
  .lwf-project .corner-tag.claimed { background: var(--grad-green); box-shadow: 0 6px 12px rgba(16, 185, 129, 0.35); }
  .lwf-project .corner-tag.soldout { background: linear-gradient(135deg, #94a3b8, #64748b); box-shadow: 0 6px 12px rgba(100, 116, 139, 0.35); }

  /* head */
  .lwf-project .ic-head { display: flex; align-items: flex-start; gap: 16px; position: relative; z-index: 1; }
  .lwf-project .ic-icon {
    width: 64px;
    height: 64px;
    border-radius: 20px;
    display: flex; align-items: center; justify-content: center;
    background: #fff;
    position: relative;
    flex-shrink: 0;
    color: #fff;
  }
  .lwf-project .ic-icon svg { width: 30px; height: 30px; }
  .lwf-project .ic-icon::after {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 24px;
    opacity: 0.35;
    filter: blur(10px);
    z-index: -1;
  }
  .lwf-project .item-card.t-orange .ic-icon { background: var(--grad-orange); box-shadow: 0 12px 24px rgba(249, 115, 22, 0.35); }
  .lwf-project .item-card.t-orange .ic-icon::after { background: var(--c-orange); }
  .lwf-project .item-card.t-pink .ic-icon { background: var(--grad-pink); box-shadow: 0 12px 24px rgba(236, 72, 153, 0.35); }
  .lwf-project .item-card.t-pink .ic-icon::after { background: var(--c-pink); }

  .lwf-project .ic-title-area { flex: 1; min-width: 0; padding-top: 4px; display: flex; flex-direction: column; gap: 10px; }
  .lwf-project .ic-title {
    font-size: 26px;
    font-weight: 900;
    color: var(--text-main);
    letter-spacing: -0.6px;
    line-height: 1.25;
  }
  .lwf-project .ic-tags { display: flex; gap: 7px; flex-wrap: wrap; }
  .lwf-project .ic-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 800;
    padding: 4px 10px;
    border-radius: 6px;
    letter-spacing: 0.3px;
  }
  .lwf-project .ic-tag.cat-welfare { background: rgba(249, 115, 22, 0.12); color: var(--c-orange); }
  .lwf-project .ic-tag.cat-card { background: rgba(59, 130, 246, 0.12); color: var(--c-blue); }
  .lwf-project .ic-tag.cat-topup { background: rgba(16, 185, 129, 0.12); color: var(--c-green); }
  .lwf-project .ic-tag.limit { background: rgba(15, 23, 42, 0.05); color: var(--text-light); }
  .lwf-project .ic-status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.3px;
  }
  .lwf-project .ic-status .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    position: relative;
  }
  .lwf-project .ic-status.active { background: rgba(16, 185, 129, 0.12); color: var(--c-green); }
  .lwf-project .ic-status.active .dot { background: var(--c-green); }
  .lwf-project .ic-status.active .dot::after {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    background: var(--c-green);
    opacity: 0.5;
    animation: lwfPulseDot 2s ease-in-out infinite;
  }
  .lwf-project .ic-status.paused { background: rgba(251, 191, 36, 0.15); color: #d97706; }
  .lwf-project .ic-status.paused .dot { background: #d97706; }
  .lwf-project .ic-status.ended { background: rgba(15, 23, 42, 0.06); color: var(--text-light); }
  .lwf-project .ic-status.ended .dot { background: var(--text-light); }
  @keyframes lwfPulseDot {
    0%, 100% { transform: scale(1); opacity: 0.5; }
    50% { transform: scale(1.6); opacity: 0; }
  }

  /* desc */
  .lwf-project .ic-desc {
    font-size: 14.5px;
    color: var(--text-light);
    font-weight: 500;
    line-height: 1.7;
    position: relative;
    z-index: 1;
    background: rgba(15, 23, 42, 0.03);
    border: 1px solid rgba(15, 23, 42, 0.06);
    border-radius: 18px;
    padding: 18px 22px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* progress */
  .lwf-project .ic-progress-section { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 8px; }
  .lwf-project .ic-progress-text {
    display: flex;
    justify-content: space-between;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--text-light);
  }
  .lwf-project .ic-progress-text .num { font-weight: 900; font-size: 13.5px; color: var(--text-main); }
  .lwf-project .item-card.t-orange .ic-progress-text .num.received { color: var(--c-orange); }
  .lwf-project .item-card.t-pink .ic-progress-text .num.received { color: var(--c-pink); }
  .lwf-project .ic-progress-track {
    height: 9px;
    background: rgba(15, 23, 42, 0.06);
    border-radius: 999px;
    overflow: hidden;
    position: relative;
  }
  .lwf-project .ic-progress-bar {
    height: 100%;
    border-radius: 999px;
    position: relative;
    transition: width 1s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .lwf-project .ic-progress-bar::after {
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
  .lwf-project .item-card.t-orange .ic-progress-bar { background: var(--grad-orange); box-shadow: 0 0 10px rgba(249, 115, 22, 0.4); }
  .lwf-project .item-card.t-pink .ic-progress-bar { background: var(--grad-pink); box-shadow: 0 0 10px rgba(236, 72, 153, 0.4); }

  /* 操作面板 */
  .lwf-project .action-panel {
    position: relative;
    z-index: 1;
    background: rgba(255, 255, 255, 0.65);
    border: 1px dashed rgba(15, 23, 42, 0.1);
    border-radius: 22px;
    padding: 28px 24px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
  }

  /* action button */
  .lwf-project .ic-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
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
  .lwf-project .ic-action-btn.primary { background: var(--grad-primary); box-shadow: 0 10px 20px rgba(255, 122, 0, 0.35); }
  .lwf-project .ic-action-btn.pink { background: var(--grad-pink); box-shadow: 0 10px 20px rgba(236, 72, 153, 0.35); }
  .lwf-project .ic-action-btn.big {
    padding: 16px 36px;
    font-size: 15px;
    min-width: 220px;
    justify-content: center;
  }
  .lwf-project .ic-action-btn::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
    transform: translateX(-100%);
    transition: transform 0.6s;
  }
  .lwf-project .ic-action-btn:hover:not(:disabled):not(.disabled) { transform: translateY(-2px) scale(1.03); }
  .lwf-project .ic-action-btn:hover:not(:disabled):not(.disabled)::before { transform: translateX(100%); }
  .lwf-project .ic-action-btn.disabled,
  .lwf-project .ic-action-btn:disabled {
    background: rgba(15, 23, 42, 0.06) !important;
    color: var(--text-light) !important;
    box-shadow: none !important;
    cursor: not-allowed;
  }
  .lwf-project .ic-action-btn.disabled::before,
  .lwf-project .ic-action-btn:disabled::before { display: none; }
  .lwf-project .ic-action-spin { animation: lwfSpin 0.8s linear infinite; }

  /* 已领取 */
  .lwf-project .claimed-block,
  .lwf-project .login-block,
  .lwf-project .claim-block,
  .lwf-project .disabled-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: 100%;
  }
  .lwf-project .claimed-icon {
    width: 64px; height: 64px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    color: #fff;
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08);
  }
  .lwf-project .claimed-icon svg { width: 30px; height: 30px; }
  .lwf-project .claimed-icon.success { background: var(--grad-green); }
  .lwf-project .claimed-icon.pending { background: linear-gradient(135deg, #94a3b8, #64748b); }
  .lwf-project .claimed-icon.uncertain { background: var(--grad-amber); color: #92400e; }
  .lwf-project .claimed-title {
    font-size: 22px;
    font-weight: 900;
    margin: 0;
    color: var(--text-main);
    letter-spacing: -0.5px;
  }
  .lwf-project .claimed-sub {
    font-size: 13.5px;
    color: var(--text-light);
    margin: 0;
    line-height: 1.6;
    max-width: 480px;
  }
  .lwf-project .claimed-meta {
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-light);
    font-weight: 600;
  }

  /* 兑换码盒 */
  .lwf-project .code-box {
    position: relative;
    width: 100%;
    max-width: 480px;
    background: #fff;
    border: 2px solid rgba(249, 115, 22, 0.4);
    border-radius: 18px;
    padding: 18px 64px 18px 22px;
    box-shadow: 0 12px 24px rgba(249, 115, 22, 0.12);
  }
  .lwf-project .code-text {
    font-family: 'Outfit', 'Courier New', monospace;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 1.5px;
    color: var(--text-main);
    word-break: break-all;
    text-align: center;
  }
  .lwf-project .code-copy-btn {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: 44px; height: 44px;
    border-radius: 14px;
    border: none;
    background: rgba(15, 23, 42, 0.06);
    color: var(--text-light);
    cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
    transition: all 0.2s;
  }
  .lwf-project .code-copy-btn svg { width: 18px; height: 18px; }
  .lwf-project .code-copy-btn:hover { background: rgba(249, 115, 22, 0.15); color: var(--c-orange); transform: translateY(-50%) scale(1.05); }
  .lwf-project .code-copy-btn.is-copied { background: rgba(16, 185, 129, 0.15); color: var(--c-green); }

  /* 直充卡 */
  .lwf-project .direct-card {
    width: 100%;
    max-width: 480px;
    background: #fff;
    border: 2px solid rgba(236, 72, 153, 0.3);
    border-radius: 18px;
    padding: 22px 24px;
    box-shadow: 0 12px 24px rgba(236, 72, 153, 0.12);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .lwf-project .direct-card-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .lwf-project .direct-label {
    font-size: 11.5px;
    color: var(--text-light);
    font-weight: 800;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .lwf-project .direct-value {
    font-size: 28px;
    font-weight: 900;
    color: var(--text-main);
    letter-spacing: -0.6px;
    background: var(--grad-pink);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .lwf-project .direct-card-foot { display: flex; justify-content: center; }
  .lwf-project .direct-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 14px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 800;
    letter-spacing: 0.3px;
  }
  .lwf-project .direct-status.success { background: rgba(16, 185, 129, 0.12); color: var(--c-green); }
  .lwf-project .direct-status.pending { background: rgba(15, 23, 42, 0.06); color: var(--text-light); }
  .lwf-project .direct-status.uncertain { background: rgba(251, 191, 36, 0.18); color: #b45309; }

  /* 未登录块 */
  .lwf-project .login-icon,
  .lwf-project .disabled-icon {
    width: 64px; height: 64px;
    border-radius: 50%;
    background: rgba(15, 23, 42, 0.05);
    color: var(--text-light);
    display: flex; align-items: center; justify-content: center;
  }
  .lwf-project .login-icon { background: rgba(249, 115, 22, 0.12); color: var(--c-orange); }
  .lwf-project .login-icon svg,
  .lwf-project .disabled-icon svg { width: 28px; height: 28px; }
  .lwf-project .login-title {
    font-size: 20px;
    font-weight: 900;
    margin: 0;
    color: var(--text-main);
  }
  .lwf-project .login-sub,
  .lwf-project .claim-tip,
  .lwf-project .disabled-sub {
    font-size: 13.5px;
    color: var(--text-light);
    margin: 0;
    line-height: 1.6;
  }

  /* ========================================================================== */
  /* 章节标题：与福利商店 .lucky-store .page-header 一致                          */
  /* ========================================================================== */
  .lwf-project .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 16px;
    flex-wrap: wrap;
  }
  .lwf-project .header-left .section-title {
    font-size: 32px;
    font-weight: 800;
    display: flex;
    align-items: center;
    gap: 14px;
    color: var(--text-main);
    margin: 0 0 6px;
    letter-spacing: -0.8px;
  }
  .lwf-project .section-title .title-icon {
    width: 44px;
    height: 44px;
    border-radius: 14px;
    background: var(--grad-orange);
    display: flex; align-items: center; justify-content: center;
    color: #fff;
    box-shadow: 0 12px 24px rgba(249, 115, 22, 0.32);
    position: relative;
  }
  .lwf-project .section-title .title-icon svg { width: 22px; height: 22px; }
  .lwf-project .section-title .title-icon::after {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 18px;
    background: var(--grad-orange);
    opacity: 0.3;
    filter: blur(10px);
    z-index: -1;
  }
  .lwf-project .header-subtitle {
    font-size: 14px;
    color: var(--text-light);
    line-height: 1.6;
    max-width: 640px;
    margin: 0;
  }
  .lwf-project .header-actions { display: flex; gap: 10px; align-items: center; }
  .lwf-project .header-actions .btn-icon {
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
  .lwf-project .header-actions .btn-icon svg { width: 16px; height: 16px; }
  .lwf-project .header-actions .btn-icon:hover:not(:disabled) { background: #fff; color: var(--text-main); }
  .lwf-project .header-actions .btn-icon:disabled { opacity: 0.5; cursor: not-allowed; }
  .lwf-project .header-actions .btn-icon.spinning svg { animation: lwfRotate 0.6s ease; }
  @keyframes lwfRotate {
    from { transform: rotate(0); }
    to { transform: rotate(360deg); }
  }

  /* ========================================================================== */
  /* 数据概览卡：与福利商店 .lucky-store .stats-grid 一致                          */
  /* ========================================================================== */
  .lwf-project .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 18px;
  }
  .lwf-project .stat-card {
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
  .lwf-project .stat-card::before {
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
  .lwf-project .stat-card.t-amber::before { background: rgba(251, 191, 36, 0.5); }
  .lwf-project .stat-card.t-orange::before { background: rgba(249, 115, 22, 0.4); }
  .lwf-project .stat-card.t-green::before { background: rgba(16, 185, 129, 0.4); }
  .lwf-project .stat-card.t-purple::before { background: rgba(139, 92, 246, 0.4); }
  .lwf-project .stat-card:hover { transform: translateY(-3px); box-shadow: 0 24px 48px rgba(15, 23, 42, 0.08); }
  .lwf-project .stat-card:hover::before { opacity: 0.5; }
  .lwf-project .stat-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; position: relative; z-index: 1; }
  .lwf-project .stat-icon {
    width: 36px;
    height: 36px;
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    background: #fff;
    position: relative;
    flex-shrink: 0;
  }
  .lwf-project .stat-icon svg { width: 18px; height: 18px; }
  .lwf-project .stat-icon::after {
    content: '';
    position: absolute;
    inset: -3px;
    border-radius: 14px;
    opacity: 0.25;
    filter: blur(8px);
    z-index: -1;
  }
  .lwf-project .stat-card.t-amber .stat-icon { color: #d97706; box-shadow: 0 8px 16px rgba(251, 191, 36, 0.3); }
  .lwf-project .stat-card.t-amber .stat-icon::after { background: var(--c-amber); }
  .lwf-project .stat-card.t-orange .stat-icon { color: var(--c-orange); box-shadow: 0 8px 16px rgba(249, 115, 22, 0.25); }
  .lwf-project .stat-card.t-orange .stat-icon::after { background: var(--c-orange); }
  .lwf-project .stat-card.t-green .stat-icon { color: var(--c-green); box-shadow: 0 8px 16px rgba(16, 185, 129, 0.25); }
  .lwf-project .stat-card.t-green .stat-icon::after { background: var(--c-green); }
  .lwf-project .stat-card.t-purple .stat-icon { color: var(--c-purple); box-shadow: 0 8px 16px rgba(139, 92, 246, 0.25); }
  .lwf-project .stat-card.t-purple .stat-icon::after { background: var(--c-purple); }
  .lwf-project .stat-label { font-size: 12px; font-weight: 700; color: var(--text-light); letter-spacing: 0.3px; }
  .lwf-project .stat-value-row { display: flex; align-items: baseline; gap: 6px; position: relative; z-index: 1; }
  .lwf-project .stat-value {
    font-size: 32px;
    font-weight: 900;
    color: var(--text-main);
    letter-spacing: -1px;
    line-height: 1;
  }
  .lwf-project .stat-card.t-amber .stat-value { background: var(--grad-gold); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .lwf-project .stat-card.t-orange .stat-value { background: var(--grad-orange); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .lwf-project .stat-card.t-green .stat-value { background: var(--grad-green); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .lwf-project .stat-card.t-purple .stat-value { background: var(--grad-purple); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
  .lwf-project .stat-unit { font-size: 13px; color: var(--text-light); font-weight: 700; }

  /* 响应式 */
  @media (max-width: 1280px) {
    .lwf-project .topbar { padding: 14px 32px; }
    .lwf-project .container { padding: 22px 32px 48px; }
    .lwf-project .stats-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 992px) {
    .lwf-project .topbar { padding: 12px 24px; }
    .lwf-project .container { padding: 20px 24px 48px; gap: 18px; padding-bottom: max(48px, calc(24px + env(safe-area-inset-bottom))); }
    .lwf-project .item-card { padding: 26px 22px; border-radius: 24px; }
    .lwf-project .ic-title { font-size: 22px; }
    .lwf-project .header-left .section-title { font-size: 26px; }
    .lwf-project .section-title .title-icon { width: 38px; height: 38px; }
    .lwf-project .stats-grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 640px) {
    .lwf-project .topbar { padding: 10px 16px; gap: 12px; }
    .lwf-project .detail-exit-btn { padding: 7px 14px 7px 7px; font-size: 12px; }
    .lwf-project .detail-exit-btn .arrow { width: 26px; height: 26px; }
    .lwf-project .container { padding: 16px 16px 40px; gap: 16px; }
    .lwf-project .item-card { padding: 22px 18px; border-radius: 22px; gap: 18px; }
    .lwf-project .ic-icon { width: 54px; height: 54px; border-radius: 16px; }
    .lwf-project .ic-icon svg { width: 24px; height: 24px; }
    .lwf-project .ic-title { font-size: 19px; }
    .lwf-project .ic-desc { font-size: 13px; padding: 14px 16px; }
    .lwf-project .action-panel { padding: 22px 18px; }
    .lwf-project .ic-action-btn.big { padding: 14px 28px; min-width: 0; width: 100%; font-size: 14px; }
    .lwf-project .code-text { font-size: 18px; letter-spacing: 1px; }
    .lwf-project .code-box { padding: 16px 56px 16px 18px; }
    .lwf-project .direct-value { font-size: 24px; }
    .lwf-project .corner-tag { top: 14px; right: 14px; padding: 4px 10px; font-size: 10.5px; }
    .lwf-project .header-left .section-title { font-size: 22px; gap: 10px; }
    .lwf-project .section-title .title-icon { width: 36px; height: 36px; border-radius: 12px; }
    .lwf-project .header-subtitle { font-size: 13px; }
    .lwf-project .header-actions { width: auto; }
    .lwf-project .stats-grid { grid-template-columns: 1fr 1fr; gap: 12px; }
    .lwf-project .stat-card { padding: 18px; border-radius: 20px; }
    .lwf-project .stat-value { font-size: 24px; }
  }

  /* === 多人抽奖专属：从 .lwf-raffle 合并而来 === */
  .lwf-project .item-card.t-amber::before { background: rgba(251, 191, 36, 0.45); }
  .lwf-project .item-card.t-pink .ic-icon { background: var(--grad-pink); box-shadow: 0 12px 24px rgba(236, 72, 153, 0.35); color: #fff; }
  .lwf-project .item-card.t-pink .ic-icon::after { background: var(--c-pink); }
  .lwf-project .ic-tag.cat-makeup { background: rgba(236, 72, 153, 0.12); color: var(--c-pink); }
  .lwf-project .ic-status.ended { background: rgba(15, 23, 42, 0.06); color: var(--text-light); }
  .lwf-project .ic-status.ended .dot { background: var(--text-light); }

  .lwf-project .corner-tag.soldout {
    background: linear-gradient(135deg, #94a3b8, #64748b);
    box-shadow: 0 6px 12px rgba(100, 116, 139, 0.35);
  }

  .lwf-project .progress-tip {
    margin: 4px 0 0;
    font-size: 12.5px;
    color: var(--text-light);
    font-weight: 600;
  }
  .lwf-project .progress-tip strong { color: var(--c-pink); font-weight: 900; }
  .lwf-project .ended-panel { background: rgba(15, 23, 42, 0.03); }

  .lwf-project .entry-number {
    background: var(--grad-pink);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    font-weight: 900;
    font-size: 18px;
    margin-left: 4px;
    letter-spacing: 0.5px;
  }

  /* 中奖横幅 */
  .lwf-project .winner-banner { padding: 24px 28px; }
  .lwf-project .winner-row {
    display: flex;
    align-items: center;
    gap: 18px;
    position: relative;
    z-index: 1;
  }
  .lwf-project .winner-icon {
    width: 64px; height: 64px;
    border-radius: 20px;
    background: var(--grad-pink);
    color: #fff;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 12px 24px rgba(236, 72, 153, 0.35);
  }
  .lwf-project .winner-icon svg { width: 30px; height: 30px; }
  .lwf-project .winner-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .lwf-project .winner-eyebrow {
    font-size: 11.5px;
    font-weight: 800;
    color: var(--c-pink);
    letter-spacing: 0.6px;
    text-transform: uppercase;
  }
  .lwf-project .winner-title {
    font-size: 19px;
    font-weight: 800;
    color: var(--text-main);
    letter-spacing: -0.3px;
    margin: 0;
  }
  .lwf-project .winner-amount {
    font-size: 28px;
    font-weight: 900;
    background: var(--grad-pink);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: -0.6px;
  }
  .lwf-project .winner-status-wrap { flex-shrink: 0; }

  /* section head 通用 */
  .lwf-project .section-head { display: flex; align-items: center; gap: 14px; position: relative; z-index: 1; }
  .lwf-project .sh-icon {
    width: 44px; height: 44px;
    border-radius: 14px;
    display: flex; align-items: center; justify-content: center;
    color: #fff;
    flex-shrink: 0;
  }
  .lwf-project .sh-icon svg { width: 22px; height: 22px; }
  .lwf-project .item-card.t-orange .sh-icon { background: var(--grad-orange); box-shadow: 0 10px 20px rgba(249, 115, 22, 0.3); }
  .lwf-project .item-card.t-amber .sh-icon { background: var(--grad-amber); color: #92400e; box-shadow: 0 10px 20px rgba(251, 191, 36, 0.35); }
  .lwf-project .item-card.t-purple .sh-icon { background: var(--grad-purple); box-shadow: 0 10px 20px rgba(139, 92, 246, 0.3); }
  .lwf-project .sh-text { display: flex; flex-direction: column; gap: 2px; }
  .lwf-project .sh-title { font-size: 18px; font-weight: 800; color: var(--text-main); letter-spacing: -0.3px; }
  .lwf-project .sh-sub { font-size: 12.5px; color: var(--text-light); font-weight: 600; }
  .lwf-project .sh-sub strong { color: var(--c-orange); font-weight: 900; }

  /* 奖品池 */
  .lwf-project .prize-list { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 10px; }
  .lwf-project .prize-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
    border-radius: 16px;
    border: 1px solid rgba(15, 23, 42, 0.06);
    background: #fff;
    transition: all 0.2s;
  }
  .lwf-project .prize-row.rank-1 { background: linear-gradient(135deg, rgba(253, 224, 71, 0.18), rgba(251, 191, 36, 0.12)); border-color: rgba(251, 191, 36, 0.3); }
  .lwf-project .prize-row.rank-2 { background: linear-gradient(135deg, rgba(226, 232, 240, 0.5), rgba(203, 213, 225, 0.3)); border-color: rgba(148, 163, 184, 0.3); }
  .lwf-project .prize-row.rank-3 { background: linear-gradient(135deg, rgba(254, 215, 170, 0.4), rgba(251, 146, 60, 0.18)); border-color: rgba(251, 146, 60, 0.3); }
  .lwf-project .prize-rank {
    width: 40px; height: 40px;
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    color: #fff;
    flex-shrink: 0;
  }
  .lwf-project .prize-rank svg { width: 20px; height: 20px; }
  .lwf-project .prize-row.rank-1 .prize-rank { background: var(--grad-amber); color: #92400e; box-shadow: 0 6px 12px rgba(251, 191, 36, 0.35); }
  .lwf-project .prize-row.rank-2 .prize-rank { background: linear-gradient(135deg, #cbd5e1, #94a3b8); box-shadow: 0 6px 12px rgba(148, 163, 184, 0.35); }
  .lwf-project .prize-row.rank-3 .prize-rank { background: var(--grad-orange); box-shadow: 0 6px 12px rgba(249, 115, 22, 0.35); }
  .lwf-project .prize-row.rank-n .prize-rank { background: rgba(15, 23, 42, 0.06); color: var(--text-light); font-weight: 800; font-size: 14px; }
  .lwf-project .prize-meta { flex: 1; min-width: 0; }
  .lwf-project .prize-name {
    font-size: 14.5px;
    font-weight: 800;
    color: var(--text-main);
    margin-bottom: 2px;
  }
  .lwf-project .prize-quantity {
    font-size: 12px;
    color: var(--text-light);
    font-weight: 600;
  }
  .lwf-project .prize-amount {
    font-size: 22px;
    font-weight: 900;
    background: var(--grad-orange);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: -0.4px;
    flex-shrink: 0;
  }

  /* 中奖名单 */
  .lwf-project .winners-list { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 8px; }
  .lwf-project .winner-item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 18px;
    border-radius: 14px;
    background: #fff;
    border: 1px solid rgba(15, 23, 42, 0.06);
  }
  .lwf-project .winner-item.mine { background: linear-gradient(135deg, rgba(236, 72, 153, 0.08), rgba(139, 92, 246, 0.06)); border-color: rgba(236, 72, 153, 0.3); }
  .lwf-project .winner-rank {
    width: 32px; height: 32px;
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(15, 23, 42, 0.06);
    color: var(--text-light);
    font-weight: 800;
    font-size: 13px;
    flex-shrink: 0;
  }
  .lwf-project .winner-item.rank-1 .winner-rank { background: var(--grad-amber); color: #92400e; }
  .lwf-project .winner-item.rank-2 .winner-rank { background: linear-gradient(135deg, #cbd5e1, #94a3b8); color: #fff; }
  .lwf-project .winner-item.rank-3 .winner-rank { background: var(--grad-orange); color: #fff; }
  .lwf-project .winner-info { flex: 1; min-width: 0; }
  .lwf-project .winner-name {
    font-size: 14px;
    font-weight: 800;
    color: var(--text-main);
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
  }
  .lwf-project .winner-prize { font-size: 11.5px; color: var(--text-light); font-weight: 600; }
  .lwf-project .mine-pill {
    background: var(--grad-pink);
    color: #fff;
    font-size: 10px;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 999px;
    letter-spacing: 0.3px;
  }
  .lwf-project .winner-money {
    font-size: 18px;
    font-weight: 900;
    color: var(--c-pink);
    flex-shrink: 0;
  }

  /* 参与者网格 */
  .lwf-project .participants-grid {
    position: relative; z-index: 1;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  .lwf-project .participant-item {
    padding: 12px 14px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(15, 23, 42, 0.06);
    text-align: center;
  }
  .lwf-project .participant-item.mine { background: linear-gradient(135deg, rgba(236, 72, 153, 0.1), rgba(139, 92, 246, 0.06)); border-color: rgba(236, 72, 153, 0.3); }
  .lwf-project .participant-name {
    font-size: 13px;
    font-weight: 800;
    color: var(--text-main);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    justify-content: center;
    width: 100%;
  }
  .lwf-project .participant-item.mine .participant-name { color: var(--c-pink); }
  .lwf-project .participant-name svg { color: var(--c-pink); flex-shrink: 0; }
  .lwf-project .participant-no {
    font-size: 11.5px;
    color: var(--text-light);
    font-weight: 700;
    margin-top: 2px;
  }
  .lwf-project .empty-participants {
    text-align: center;
    padding: 28px 16px;
    color: var(--text-light);
    position: relative;
    z-index: 1;
  }
  .lwf-project .empty-participants svg { width: 36px; height: 36px; opacity: 0.4; margin-bottom: 8px; }
  .lwf-project .empty-participants p { font-size: 13px; font-weight: 600; margin: 0; }

  /* 多人抽奖响应式补充 */
  @media (max-width: 1280px) {
    .lwf-project .participants-grid { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 992px) {
    .lwf-project .winner-row { flex-wrap: wrap; }
    .lwf-project .winner-status-wrap { width: 100%; display: flex; justify-content: flex-start; }
    .lwf-project .participants-grid { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 640px) {
    .lwf-project .winner-icon { width: 52px; height: 52px; border-radius: 16px; }
    .lwf-project .winner-icon svg { width: 24px; height: 24px; }
    .lwf-project .winner-amount { font-size: 22px; }
    .lwf-project .winner-title { font-size: 16px; }
    .lwf-project .prize-row { padding: 12px 14px; }
    .lwf-project .prize-amount { font-size: 18px; }
    .lwf-project .participants-grid { grid-template-columns: repeat(2, 1fr); gap: 8px; }
  }
`;
