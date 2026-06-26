'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  Activity,
  Award,
  BadgeCheck,
  Bell,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Coins,
  Gift,
  Gamepad2,
  History,
  IdCard,
  ListChecks,
  Loader2,
  Mail,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Trophy,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import type { AchievementId, AchievementUnlockMode } from '@/lib/profile-achievements';

type UserStatusFilter = 'all' | 'new' | 'claimed';

interface UserWithStats {
  id: number;
  username: string;
  firstSeen: number;
  claimsCount: number;
  lotteryCount: number;
  isNewUser: boolean;
  pointsBalance: number;
  todayGamesPlayed: number;
  todayPointsEarned: number;
  latestPointChange: number | null;
  latestPointChangeAt: number | null;
  lastClaimAt: number | null;
  lastLotteryAt: number | null;
  lastActivityAt: number;
}

interface UsersStatsSummary {
  total: number;
  newUserCount: number;
  claimedUserCount: number;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

interface ClaimRecord {
  id: string;
  projectId: string;
  projectName: string;
  userId: number;
  username: string;
  code: string;
  claimedAt: number;
  directCredit?: boolean;
  creditedPoints?: number;
  creditedDollars?: number;
  creditStatus?: 'pending' | 'success' | 'uncertain';
}

interface LotteryRecord {
  id: string;
  oderId: string;
  username: string;
  tierName: string;
  tierValue: number;
  code: string;
  directCredit?: boolean;
  creditedQuota?: number;
  pointsAwarded?: number;
  createdAt: number;
}

interface ExchangeLog {
  id: string;
  userId: number;
  itemId: string;
  itemName: string;
  pointsCost: number;
  value: number;
  type: string;
  createdAt: number;
}

interface PointsLog {
  id: string;
  amount: number;
  source: string;
  description: string;
  balance: number;
  createdAt: number;
}

interface AdminAchievementItem {
  id: AchievementId;
  emoji: string;
  name: string;
  desc: string;
  unlockMode: AchievementUnlockMode;
  unlocked: boolean;
  series?: string;
  grantedAt?: number | null;
  expiresAt?: number | null;
  equipped?: boolean;
}

interface ProfileOverview {
  user: {
    id: number;
    username: string;
    customDisplayName: string | null;
    customAvatarUrl: string | null;
    customQqEmail: string | null;
  };
  points: {
    balance: number;
    recentLogs: Array<{
      amount: number;
      source: string;
      description: string;
      createdAt: number;
    }>;
  };
  cards: {
    owned: number;
    total: number;
    fragments: number;
    drawsAvailable: number;
    completionRate: number;
  };
  gameplay: {
    checkinStreak: number;
    totalCheckinDays: number;
    recentRecords: Array<{
      gameType: string;
      score: number;
      pointsEarned: number;
      createdAt: number;
    }>;
  };
  notifications: {
    unreadCount: number;
    recent: Array<{
      id: string;
      title: string;
      content: string;
      type: string;
      createdAt: number;
      isRead: boolean;
    }>;
  };
}

interface UserDetail {
  user: {
    id: number;
    username: string;
    firstSeen: number;
    displayName: string | null;
    avatarUrl: string | null;
    qqEmail: string | null;
    isNewUser: boolean;
    newUserStatus: 'eligible' | 'pending' | 'claimed';
    newUserProjectId: string | null;
    newUserClaimedAt: number | null;
  };
  overview: ProfileOverview;
  claims: ClaimRecord[];
  lotteryRecords: LotteryRecord[];
  exchangeLogs: ExchangeLog[];
  achievements: AdminAchievementItem[];
}

interface PointsState {
  balance: number;
  logs: PointsLog[];
  pagination: Pagination;
}

interface TimelineItem {
  id: string;
  type: 'points' | 'claim' | 'lottery' | 'exchange' | 'notice' | 'game';
  title: string;
  description: string;
  value: string;
  time: number;
}

const EMPTY_PAGINATION: Pagination = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 1,
  hasMore: false,
};

const SOURCE_LABELS: Record<string, string> = {
  game_play: '游戏游玩',
  game_win: '游戏胜利',
  daily_login: '每日登录',
  checkin_bonus: '签到奖励',
  exchange: '商店兑换',
  exchange_refund: '兑换回滚',
  exchange_withdraw: '额度提现',
  exchange_topup: '额度兑换',
  admin_adjust: '管理员调整',
  card_collection: '卡牌奖励',
  ranking_reward: '排行榜奖励',
  reward_claim: '奖励领取',
  lottery_win: '幸运抽奖',
  raffle_win: '多人抽奖',
  number_bomb_bet: '数字炸弹下注',
  number_bomb_refund: '数字炸弹退还',
  number_bomb_reward: '数字炸弹奖励',
};

const GAME_LABELS: Record<string, string> = {
  linkgame: '连连看',
  match3: '三消',
  memory: '记忆翻牌',
  whack_mole: '打地鼠',
  roguelite: '肉鸽挑战',
  minesweeper: '扫雷',
  game_2048: '2048',
  lottery: '幸运抽奖',
};

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return value.toLocaleString('zh-CN');
}

function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '--';
  return new Date(timestamp).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFullDateTime(timestamp: number | null | undefined): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '--';
  return new Date(timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function formatRelative(timestamp: number | null | undefined): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '暂无动态';
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDateTime(timestamp);
}

function getSourceLabel(source: string): string {
  return SOURCE_LABELS[source] || source;
}

function getGameLabel(gameType: string): string {
  return GAME_LABELS[gameType] || gameType;
}

function getInitial(username: string): string {
  return username.trim().slice(0, 1).toUpperCase() || '#';
}

function buildUserQuery(page: number, search: string, status: UserStatusFilter): string {
  const params = new URLSearchParams({
    page: String(page),
    limit: '20',
    status,
  });
  const trimmed = search.trim();
  if (trimmed) {
    params.set('search', trimmed);
  }
  return params.toString();
}

function getEligibilityText(status: UserDetail['user']['newUserStatus'] | undefined): string {
  if (status === 'eligible') return '新人资格可用';
  if (status === 'pending') return '资格处理中';
  if (status === 'claimed') return '资格已使用';
  return '未知';
}

function getCreditStatusText(status: ClaimRecord['creditStatus'] | undefined): string {
  if (status === 'success') return '入账成功';
  if (status === 'pending') return '待确认';
  if (status === 'uncertain') return '状态不确定';
  return '普通领取';
}

function getTimelineTone(type: TimelineItem['type']): string {
  const tones: Record<TimelineItem['type'], string> = {
    points: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    claim: 'bg-blue-50 text-blue-700 border-blue-100',
    lottery: 'bg-violet-50 text-violet-700 border-violet-100',
    exchange: 'bg-amber-50 text-amber-700 border-amber-100',
    notice: 'bg-sky-50 text-sky-700 border-sky-100',
    game: 'bg-rose-50 text-rose-700 border-rose-100',
  };
  return tones[type];
}

function buildTimelineItems(
  detail: UserDetail,
  overview: ProfileOverview,
  pointsState: PointsState | null,
): TimelineItem[] {
  const items: TimelineItem[] = [];

  pointsState?.logs.forEach((log) => {
    items.push({
      id: `points-${log.id}`,
      type: 'points',
      title: getSourceLabel(log.source),
      description: log.description || `变动后余额 ${formatNumber(log.balance)}`,
      value: `${log.amount > 0 ? '+' : ''}${formatNumber(log.amount)}`,
      time: log.createdAt,
    });
  });

  detail.claims.slice(0, 12).forEach((claim) => {
    items.push({
      id: `claim-${claim.id}`,
      type: 'claim',
      title: claim.projectName,
      description: `${getCreditStatusText(claim.creditStatus)} · 项目 ${claim.projectId}`,
      value: claim.directCredit
        ? `${formatNumber(claim.creditedPoints ?? claim.creditedDollars)} 积分`
        : claim.code,
      time: claim.claimedAt,
    });
  });

  detail.lotteryRecords.slice(0, 12).forEach((record) => {
    items.push({
      id: `lottery-${record.id}`,
      type: 'lottery',
      title: record.tierName,
      description: `订单 ${record.oderId || '--'} · 奖励码 ${record.code || '--'}`,
      value: record.pointsAwarded != null
        ? `${formatNumber(record.pointsAwarded)} 积分`
        : `${formatNumber(record.tierValue)} 奖励`,
      time: record.createdAt,
    });
  });

  detail.exchangeLogs.slice(0, 12).forEach((record) => {
    items.push({
      id: `exchange-${record.id}`,
      type: 'exchange',
      title: record.itemName,
      description: `${record.type || '兑换'} · 商品 ${record.itemId}`,
      value: `-${formatNumber(record.pointsCost)}`,
      time: record.createdAt,
    });
  });

  overview.notifications.recent.slice(0, 10).forEach((notice) => {
    items.push({
      id: `notice-${notice.id}`,
      type: 'notice',
      title: notice.title,
      description: notice.content,
      value: notice.isRead ? '已读' : '未读',
      time: notice.createdAt,
    });
  });

  overview.gameplay.recentRecords.slice(0, 10).forEach((record, index) => {
    items.push({
      id: `game-${record.gameType}-${record.createdAt}-${index}`,
      type: 'game',
      title: getGameLabel(record.gameType),
      description: `得分 ${formatNumber(record.score)}`,
      value: `+${formatNumber(record.pointsEarned)}`,
      time: record.createdAt,
    });
  });

  return items
    .filter((item) => Number.isFinite(item.time) && item.time > 0)
    .sort((left, right) => right.time - left.time)
    .slice(0, 18);
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>('all');
  const [userPage, setUserPage] = useState(1);
  const [userPagination, setUserPagination] = useState<Pagination>(EMPTY_PAGINATION);
  const [usersStats, setUsersStats] = useState<UsersStatsSummary | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserWithStats | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pointsState, setPointsState] = useState<PointsState | null>(null);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [pointsPage, setPointsPage] = useState(1);
  const [pointsError, setPointsError] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [achievementUpdating, setAchievementUpdating] = useState(false);

  const detailRequestIdRef = useRef(0);
  const pointsRequestIdRef = useRef(0);

  const pagePointTotal = useMemo(
    () => users.reduce((sum, item) => sum + (Number.isFinite(item.pointsBalance) ? item.pointsBalance : 0), 0),
    [users],
  );

  const pageActiveUsers = useMemo(() => {
    const todayStart = new Date().setHours(0, 0, 0, 0);
    return users.filter((item) => item.lastActivityAt >= todayStart).length;
  }, [users]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const query = buildUserQuery(userPage, search, statusFilter);
      const res = await fetch(`/api/admin/users?${query}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || '获取用户列表失败');
      }

      const nextUsers = (data.users || []) as UserWithStats[];
      setUsers(nextUsers);
      setUserPagination(data.pagination ?? EMPTY_PAGINATION);
      setUsersStats(data.stats ?? null);

      setSelectedUser((current) => {
        if (!current) return null;
        const refreshed = nextUsers.find((item) => item.id === current.id);
        return refreshed ?? current;
      });
    } catch (error) {
      console.error('Fetch users error:', error);
      setUsers([]);
      setUserPagination(EMPTY_PAGINATION);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, userPage]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setUserPage(1);
      setSearch(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (!selectedUser) {
      setDetail(null);
      return;
    }

    const requestId = ++detailRequestIdRef.current;
    setDetailLoading(true);
    setDetail(null);
    setAdjustAmount('');
    setAdjustReason('');

    (async () => {
      try {
        const res = await fetch(`/api/admin/users/${selectedUser.id}`);
        const data = await res.json();
        if (requestId !== detailRequestIdRef.current) return;

        if (!res.ok || !data.success) {
          throw new Error(data.message || '获取用户详情失败');
        }
        setDetail(data as UserDetail & { success: true });
      } catch (error) {
        console.error('Fetch user detail error:', error);
        if (requestId === detailRequestIdRef.current) {
          setDetail(null);
        }
      } finally {
        if (requestId === detailRequestIdRef.current) {
          setDetailLoading(false);
        }
      }
    })();
  }, [selectedUser]);

  const loadPointsPage = useCallback(async (userId: number, targetPage: number) => {
    const requestId = ++pointsRequestIdRef.current;
    setPointsLoading(true);
    setPointsError(false);

    try {
      const res = await fetch(`/api/admin/points?userId=${userId}&page=${targetPage}&limit=10`);
      const data = await res.json();
      if (requestId !== pointsRequestIdRef.current) return;

      if (!res.ok || !data.success || !data.data) {
        throw new Error(data.message || '获取积分流水失败');
      }

      setPointsState({
        balance: data.data.balance ?? 0,
        logs: data.data.logs || [],
        pagination: data.data.pagination ?? EMPTY_PAGINATION,
      });
    } catch (error) {
      console.error('Fetch points error:', error);
      if (requestId === pointsRequestIdRef.current) {
        setPointsError(true);
        setPointsState(null);
      }
    } finally {
      if (requestId === pointsRequestIdRef.current) {
        setPointsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!selectedUser) {
      setPointsState(null);
      return;
    }
    void loadPointsPage(selectedUser.id, pointsPage);
  }, [loadPointsPage, pointsPage, selectedUser]);

  const handleSelectUser = (user: UserWithStats) => {
    setSelectedUser(user);
    setPointsPage(1);
  };

  const handleCloseDetail = useCallback(() => {
    setSelectedUser(null);
    setPointsPage(1);
  }, []);

  useEffect(() => {
    if (!selectedUser) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCloseDetail();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleCloseDetail, selectedUser]);

  const handleStatusChange = (nextStatus: UserStatusFilter) => {
    setStatusFilter(nextStatus);
    setUserPage(1);
  };

  const handleAdjustPoints = async () => {
    if (!selectedUser || !adjustAmount || !adjustReason.trim()) return;

    const amount = Number(adjustAmount);
    if (!Number.isSafeInteger(amount) || amount === 0) {
      window.alert('请输入非零整数积分');
      return;
    }

    setAdjusting(true);
    try {
      const res = await fetch('/api/admin/points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          amount,
          description: adjustReason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || '积分调整失败');
      }

      const newBalance = data.data?.newBalance;
      if (typeof newBalance === 'number') {
        setUsers((prev) => prev.map((item) => (
          item.id === selectedUser.id ? { ...item, pointsBalance: newBalance } : item
        )));
        setSelectedUser((current) => (
          current && current.id === selectedUser.id
            ? { ...current, pointsBalance: newBalance }
            : current
        ));
      }

      setAdjustAmount('');
      setAdjustReason('');
      setPointsPage(1);
      await loadPointsPage(selectedUser.id, 1);
      window.alert(data.message || '积分调整成功');
    } catch (error) {
      console.error('Adjust points error:', error);
      window.alert(error instanceof Error ? error.message : '积分调整失败');
    } finally {
      setAdjusting(false);
    }
  };

  const handleToggleContributorAchievement = async () => {
    if (!selectedUser || !detail || achievementUpdating) return;

    const contributor = detail.achievements.find((item) => item.id === 'contributor');
    const shouldRevoke = Boolean(contributor?.unlocked);
    if (shouldRevoke && !window.confirm('确认撤销该用户的“奉献者”成就吗？')) {
      return;
    }

    setAchievementUpdating(true);
    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}/achievements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          achievementId: 'contributor',
          action: shouldRevoke ? 'revoke' : 'grant',
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || '成就操作失败');
      }

      setDetail((current) => current ? { ...current, achievements: data.achievements || [] } : current);
      window.alert(data.message || (shouldRevoke ? '成就已撤销' : '成就已颁发'));
    } catch (error) {
      console.error('Update achievement error:', error);
      window.alert(error instanceof Error ? error.message : '成就操作失败');
    } finally {
      setAchievementUpdating(false);
    }
  };

  const selectedId = selectedUser?.id ?? null;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-blue-600">
            <ShieldCheck className="h-4 w-4" />
            后台运营
          </div>
          <h1 className="mt-2 text-2xl font-bold text-stone-900">用户管理</h1>
          <p className="mt-1 text-sm text-stone-500">
            统一查看用户状态、资产、活跃、领取记录和积分审计。
          </p>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Users className="h-5 w-5" />}
          label="全部用户"
          value={formatNumber(usersStats?.total ?? userPagination.total)}
          tone="blue"
        />
        <MetricCard
          icon={<Star className="h-5 w-5" />}
          label="新人资格"
          value={formatNumber(usersStats?.newUserCount)}
          tone="emerald"
        />
        <MetricCard
          icon={<BadgeCheck className="h-5 w-5" />}
          label="已用资格"
          value={formatNumber(usersStats?.claimedUserCount)}
          tone="amber"
        />
        <MetricCard
          icon={<Activity className="h-5 w-5" />}
          label="当前页活跃 / 积分"
          value={`${pageActiveUsers} / ${formatNumber(pagePointTotal)}`}
          tone="violet"
        />
      </section>

      <section className="flex flex-col gap-3 border-y border-stone-200 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索用户名或用户 ID"
            className="h-10 w-full rounded-lg border border-stone-200 bg-white pl-9 pr-3 text-sm text-stone-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div className="inline-flex rounded-lg border border-stone-200 bg-stone-100 p-1">
          {([
            ['all', '全部'],
            ['new', '新人'],
            ['claimed', '已用资格'],
          ] as Array<[UserStatusFilter, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => handleStatusChange(value)}
              className={`h-8 rounded-md px-3 text-sm font-semibold transition ${
                statusFilter === value
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <div className="space-y-5">
        <section className="min-w-0">
          <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
            <div className="hidden grid-cols-[minmax(220px,1.5fr)_110px_120px_130px_120px_110px_48px] gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3 text-xs font-semibold text-stone-500 lg:grid">
              <div>用户</div>
              <div>资格</div>
              <div>积分</div>
              <div>最近动态</div>
              <div>领取 / 抽奖</div>
              <div>今日游戏</div>
              <div />
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-24 text-stone-500">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                加载用户数据
              </div>
            ) : users.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <Users className="h-10 w-10 text-stone-300" />
                <p className="mt-3 text-sm font-semibold text-stone-700">暂无匹配用户</p>
                <p className="mt-1 text-xs text-stone-400">调整搜索条件后再查看。</p>
              </div>
            ) : (
              <div className="divide-y divide-stone-100">
                {users.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectUser(item)}
                    className={`grid w-full gap-3 px-4 py-4 text-left transition hover:bg-blue-50/50 lg:grid-cols-[minmax(220px,1.5fr)_110px_120px_130px_120px_110px_48px] lg:items-center ${
                      selectedId === item.id ? 'bg-blue-50' : 'bg-white'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-sm font-bold text-white">
                        {getInitial(item.username)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-stone-900">{item.username}</div>
                        <div className="mt-0.5 text-xs text-stone-400">ID {item.id}</div>
                      </div>
                    </div>

                    <div>
                      <StatusBadge isNewUser={item.isNewUser} />
                    </div>

                    <div>
                      <div className="text-sm font-bold text-stone-900">{formatNumber(item.pointsBalance)}</div>
                      <div className={`text-xs ${
                        (item.latestPointChange ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'
                      }`}>
                        {item.latestPointChange == null
                          ? '无变动'
                          : `${item.latestPointChange > 0 ? '+' : ''}${formatNumber(item.latestPointChange)}`}
                      </div>
                    </div>

                    <div>
                      <div className="text-sm font-semibold text-stone-700">{formatRelative(item.lastActivityAt)}</div>
                      <div className="text-xs text-stone-400">{formatDateTime(item.lastActivityAt)}</div>
                    </div>

                    <div className="text-sm text-stone-700">
                      <span className="font-semibold">{formatNumber(item.claimsCount)}</span>
                      <span className="mx-1 text-stone-300">/</span>
                      <span className="font-semibold">{formatNumber(item.lotteryCount)}</span>
                    </div>

                    <div>
                      <div className="text-sm font-semibold text-stone-700">{formatNumber(item.todayGamesPlayed)} 局</div>
                      <div className="text-xs text-stone-400">+{formatNumber(item.todayPointsEarned)} 积分</div>
                    </div>

                    <div className="hidden justify-end lg:flex">
                      <ChevronRight className="h-4 w-4 text-stone-300" />
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-3 border-t border-stone-200 px-4 py-3 text-sm text-stone-500 sm:flex-row sm:items-center sm:justify-between">
              <span>
                第 {userPagination.page} / {userPagination.totalPages} 页，共 {formatNumber(userPagination.total)} 位
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setUserPage((prev) => Math.max(1, prev - 1))}
                  disabled={loading || userPagination.page <= 1}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                  上一页
                </button>
                <button
                  type="button"
                  onClick={() => setUserPage((prev) => prev + 1)}
                  disabled={loading || !userPagination.hasMore}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  下一页
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </section>

        {selectedUser && (
          <UserDetailModal
            selectedUser={selectedUser}
            detail={detail}
            detailLoading={detailLoading}
            pointsState={pointsState}
            pointsLoading={pointsLoading}
            pointsError={pointsError}
            adjustAmount={adjustAmount}
            adjustReason={adjustReason}
            adjusting={adjusting}
            achievementUpdating={achievementUpdating}
            onAdjustAmountChange={setAdjustAmount}
            onAdjustReasonChange={setAdjustReason}
            onAdjustPoints={handleAdjustPoints}
            onPointsPageChange={setPointsPage}
            onToggleContributorAchievement={handleToggleContributorAchievement}
            onClose={handleCloseDetail}
          />
        )}
      </div>
    </div>
  );
}

function UserDetailModal({
  selectedUser,
  detail,
  detailLoading,
  pointsState,
  pointsLoading,
  pointsError,
  adjustAmount,
  adjustReason,
  adjusting,
  achievementUpdating,
  onAdjustAmountChange,
  onAdjustReasonChange,
  onAdjustPoints,
  onPointsPageChange,
  onToggleContributorAchievement,
  onClose,
}: {
  selectedUser: UserWithStats;
  detail: UserDetail | null;
  detailLoading: boolean;
  pointsState: PointsState | null;
  pointsLoading: boolean;
  pointsError: boolean;
  adjustAmount: string;
  adjustReason: string;
  adjusting: boolean;
  achievementUpdating: boolean;
  onAdjustAmountChange: (value: string) => void;
  onAdjustReasonChange: (value: string) => void;
  onAdjustPoints: () => void;
  onPointsPageChange: Dispatch<SetStateAction<number>>;
  onToggleContributorAchievement: () => void;
  onClose: () => void;
}) {
  const overview = detail?.overview;
  const detailUser = detail?.user;
  const unlockedAchievements = detail?.achievements.filter((item) => item.unlocked).length ?? 0;
  const contributor = detail?.achievements.find((item) => item.id === 'contributor');
  const contributorUnlocked = Boolean(contributor?.unlocked);
  const timelineItems = useMemo(
    () => detail && overview ? buildTimelineItems(detail, overview, pointsState) : [],
    [detail, overview, pointsState],
  );

  const displayName = detailUser?.displayName || selectedUser.username;
  const username = detailUser?.username ?? selectedUser.username;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-950/45 p-2 backdrop-blur-sm sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-detail-title"
        className="flex max-h-[calc(100vh-1rem)] w-full max-w-7xl flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-2xl sm:max-h-[90vh]"
      >
        <header className="border-b border-stone-200 bg-white px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-lg font-bold text-white">
                {getInitial(username)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="user-detail-title" className="truncate text-xl font-bold text-stone-900">
                    {displayName}
                  </h2>
                  <StatusBadge isNewUser={detailUser?.isNewUser ?? selectedUser.isNewUser} />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone-500">
                  <span>@{username}</span>
                  <span>ID {selectedUser.id}</span>
                  <span>首次记录 {formatFullDateTime(detailUser?.firstSeen || selectedUser.firstSeen)}</span>
                  <span>最近动态 {formatRelative(selectedUser.lastActivityAt)}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-stone-200 text-stone-500 transition hover:bg-stone-50 hover:text-stone-900"
              aria-label="关闭用户详情"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {detailLoading ? (
          <div className="flex min-h-[420px] items-center justify-center text-stone-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            加载用户画像
          </div>
        ) : !detail || !overview ? (
          <div className="p-6 text-sm text-rose-600">用户详情加载失败。</div>
        ) : (
          <div className="min-h-0 overflow-y-auto">
            <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_360px] sm:p-5">
              <main className="min-w-0 space-y-5">
                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <DetailMetric
                    icon={<Coins className="h-4 w-4" />}
                    label="积分余额"
                    value={formatNumber(pointsState?.balance ?? overview.points.balance)}
                  />
                  <DetailMetric
                    icon={<Gamepad2 className="h-4 w-4" />}
                    label="今日游戏"
                    value={`${formatNumber(selectedUser.todayGamesPlayed)} 局 / +${formatNumber(selectedUser.todayPointsEarned)}`}
                  />
                  <DetailMetric
                    icon={<Gift className="h-4 w-4" />}
                    label="领取 / 抽奖"
                    value={`${formatNumber(selectedUser.claimsCount)} / ${formatNumber(selectedUser.lotteryCount)}`}
                  />
                  <DetailMetric
                    icon={<Award className="h-4 w-4" />}
                    label="已获成就"
                    value={`${formatNumber(unlockedAchievements)} / ${formatNumber(detail.achievements.length)}`}
                  />
                  <DetailMetric
                    icon={<CalendarClock className="h-4 w-4" />}
                    label="连续 / 累计签到"
                    value={`${formatNumber(overview.gameplay.checkinStreak)} / ${formatNumber(overview.gameplay.totalCheckinDays)} 天`}
                  />
                  <DetailMetric
                    icon={<WalletCards className="h-4 w-4" />}
                    label="卡牌进度"
                    value={`${overview.cards.owned}/${overview.cards.total} · ${overview.cards.completionRate}%`}
                  />
                  <DetailMetric
                    icon={<Sparkles className="h-4 w-4" />}
                    label="碎片 / 可抽卡"
                    value={`${formatNumber(overview.cards.fragments)} / ${formatNumber(overview.cards.drawsAvailable)}`}
                  />
                  <DetailMetric
                    icon={<Bell className="h-4 w-4" />}
                    label="未读通知"
                    value={`${formatNumber(overview.notifications.unreadCount)} 条`}
                  />
                </section>

                <Section title="最近动态时间线" icon={<Activity className="h-4 w-4" />}>
                  {timelineItems.length === 0 ? (
                    <EmptyBlock text="暂无可展示的用户动态" />
                  ) : (
                    <div className="space-y-2">
                      {timelineItems.map((item) => (
                        <div
                          key={item.id}
                          className="grid gap-3 rounded-lg border border-stone-200 bg-white p-3 sm:grid-cols-[88px_1fr_auto]"
                        >
                          <div>
                            <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${getTimelineTone(item.type)}`}>
                              {item.type === 'points'
                                ? '积分'
                                : item.type === 'claim'
                                  ? '领取'
                                  : item.type === 'lottery'
                                    ? '抽奖'
                                    : item.type === 'exchange'
                                      ? '兑换'
                                      : item.type === 'notice'
                                        ? '通知'
                                        : '游戏'}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-stone-900">{item.title}</div>
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">{item.description}</div>
                            <div className="mt-1 text-xs text-stone-400">{formatFullDateTime(item.time)}</div>
                          </div>
                          <div className="min-w-[80px] text-left text-sm font-bold text-stone-800 sm:text-right">
                            {item.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>

                <div className="grid gap-5 xl:grid-cols-2">
                  <RecordPanel title={`积分流水 (${formatNumber(pointsState?.pagination.total ?? 0)})`} icon={<History className="h-4 w-4" />}>
                    {pointsLoading ? (
                      <LoadingBlock text="加载流水" />
                    ) : pointsError ? (
                      <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm text-rose-600">
                        积分流水加载失败。
                      </div>
                    ) : !pointsState || pointsState.logs.length === 0 ? (
                      <EmptyBlock text="暂无积分流水" />
                    ) : (
                      <div className="space-y-2">
                        {pointsState.logs.map((log) => (
                          <div
                            key={log.id}
                            className="grid gap-2 border-b border-stone-100 pb-3 last:border-0 last:pb-0 sm:grid-cols-[82px_1fr_auto]"
                          >
                            <span className={`text-sm font-bold ${log.amount >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {log.amount > 0 ? '+' : ''}{formatNumber(log.amount)}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-stone-800">{getSourceLabel(log.source)}</div>
                              <div className="line-clamp-2 text-xs leading-5 text-stone-500">{log.description}</div>
                            </div>
                            <div className="text-left text-xs text-stone-400 sm:text-right">
                              <div>{formatDateTime(log.createdAt)}</div>
                              <div>余额 {formatNumber(log.balance)}</div>
                            </div>
                          </div>
                        ))}
                        <div className="flex flex-col gap-2 pt-2 text-xs text-stone-500 sm:flex-row sm:items-center sm:justify-between">
                          <span>
                            第 {pointsState.pagination.page} / {pointsState.pagination.totalPages} 页，共 {formatNumber(pointsState.pagination.total)} 条
                          </span>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => onPointsPageChange((prev) => Math.max(1, prev - 1))}
                              disabled={pointsLoading || pointsState.pagination.page <= 1}
                              className="rounded-md border border-stone-200 px-2 py-1 font-semibold disabled:opacity-40"
                            >
                              上一页
                            </button>
                            <button
                              type="button"
                              onClick={() => onPointsPageChange((prev) => prev + 1)}
                              disabled={pointsLoading || !pointsState.pagination.hasMore}
                              className="rounded-md border border-stone-200 px-2 py-1 font-semibold disabled:opacity-40"
                            >
                              下一页
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </RecordPanel>

                  <RecordPanel title={`项目领取 (${detail.claims.length})`} icon={<Gift className="h-4 w-4" />}>
                    {detail.claims.length === 0 ? (
                      <EmptyBlock text="暂无领取记录" />
                    ) : (
                      <div className="space-y-3">
                        {detail.claims.slice(0, 8).map((claim) => (
                          <InfoStack
                            key={claim.id}
                            title={claim.projectName}
                            meta={`${formatFullDateTime(claim.claimedAt)} · ${getCreditStatusText(claim.creditStatus)}`}
                            rows={[
                              ['项目 ID', claim.projectId],
                              ['奖励码', claim.code || '--'],
                              ['直充', claim.directCredit ? '是' : '否'],
                              ['入账', claim.creditedPoints != null
                                ? `${formatNumber(claim.creditedPoints)} 积分`
                                : claim.creditedDollars != null
                                  ? `${formatNumber(claim.creditedDollars)} 额度`
                                  : '--'],
                            ]}
                          />
                        ))}
                      </div>
                    )}
                  </RecordPanel>

                  <RecordPanel title={`抽奖记录 (${detail.lotteryRecords.length})`} icon={<Sparkles className="h-4 w-4" />}>
                    {detail.lotteryRecords.length === 0 ? (
                      <EmptyBlock text="暂无抽奖记录" />
                    ) : (
                      <div className="space-y-3">
                        {detail.lotteryRecords.slice(0, 8).map((record) => (
                          <InfoStack
                            key={record.id}
                            title={record.tierName}
                            meta={formatFullDateTime(record.createdAt)}
                            rows={[
                              ['订单 ID', record.oderId || '--'],
                              ['奖励码', record.code || '--'],
                              ['奖品价值', `${formatNumber(record.tierValue)}`],
                              ['积分奖励', record.pointsAwarded != null ? `${formatNumber(record.pointsAwarded)} 积分` : '--'],
                            ]}
                          />
                        ))}
                      </div>
                    )}
                  </RecordPanel>

                  <RecordPanel title={`商店兑换 (${detail.exchangeLogs.length})`} icon={<ShoppingBag className="h-4 w-4" />}>
                    {detail.exchangeLogs.length === 0 ? (
                      <EmptyBlock text="暂无兑换记录" />
                    ) : (
                      <div className="space-y-3">
                        {detail.exchangeLogs.slice(0, 8).map((record) => (
                          <InfoStack
                            key={record.id}
                            title={record.itemName}
                            meta={formatFullDateTime(record.createdAt)}
                            rows={[
                              ['商品 ID', record.itemId],
                              ['类型', record.type || '--'],
                              ['消耗积分', `-${formatNumber(record.pointsCost)}`],
                              ['价值', formatNumber(record.value)],
                            ]}
                          />
                        ))}
                      </div>
                    )}
                  </RecordPanel>

                  <RecordPanel title={`最近游戏 (${overview.gameplay.recentRecords.length})`} icon={<Gamepad2 className="h-4 w-4" />}>
                    {overview.gameplay.recentRecords.length === 0 ? (
                      <EmptyBlock text="暂无游戏记录" />
                    ) : (
                      <div className="space-y-3">
                        {overview.gameplay.recentRecords.slice(0, 8).map((record, index) => (
                          <InfoStack
                            key={`${record.gameType}-${record.createdAt}-${index}`}
                            title={getGameLabel(record.gameType)}
                            meta={formatFullDateTime(record.createdAt)}
                            rows={[
                              ['得分', formatNumber(record.score)],
                              ['获得积分', `+${formatNumber(record.pointsEarned)}`],
                            ]}
                          />
                        ))}
                      </div>
                    )}
                  </RecordPanel>

                  <RecordPanel title={`最近通知 (${overview.notifications.recent.length})`} icon={<Mail className="h-4 w-4" />}>
                    {overview.notifications.recent.length === 0 ? (
                      <EmptyBlock text="暂无通知" />
                    ) : (
                      <div className="space-y-3">
                        {overview.notifications.recent.slice(0, 8).map((notice) => (
                          <InfoStack
                            key={notice.id}
                            title={notice.title}
                            meta={`${formatFullDateTime(notice.createdAt)} · ${notice.isRead ? '已读' : '未读'}`}
                            rows={[
                              ['类型', notice.type || '--'],
                              ['内容', notice.content || '--'],
                            ]}
                          />
                        ))}
                      </div>
                    )}
                  </RecordPanel>
                </div>
              </main>

              <aside className="min-w-0 space-y-4">
                <SidebarPanel title="账户画像" icon={<IdCard className="h-4 w-4" />}>
                  <InfoRow label="用户 ID" value={String(detail.user.id)} />
                  <InfoRow label="登录名" value={detail.user.username} />
                  <InfoRow label="展示名称" value={detail.user.displayName || '未设置'} />
                  <InfoRow label="QQ 邮箱" value={detail.user.qqEmail || '未设置'} />
                  <InfoRow label="头像地址" value={detail.user.avatarUrl || '未设置'} />
                  <InfoRow label="首次记录" value={formatFullDateTime(detail.user.firstSeen || selectedUser.firstSeen)} />
                  <InfoRow label="最近动态" value={formatFullDateTime(selectedUser.lastActivityAt)} />
                  <InfoRow label="最近领取" value={formatFullDateTime(selectedUser.lastClaimAt)} />
                  <InfoRow label="最近抽奖" value={formatFullDateTime(selectedUser.lastLotteryAt)} />
                  <InfoRow
                    label="最近积分变动"
                    value={selectedUser.latestPointChange == null
                      ? '无变动'
                      : `${selectedUser.latestPointChange > 0 ? '+' : ''}${formatNumber(selectedUser.latestPointChange)} · ${formatFullDateTime(selectedUser.latestPointChangeAt)}`}
                  />
                </SidebarPanel>

                <SidebarPanel title="新人资格" icon={<Star className="h-4 w-4" />}>
                  <InfoRow label="状态" value={getEligibilityText(detail.user.newUserStatus)} />
                  <InfoRow label="资格可用" value={detail.user.isNewUser ? '是' : '否'} />
                  <InfoRow label="使用项目" value={detail.user.newUserProjectId || '--'} />
                  <InfoRow label="使用时间" value={formatFullDateTime(detail.user.newUserClaimedAt)} />
                </SidebarPanel>

                <SidebarPanel title="积分管理" icon={<Coins className="h-4 w-4" />}>
                  <div className="grid gap-2">
                    <input
                      type="number"
                      step={1}
                      value={adjustAmount}
                      onChange={(event) => onAdjustAmountChange(event.target.value)}
                      placeholder="正/负整数"
                      className="h-9 rounded-lg border border-stone-200 px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                    <input
                      type="text"
                      value={adjustReason}
                      onChange={(event) => onAdjustReasonChange(event.target.value)}
                      placeholder="调整原因"
                      maxLength={100}
                      className="h-9 rounded-lg border border-stone-200 px-3 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={onAdjustPoints}
                    disabled={adjusting || !adjustAmount || !adjustReason.trim() || pointsLoading}
                    className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-stone-900 px-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {adjusting && <Loader2 className="h-4 w-4 animate-spin" />}
                    提交积分调整
                  </button>
                </SidebarPanel>

                <SidebarPanel title="奉献者成就" icon={<Sparkles className="h-4 w-4" />}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-stone-900">{contributor?.name ?? '奉献者'}</div>
                      <p className="mt-1 text-xs leading-5 text-stone-500">
                        {contributor?.desc ?? '提出足够有效反馈后，由管理员手动颁发。'}
                      </p>
                      {contributor?.grantedAt && (
                        <p className="mt-1 text-xs text-stone-400">
                          颁发时间 {formatFullDateTime(contributor.grantedAt)}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={onToggleContributorAchievement}
                      disabled={achievementUpdating}
                      className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition disabled:opacity-50 ${
                        contributorUnlocked
                          ? 'border border-rose-200 bg-white text-rose-600 hover:bg-rose-50'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {achievementUpdating && <Loader2 className="h-4 w-4 animate-spin" />}
                      {contributorUnlocked ? '撤销' : '颁发'}
                    </button>
                  </div>
                </SidebarPanel>

                <SidebarPanel title="资产与游戏" icon={<Trophy className="h-4 w-4" />}>
                  <div className="grid grid-cols-2 gap-2">
                    <MiniInfoTile label="卡牌拥有" value={`${overview.cards.owned}/${overview.cards.total}`} />
                    <MiniInfoTile label="完成度" value={`${overview.cards.completionRate}%`} />
                    <MiniInfoTile label="卡牌碎片" value={formatNumber(overview.cards.fragments)} />
                    <MiniInfoTile label="可抽卡" value={formatNumber(overview.cards.drawsAvailable)} />
                    <MiniInfoTile label="连续签到" value={`${formatNumber(overview.gameplay.checkinStreak)} 天`} />
                    <MiniInfoTile label="累计签到" value={`${formatNumber(overview.gameplay.totalCheckinDays)} 天`} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-stone-50 px-3 py-2 text-xs">
                    <span className="text-stone-400">最近游戏</span>
                    <span className="min-w-0 truncate text-right font-semibold text-stone-700">
                      {overview.gameplay.recentRecords[0]
                        ? getGameLabel(overview.gameplay.recentRecords[0].gameType)
                        : '暂无'}
                    </span>
                  </div>
                </SidebarPanel>

                <SidebarPanel title="成就清单" icon={<ListChecks className="h-4 w-4" />}>
                  <div className="max-h-[360px] overflow-y-auto rounded-lg border border-stone-200">
                    {detail.achievements.map((achievement) => (
                      <div
                        key={achievement.id}
                        className="border-b border-stone-100 bg-stone-50/60 p-3 last:border-b-0"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-stone-900">
                              {achievement.emoji} {achievement.name}
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">{achievement.desc}</p>
                          </div>
                          <span className={`shrink-0 rounded-md border px-2 py-1 text-xs font-semibold ${
                            achievement.unlocked
                              ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                              : 'border-stone-200 bg-stone-50 text-stone-400'
                          }`}>
                            {achievement.unlocked ? '已获得' : '未获得'}
                          </span>
                        </div>
                        {(achievement.grantedAt || achievement.expiresAt || achievement.equipped) && (
                          <div className="mt-2 space-y-1 text-xs text-stone-400">
                            {achievement.grantedAt && <div>获得：{formatFullDateTime(achievement.grantedAt)}</div>}
                            {achievement.expiresAt && <div>过期：{formatFullDateTime(achievement.expiresAt)}</div>}
                            {achievement.equipped && <div>当前佩戴</div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </SidebarPanel>
              </aside>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RecordPanel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-stone-900">
        <span className="text-stone-400">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function SidebarPanel({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-stone-900">
        <span className="text-stone-400">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function MiniInfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-stone-50 px-3 py-2">
      <div className="truncate text-xs font-semibold text-stone-400">{label}</div>
      <div className="mt-1 truncate text-sm font-bold text-stone-900">{value}</div>
    </div>
  );
}

function LoadingBlock({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-stone-200 bg-stone-50 py-8 text-sm text-stone-500">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      {text}
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-center text-sm text-stone-400">
      {text}
    </div>
  );
}

function InfoStack({
  title,
  meta,
  rows,
}: {
  title: string;
  meta: string;
  rows: Array<[string, string]>;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-bold text-stone-900">{title}</div>
        <div className="mt-1 text-xs text-stone-400">{meta}</div>
      </div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className="text-stone-400">{label}</div>
            <div className="mt-0.5 break-words font-semibold text-stone-700">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: 'blue' | 'emerald' | 'amber' | 'violet';
}) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    violet: 'bg-violet-50 text-violet-600 border-violet-100',
  }[tone];

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${toneClass}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-stone-400">{label}</div>
          <div className="mt-1 truncate text-xl font-bold text-stone-900">{value}</div>
        </div>
      </div>
    </div>
  );
}

function DetailMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-stone-500">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-lg font-bold text-stone-900">{value}</div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-stone-200 pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-stone-900">
        <span className="text-stone-400">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-stone-100 py-2 text-sm last:border-0">
      <span className="shrink-0 text-stone-400">{label}</span>
      <span className="min-w-0 break-all text-right font-semibold text-stone-800">{value}</span>
    </div>
  );
}

function StatusBadge({ isNewUser }: { isNewUser: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-semibold ${
      isNewUser
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-amber-200 bg-amber-50 text-amber-700'
    }`}>
      {isNewUser ? '新人资格可用' : '资格已使用'}
    </span>
  );
}
