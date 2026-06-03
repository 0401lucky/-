'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Gift,
  Loader2,
  Megaphone,
  MessageSquareText,
  PackageOpen,
  RefreshCw,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import SiteSidebar from '@/components/SiteSidebar';

interface NotificationData {
  rewardBatchId?: string;
  rewardType?: 'points' | 'quota';
  rewardAmount?: number;
  claimStatus?: 'pending' | 'claimed' | 'failed';
  game?: string;
  rewardPoints?: number;
  link?: string;
  [key: string]: unknown;
}

type NotificationType =
  | 'system'
  | 'announcement'
  | 'feedback_reply'
  | 'feedback_status'
  | 'lottery_win'
  | 'raffle_win'
  | 'wallet'
  | 'reward';

interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  content: string;
  createdAt: number;
  readAt?: number;
  isRead: boolean;
  data?: NotificationData;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

type FilterKey = 'all' | 'unread' | 'prize' | 'reply' | 'system' | 'redeem';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'unread', label: '未读' },
  { key: 'prize', label: '抽奖中奖' },
  { key: 'reply', label: '反馈回复' },
  { key: 'system', label: '系统公告' },
  { key: 'redeem', label: '福利兑换' },
];

const TYPE_LABEL: Record<NotificationType, string> = {
  system: '系统公告',
  announcement: '系统公告',
  feedback_reply: '反馈回复',
  feedback_status: '反馈状态',
  lottery_win: '抽奖中奖',
  raffle_win: '多人抽奖',
  wallet: '提现充值',
  reward: '福利兑换',
};

function getCategory(type: NotificationType): 'prize' | 'reply' | 'system' | 'redeem' {
  if (type === 'lottery_win' || type === 'raffle_win') return 'prize';
  if (type === 'feedback_reply' || type === 'feedback_status') return 'reply';
  if (type === 'reward' || type === 'wallet') return 'redeem';
  return 'system';
}

function CategoryIcon({ category }: { category: 'prize' | 'reply' | 'system' | 'redeem' }) {
  if (category === 'prize') return <Trophy />;
  if (category === 'reply') return <MessageSquareText />;
  if (category === 'redeem') return <PackageOpen />;
  return <Megaphone />;
}

function isClaimableRewardData(data: NotificationData | undefined): data is NotificationData & {
  rewardBatchId: string;
  rewardType: 'points' | 'quota';
  rewardAmount: number;
} {
  return (
    typeof data?.rewardBatchId === 'string' &&
    data.rewardBatchId.trim().length > 0 &&
    (data.rewardType === 'points' || data.rewardType === 'quota') &&
    typeof data.rewardAmount === 'number' &&
    Number.isFinite(data.rewardAmount) &&
    data.rewardAmount > 0
  );
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NotificationsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [marking, setMarking] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedItem, setSelectedItem] = useState<NotificationItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);

  const PAGE_SIZE = 5;

  const fetchNotifications = useCallback(
    async (targetPage = 1, silent = false) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const meRes = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!meRes.ok) {
          router.push('/login?redirect=/notifications');
          return;
        }
        const meData = await meRes.json();
        if (!meData.success) {
          router.push('/login?redirect=/notifications');
          return;
        }

        const res = await fetch(`/api/notifications?page=${targetPage}&limit=${PAGE_SIZE}`, {
          cache: 'no-store',
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message || '获取通知失败');
        }

        setItems(Array.isArray(data.data?.items) ? data.data.items : []);
        setUnreadCount(Number(data.data?.unreadCount) || 0);
        setPagination(data.data?.pagination ?? null);
        setPage(targetPage);
      } catch (err) {
        setError(err instanceof Error ? err.message : '获取通知失败');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router]
  );

  useEffect(() => {
    void fetchNotifications(1);
  }, [fetchNotifications]);

  const markRead = useCallback(
    async (ids: string[], markAll = false) => {
      if (marking) return;
      setMarking(true);
      setError(null);

      try {
        const res = await fetch('/api/notifications/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, markAll }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message || '标记已读失败');
        }
        await fetchNotifications(page, true);
      } catch (err) {
        setError(err instanceof Error ? err.message : '标记已读失败');
      } finally {
        setMarking(false);
      }
    },
    [marking, fetchNotifications, page]
  );

  const claimReward = async (notificationId: string) => {
    if (claimingId) return;
    setClaimingId(notificationId);
    setError(null);

    try {
      const res = await fetch('/api/notifications/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || '领取失败');
      }
      await fetchNotifications(page, true);
      if (selectedItem?.id === notificationId) {
        setSelectedItem((prev) =>
          prev
            ? {
                ...prev,
                data: { ...prev.data, claimStatus: 'claimed' as const },
                isRead: true,
              }
            : null
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '领取失败');
    } finally {
      setClaimingId(null);
    }
  };

  const triggerRefresh = () => {
    setRefreshSpin(true);
    void fetchNotifications(page, true).finally(() => {
      setTimeout(() => setRefreshSpin(false), 600);
    });
  };

  const deleteNotification = async (notificationId: string) => {
    if (deletingId) return;
    setDeletingId(notificationId);
    setError(null);

    try {
      const res = await fetch('/api/notifications/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [notificationId] }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || '删除失败');
      }
      // 删除后若当前页只剩一条，回退到上一页
      const remaining = items.length - 1;
      const targetPage = remaining === 0 && page > 1 ? page - 1 : page;
      await fetchNotifications(targetPage, true);
      if (selectedItem?.id === notificationId) {
        setSelectedItem(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  const goToPage = (next: number) => {
    if (refreshing) return;
    if (!pagination) return;
    if (next < 1 || next > pagination.totalPages) return;
    void fetchNotifications(next, true);
  };

  const visibleItems = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'unread') return items.filter((it) => !it.isRead);
    return items.filter((it) => getCategory(it.type) === filter);
  }, [items, filter]);

  const renderClaimButton = (item: NotificationItem) => {
    if (item.type !== 'reward' || !item.data) return null;
    if (item.data.game === 'number_bomb') {
      const rewardPoints = Number(item.data.rewardPoints) || 0;
      if (rewardPoints > 0) {
        return (
          <button type="button" className="nc-action-btn done" disabled>
            <CheckCircle2 />
            已到账 {rewardPoints} 积分
          </button>
        );
      }
      return null;
    }
    if (!isClaimableRewardData(item.data)) return null;

    const status = item.data.claimStatus;
    const isClaiming = claimingId === item.id;
    const rewardDesc =
      item.data.rewardType === 'points'
        ? `${item.data.rewardAmount} 积分`
        : `$${item.data.rewardAmount} 额度`;

    if (status === 'claimed') {
      return (
        <button type="button" className="nc-action-btn done" disabled>
          <CheckCircle2 />
          已领取 {rewardDesc}
        </button>
      );
    }

    if (status === 'failed') {
      return (
        <button
          type="button"
          className="nc-action-btn nc-action-warn"
          onClick={(e) => {
            e.stopPropagation();
            void claimReward(item.id);
          }}
          disabled={isClaiming}
        >
          <Gift />
          {isClaiming ? '领取中...' : `重试领取 ${rewardDesc}`}
        </button>
      );
    }

    return (
      <button
        type="button"
        className="nc-action-btn nc-action-claim"
        onClick={(e) => {
          e.stopPropagation();
          void claimReward(item.id);
        }}
        disabled={isClaiming}
      >
        <Gift />
        {isClaiming ? '领取中...' : `领取 ${rewardDesc}`}
      </button>
    );
  };

  return (
    <div className="lucky-notifications">
      <div className="mesh-bg" />

      <div className="layout">
        {/* 左栏 */}
        <SiteSidebar activeNav="notifications" />

        {/* 右栏 */}
        <main className="panel-right">
          {/* 顶部页头 */}
          <div className="page-header">
            <div className="header-left">
              <h2 className="section-title">
                <Bell />
                通知中心
                {unreadCount > 0 && <span className="unread-pill">未读 {unreadCount}</span>}
              </h2>
              <p className="header-subtitle">查看中奖结果、反馈回复和系统公告。</p>
            </div>
            <div className="header-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void markRead([], true)}
                disabled={marking || unreadCount === 0}
              >
                <CheckCircle2 />
                全部标为已读
              </button>
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

          {/* 错误提示 */}
          {error && <div className="nc-error">{error}</div>}

          {/* 筛选 */}
          <div className="nc-filters">
            {FILTERS.map((f) => {
              const count =
                f.key === 'all'
                  ? pagination?.total ?? items.length
                  : f.key === 'unread'
                    ? unreadCount
                    : items.filter((it) => getCategory(it.type) === f.key).length;
              return (
                <button
                  key={f.key}
                  type="button"
                  className={`filter-tab ${filter === f.key ? 'active' : ''}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <span className="count">{count}</span>
                </button>
              );
            })}
          </div>

          {/* 通知列表 */}
          {loading ? (
            <div className="nc-empty">
              <Loader2 className="spin" />
              <p>加载中...</p>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="nc-empty">
              <Bell className="empty-icon" />
              <p className="empty-title">暂无通知</p>
              <p className="empty-desc">有新的中奖或系统消息时会在这里显示。</p>
            </div>
          ) : (
            <div className="nc-list">
              {visibleItems.map((item) => {
                const category = getCategory(item.type);
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    className={`nc-card t-${category} ${item.isRead ? 'read' : 'unread'}`}
                    onClick={() => setSelectedItem(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedItem(item);
                      }
                    }}
                  >
                    <div className="nc-icon">
                      <CategoryIcon category={category} />
                    </div>
                    <div className="nc-body">
                      <div className="nc-tags">
                        <span className="nc-tag cat">{TYPE_LABEL[item.type]}</span>
                        {!item.isRead ? (
                          <span className="nc-tag unread-tag">未读</span>
                        ) : (
                          <span className="nc-tag">已读</span>
                        )}
                      </div>
                      <div className="nc-title">{item.title}</div>
                      <div className="nc-desc">{item.content}</div>
                      <button
                        type="button"
                        className="nc-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedItem(item);
                        }}
                      >
                        点击查看详情
                        <ArrowRight />
                      </button>
                      <div className="nc-meta">{formatTime(item.createdAt)}</div>
                    </div>
                    <div className="nc-actions">
                      {item.type === 'reward' && renderClaimButton(item)}
                      {!item.isRead ? (
                        <button
                          type="button"
                          className="nc-action-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            void markRead([item.id]);
                          }}
                          disabled={marking}
                        >
                          <Check />
                          标为已读
                        </button>
                      ) : (
                        <>
                          <button type="button" className="nc-action-btn done" disabled>
                            <Check />
                            已读
                          </button>
                          <button
                            type="button"
                            className="nc-delete"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (window.confirm('确定要删除这条通知吗？')) {
                                void deleteNotification(item.id);
                              }
                            }}
                            disabled={deletingId === item.id}
                            aria-label="删除"
                            title="删除"
                          >
                            {deletingId === item.id ? <Loader2 className="spin" /> : <Trash2 />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {pagination && pagination.totalPages > 1 && (
                <div className="nc-pagination">
                  <button
                    type="button"
                    className="page-btn"
                    onClick={() => goToPage(page - 1)}
                    disabled={page <= 1 || refreshing}
                    aria-label="上一页"
                  >
                    <ChevronLeft />
                    上一页
                  </button>
                  <span className="page-indicator">
                    第 <strong>{page}</strong> / {pagination.totalPages} 页
                    <span className="page-total">（共 {pagination.total} 条）</span>
                  </span>
                  <button
                    type="button"
                    className="page-btn"
                    onClick={() => goToPage(page + 1)}
                    disabled={!pagination.hasMore || refreshing}
                    aria-label="下一页"
                  >
                    下一页
                    <ChevronRight />
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* 详情弹窗 */}
      {selectedItem && (
        <div className="nc-modal">
          <button
            type="button"
            aria-label="关闭详情"
            className="nc-modal-backdrop"
            onClick={() => setSelectedItem(null)}
          />
          <div className="nc-modal-card">
            <div className="nc-modal-head">
              <div className="nc-tags">
                <span className={`nc-tag cat t-${getCategory(selectedItem.type)}`}>
                  {TYPE_LABEL[selectedItem.type]}
                </span>
                {!selectedItem.isRead ? (
                  <span className="nc-tag unread-tag">未读</span>
                ) : (
                  <span className="nc-tag">已读</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                className="btn-icon"
                aria-label="关闭"
              >
                <X />
              </button>
            </div>
            <h3 className="nc-modal-title">{selectedItem.title}</h3>
            <p className="nc-modal-desc">{selectedItem.content}</p>
            {selectedItem.type === 'reward' && (
              <div className="nc-modal-actions">{renderClaimButton(selectedItem)}</div>
            )}
            <div className="nc-modal-meta">发布时间：{formatTime(selectedItem.createdAt)}</div>
            <div className="nc-modal-foot">
              {!selectedItem.isRead && (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={marking}
                  onClick={async () => {
                    await markRead([selectedItem.id]);
                    setSelectedItem(null);
                  }}
                >
                  <Check />
                  标记已读
                </button>
              )}
              {selectedItem.isRead && (
                <button
                  type="button"
                  className="btn-ghost btn-danger"
                  disabled={deletingId === selectedItem.id}
                  onClick={() => {
                    if (window.confirm('确定要删除这条通知吗？')) {
                      void deleteNotification(selectedItem.id);
                    }
                  }}
                >
                  {deletingId === selectedItem.id ? <Loader2 className="spin" /> : <Trash2 />}
                  删除
                </button>
              )}
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setSelectedItem(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .lucky-notifications {
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
          --c-pink: #ec4899;
          background-color: #f8fafc;
          color: var(--text-main);
          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
          min-height: 100vh;
          position: relative;
          isolation: isolate;
          -webkit-font-smoothing: antialiased;
          -webkit-tap-highlight-color: transparent;
        }

        .lucky-notifications * {
          box-sizing: border-box;
        }

        .lucky-notifications a {
          color: inherit;
          text-decoration: none;
        }

        .lucky-notifications button {
          font-family: inherit;
        }

        .lucky-notifications .mesh-bg {
          position: fixed;
          inset: 0;
          z-index: -1;
          background-image:
            radial-gradient(circle at 15% 50%, rgba(255, 228, 230, 0.8) 0%, transparent 50%),
            radial-gradient(circle at 85% 30%, rgba(224, 231, 255, 0.8) 0%, transparent 50%),
            radial-gradient(circle at 50% 90%, rgba(254, 243, 199, 0.8) 0%, transparent 50%),
            radial-gradient(circle at 50% 10%, rgba(243, 232, 255, 0.8) 0%, transparent 50%);
          filter: blur(60px);
          animation: nc-fluid 15s infinite alternate ease-in-out;
        }

        @keyframes nc-fluid {
          0% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.05) rotate(2deg); }
          100% { transform: scale(1.1) rotate(-2deg); }
        }

        .lucky-notifications .layout {
          display: flex;
          min-height: 100vh;
          max-width: 1600px;
          margin: 0 auto;
        }

        /* 左栏 */
        .lucky-notifications .panel-left {
          width: 40%;
          padding: 4rem 5rem;
          position: sticky;
          top: 0;
          height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .lucky-notifications .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 24px;
          font-weight: 800;
          letter-spacing: -0.5px;
          color: var(--text-main);
        }

        .lucky-notifications .brand-icon {
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 10px 20px rgba(255, 122, 0, 0.3);
        }

        .lucky-notifications .brand-icon svg {
          width: 24px;
          height: 24px;
          color: #fff;
          stroke-width: 2.5;
        }

        .lucky-notifications .hero-content {
          margin-top: -5vh;
        }

        .lucky-notifications .hero-title {
          font-size: 64px;
          font-weight: 800;
          line-height: 1.1;
          letter-spacing: -2px;
          margin: 0 0 24px;
        }

        .lucky-notifications .hero-title span {
          background: linear-gradient(135deg, #ff5a00, #ff0080);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .lucky-notifications .nav-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .lucky-notifications .nav-item {
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
          position: relative;
        }

        .lucky-notifications .nav-item svg {
          width: 20px;
          height: 20px;
        }

        .lucky-notifications .nav-item:hover,
        .lucky-notifications .nav-item.active {
          background: rgba(255, 255, 255, 0.9);
          transform: translateX(8px);
          box-shadow: 0 10px 20px rgba(0, 0, 0, 0.03);
          color: var(--c-orange);
        }

        .lucky-notifications .nav-item .nav-badge {
          position: absolute;
          right: 16px;
          top: 50%;
          transform: translateY(-50%);
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 999px;
          min-width: 24px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 8px rgba(255, 122, 0, 0.3);
        }

        .lucky-notifications .user-profile {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px;
          background: #fff;
          border-radius: 999px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
          width: fit-content;
          cursor: pointer;
          transition: transform 0.2s;
        }

        .lucky-notifications .user-profile:hover {
          transform: scale(1.02);
        }

        .lucky-notifications .avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%);
        }

        .lucky-notifications .user-info h4 {
          font-size: 16px;
          font-weight: 700;
          margin: 0 0 2px;
        }

        .lucky-notifications .user-info p {
          font-size: 13px;
          color: var(--text-light);
          margin: 0;
        }

        .lucky-notifications .profile-arrow {
          width: 20px;
          height: 20px;
          color: #64748b;
          margin-left: auto;
        }

        /* 右栏 */
        .lucky-notifications .panel-right {
          width: 60%;
          padding: 4rem 5rem 4rem 0;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        /* 页头 */
        .lucky-notifications .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 16px;
          flex-wrap: wrap;
        }

        .lucky-notifications .header-left .section-title {
          font-size: 24px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 10px;
          color: var(--text-main);
          margin: 0 0 4px;
          letter-spacing: -0.5px;
        }

        .lucky-notifications .header-left .section-title svg {
          width: 28px;
          height: 28px;
          color: var(--c-orange);
          stroke-width: 2.5;
        }

        .lucky-notifications .unread-pill {
          background: linear-gradient(135deg, #ff7a00, #ff004c);
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 999px;
          margin-left: 4px;
          box-shadow: 0 4px 10px rgba(255, 122, 0, 0.3);
          line-height: 1.4;
        }

        .lucky-notifications .header-subtitle {
          font-size: 14px;
          color: var(--text-light);
          margin: 0;
        }

        .lucky-notifications .header-actions {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .lucky-notifications .btn-ghost {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 18px;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 999px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-main);
          cursor: pointer;
          backdrop-filter: blur(10px);
          transition: all 0.2s;
          min-height: 40px;
        }

        .lucky-notifications .btn-ghost svg {
          width: 16px;
          height: 16px;
        }

        .lucky-notifications .btn-ghost:hover:not(:disabled) {
          background: #fff;
          transform: translateY(-2px);
          box-shadow: 0 8px 16px rgba(0, 0, 0, 0.05);
        }

        .lucky-notifications .btn-ghost:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .lucky-notifications .btn-icon {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.9);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--text-light);
          transition: all 0.2s;
        }

        .lucky-notifications .btn-icon svg {
          width: 16px;
          height: 16px;
        }

        .lucky-notifications .btn-icon:hover:not(:disabled) {
          background: #fff;
          color: var(--text-main);
        }

        .lucky-notifications .btn-icon.spinning svg {
          animation: nc-rotate 0.6s ease;
        }

        @keyframes nc-rotate {
          from { transform: rotate(0); }
          to { transform: rotate(360deg); }
        }

        /* 错误提示 */
        .lucky-notifications .nc-error {
          padding: 12px 16px;
          border-radius: 14px;
          background: rgba(244, 63, 94, 0.08);
          border: 1px solid rgba(244, 63, 94, 0.25);
          color: var(--c-red);
          font-size: 13px;
          font-weight: 600;
        }

        /* 筛选 */
        .lucky-notifications .nc-filters {
          display: flex;
          gap: 10px;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
          padding: 4px 2px;
          margin: 0 -2px;
        }

        .lucky-notifications .nc-filters::-webkit-scrollbar { display: none; }

        .lucky-notifications .filter-tab {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          background: rgba(255, 255, 255, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.8);
          border-radius: 999px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-light);
          cursor: pointer;
          backdrop-filter: blur(10px);
          transition: all 0.2s;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .lucky-notifications .filter-tab:hover {
          background: rgba(255, 255, 255, 0.95);
          color: var(--text-main);
        }

        .lucky-notifications .filter-tab.active {
          background: var(--text-main);
          color: #fff;
          border-color: var(--text-main);
        }

        .lucky-notifications .filter-tab .count {
          font-size: 11px;
          padding: 1px 7px;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.08);
          color: var(--text-light);
          font-weight: 700;
        }

        .lucky-notifications .filter-tab.active .count {
          background: rgba(255, 255, 255, 0.2);
          color: #fff;
        }

        /* 列表 */
        .lucky-notifications .nc-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .lucky-notifications .nc-card {
          background: var(--card-bg);
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid var(--card-border);
          border-radius: var(--radius-lg);
          padding: 20px 24px;
          box-shadow: var(--card-shadow);
          transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
          display: flex;
          gap: 18px;
          overflow: hidden;
          cursor: pointer;
          text-align: left;
        }

        .lucky-notifications .nc-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 30px 50px rgba(15, 23, 42, 0.08);
        }

        .lucky-notifications .nc-card.unread {
          border-color: rgba(59, 130, 246, 0.25);
        }

        .lucky-notifications .nc-card.unread::before {
          content: '';
          position: absolute;
          left: 0;
          top: 16px;
          bottom: 16px;
          width: 3px;
          border-radius: 0 4px 4px 0;
          background: var(--accent, var(--c-blue));
        }

        .lucky-notifications .nc-card.read {
          opacity: 0.78;
        }

        .lucky-notifications .nc-card.read .nc-icon {
          opacity: 0.6;
        }

        .lucky-notifications .nc-card.t-prize { --accent: var(--c-orange); }
        .lucky-notifications .nc-card.t-reply { --accent: var(--c-blue); }
        .lucky-notifications .nc-card.t-system { --accent: var(--c-purple); }
        .lucky-notifications .nc-card.t-redeem { --accent: var(--c-pink); }

        .lucky-notifications .nc-icon {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          background: #fff;
          color: var(--accent);
          box-shadow: 0 10px 20px rgba(0, 0, 0, 0.04);
          position: relative;
        }

        .lucky-notifications .nc-icon::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: var(--accent);
          opacity: 0.08;
        }

        .lucky-notifications .nc-icon svg {
          position: relative;
          z-index: 1;
          width: 22px;
          height: 22px;
        }

        .lucky-notifications .nc-body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .lucky-notifications .nc-tags {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 2px;
          flex-wrap: wrap;
        }

        .lucky-notifications .nc-tag {
          font-size: 11px;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.06);
          color: var(--text-light);
          line-height: 1.4;
        }

        .lucky-notifications .nc-tag.cat {
          background: color-mix(in srgb, var(--accent, var(--c-orange)) 12%, transparent);
          color: var(--accent, var(--c-orange));
        }

        .lucky-notifications .nc-tag.cat.t-prize { --accent: var(--c-orange); background: color-mix(in srgb, var(--c-orange) 12%, transparent); color: var(--c-orange); }
        .lucky-notifications .nc-tag.cat.t-reply { --accent: var(--c-blue); background: color-mix(in srgb, var(--c-blue) 12%, transparent); color: var(--c-blue); }
        .lucky-notifications .nc-tag.cat.t-system { --accent: var(--c-purple); background: color-mix(in srgb, var(--c-purple) 12%, transparent); color: var(--c-purple); }
        .lucky-notifications .nc-tag.cat.t-redeem { --accent: var(--c-pink); background: color-mix(in srgb, var(--c-pink) 12%, transparent); color: var(--c-pink); }

        .lucky-notifications .nc-tag.unread-tag {
          background: rgba(59, 130, 246, 0.12);
          color: var(--c-blue);
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }

        .lucky-notifications .nc-tag.unread-tag::before {
          content: '';
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--c-blue);
          animation: nc-pulse 1.6s ease-in-out infinite;
        }

        @keyframes nc-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
        }

        .lucky-notifications .nc-title {
          font-size: 16px;
          font-weight: 800;
          color: var(--text-main);
          line-height: 1.4;
          letter-spacing: -0.2px;
        }

        .lucky-notifications .nc-card.read .nc-title {
          font-weight: 700;
        }

        .lucky-notifications .nc-desc {
          font-size: 13.5px;
          color: var(--text-light);
          line-height: 1.55;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .lucky-notifications .nc-link {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 13px;
          color: var(--c-blue);
          font-weight: 600;
          background: transparent;
          border: none;
          padding: 0;
          cursor: pointer;
          margin-top: 2px;
          width: fit-content;
          transition: gap 0.2s;
        }

        .lucky-notifications .nc-link svg {
          width: 12px;
          height: 12px;
          stroke-width: 2.5;
        }

        .lucky-notifications .nc-link:hover {
          gap: 8px;
        }

        .lucky-notifications .nc-meta {
          font-size: 12px;
          color: var(--text-light);
          margin-top: 4px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .lucky-notifications .nc-meta::before {
          content: '';
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: rgba(15, 23, 42, 0.2);
          display: inline-block;
        }

        .lucky-notifications .nc-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex-shrink: 0;
          align-items: flex-end;
        }

        .lucky-notifications .nc-action-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 6px 12px;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(59, 130, 246, 0.2);
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          color: var(--c-blue);
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }

        .lucky-notifications .nc-action-btn svg {
          width: 13px;
          height: 13px;
          stroke-width: 2.5;
        }

        .lucky-notifications .nc-action-btn:hover:not(:disabled):not(.done) {
          background: var(--c-blue);
          color: #fff;
          border-color: var(--c-blue);
        }

        .lucky-notifications .nc-action-btn.done {
          color: var(--c-green);
          border-color: rgba(16, 185, 129, 0.2);
          cursor: default;
        }

        .lucky-notifications .nc-action-btn.nc-action-claim {
          color: var(--c-green);
          border-color: rgba(16, 185, 129, 0.35);
          background: rgba(16, 185, 129, 0.08);
        }

        .lucky-notifications .nc-action-btn.nc-action-claim:hover:not(:disabled) {
          background: var(--c-green);
          color: #fff;
          border-color: var(--c-green);
        }

        .lucky-notifications .nc-action-btn.nc-action-warn {
          color: var(--c-red);
          border-color: rgba(244, 63, 94, 0.3);
          background: rgba(244, 63, 94, 0.08);
        }

        .lucky-notifications .nc-action-btn.nc-action-warn:hover:not(:disabled) {
          background: var(--c-red);
          color: #fff;
          border-color: var(--c-red);
        }

        .lucky-notifications .nc-action-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        /* 删除按钮 */
        .lucky-notifications .nc-delete {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: transparent;
          border: 1px solid transparent;
          color: rgba(15, 23, 42, 0.35);
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .lucky-notifications .nc-delete svg {
          width: 14px;
          height: 14px;
        }

        .lucky-notifications .nc-delete:hover:not(:disabled) {
          background: rgba(244, 63, 94, 0.1);
          border-color: rgba(244, 63, 94, 0.25);
          color: var(--c-red);
        }

        .lucky-notifications .nc-delete:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .lucky-notifications .nc-delete .spin {
          animation: nc-rotate 1s linear infinite;
        }

        /* 分页 */
        .lucky-notifications .nc-pagination {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-top: 12px;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.58);
          border: 1px solid rgba(255, 255, 255, 0.85);
          border-radius: 20px;
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          box-shadow: 0 14px 28px rgba(15, 23, 42, 0.04);
          flex-wrap: wrap;
        }

        .lucky-notifications .nc-pagination .page-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          min-height: 40px;
          padding: 8px 16px;
          background: rgba(255, 255, 255, 0.85);
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 999px;
          font-size: 13px;
          font-weight: 800;
          color: var(--text-main);
          cursor: pointer;
          transition: all 0.2s;
        }

        .lucky-notifications .nc-pagination .page-btn svg {
          width: 14px;
          height: 14px;
        }

        .lucky-notifications .nc-pagination .page-btn:hover:not(:disabled) {
          background: var(--text-main);
          color: #fff;
          border-color: var(--text-main);
        }

        .lucky-notifications .nc-pagination .page-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .lucky-notifications .nc-pagination .page-indicator {
          min-width: 120px;
          min-height: 46px;
          padding: 6px 14px;
          border-radius: 999px;
          background: linear-gradient(135deg, rgba(255, 122, 0, 0.12), rgba(255, 0, 76, 0.08));
          border: 1px solid rgba(249, 115, 22, 0.16);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          font-size: 12px;
          font-weight: 800;
          color: var(--text-light);
        }

        .lucky-notifications .nc-pagination .page-indicator strong {
          color: var(--c-orange);
          font-size: 18px;
          font-weight: 800;
        }

        .lucky-notifications .nc-pagination .page-total {
          color: var(--text-light);
          font-weight: 500;
          margin-left: 4px;
        }

        /* 危险按钮 */
        .lucky-notifications .btn-ghost.btn-danger {
          color: var(--c-red);
          border-color: rgba(244, 63, 94, 0.25);
        }

        .lucky-notifications .btn-ghost.btn-danger:hover:not(:disabled) {
          background: var(--c-red);
          color: #fff;
          border-color: var(--c-red);
        }

        .lucky-notifications .btn-ghost.btn-danger .spin {
          width: 16px;
          height: 16px;
          animation: nc-rotate 1s linear infinite;
        }

        /* 空状态 */
        .lucky-notifications .nc-empty {
          background: var(--card-bg);
          border: 1px solid var(--card-border);
          border-radius: var(--radius-lg);
          padding: 48px 24px;
          text-align: center;
          color: var(--text-light);
          box-shadow: var(--card-shadow);
        }

        .lucky-notifications .nc-empty .empty-icon {
          width: 32px;
          height: 32px;
          color: var(--text-light);
          opacity: 0.5;
          margin: 0 auto 12px;
        }

        .lucky-notifications .nc-empty .empty-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-main);
          margin: 0 0 4px;
        }

        .lucky-notifications .nc-empty .empty-desc {
          font-size: 13px;
          margin: 0;
        }

        .lucky-notifications .nc-empty .spin {
          width: 28px;
          height: 28px;
          color: var(--c-orange);
          margin: 0 auto 8px;
          animation: nc-rotate 1s linear infinite;
        }

        /* 详情弹窗 */
        .lucky-notifications .nc-modal {
          position: fixed;
          inset: 0;
          z-index: 60;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }

        .lucky-notifications .nc-modal-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(4px);
          border: none;
          padding: 0;
        }

        .lucky-notifications .nc-modal-card {
          position: relative;
          width: 100%;
          max-width: 560px;
          background: #fff;
          border-radius: 24px;
          padding: 24px;
          box-shadow: 0 30px 60px rgba(15, 23, 42, 0.2);
          z-index: 1;
        }

        .lucky-notifications .nc-modal-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 12px;
        }

        .lucky-notifications .nc-modal-title {
          font-size: 18px;
          font-weight: 800;
          color: var(--text-main);
          margin: 0 0 12px;
          letter-spacing: -0.3px;
        }

        .lucky-notifications .nc-modal-desc {
          font-size: 14px;
          color: var(--text-main);
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
          margin: 0 0 16px;
        }

        .lucky-notifications .nc-modal-actions {
          margin-bottom: 12px;
        }

        .lucky-notifications .nc-modal-meta {
          font-size: 12px;
          color: var(--text-light);
          margin-bottom: 16px;
        }

        .lucky-notifications .nc-modal-foot {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }

        /* 响应式 */
        @media (max-width: 1200px) {
          .lucky-notifications .hero-title { font-size: 42px; }
          .lucky-notifications .panel-left { padding: 3rem; }
          .lucky-notifications .panel-right { padding: 3rem 3rem 3rem 0; gap: 18px; }
          .lucky-notifications .nc-card { padding: 18px 20px; }
        }

        @media (max-width: 992px) {
          .lucky-notifications .layout {
            flex-direction: column;
            padding-left: env(safe-area-inset-left);
            padding-right: env(safe-area-inset-right);
          }

          .lucky-notifications .panel-left {
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
            padding-top: max(1.5rem, env(safe-area-inset-top));
          }

          .lucky-notifications .brand { font-size: 20px; }
          .lucky-notifications .brand-icon { width: 32px; height: 32px; border-radius: 10px; }
          .lucky-notifications .brand-icon svg { width: 18px; height: 18px; }

          .lucky-notifications .user-profile {
            position: absolute;
            top: max(1.5rem, env(safe-area-inset-top));
            right: 2rem;
            margin: 0;
            padding: 0;
            width: auto;
            background: transparent;
            border: none;
            box-shadow: none;
          }
          .lucky-notifications .user-profile .user-info,
          .lucky-notifications .user-profile .profile-arrow { display: none; }
          .lucky-notifications .user-profile .avatar { width: 40px; height: 40px; margin: 0; }

          .lucky-notifications .hero-content { margin-top: 1rem; width: 100%; }
          .lucky-notifications .hero-title { font-size: 36px; margin-bottom: 16px; }

          .lucky-notifications .nav-list {
            flex-direction: row;
            flex-wrap: nowrap;
            overflow-x: auto;
            width: 100%;
            gap: 12px;
            padding-bottom: 16px;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
          }
          .lucky-notifications .nav-list::-webkit-scrollbar { display: none; }
          .lucky-notifications .nav-item {
            flex: 0 0 auto;
            padding: 10px 16px;
            font-size: 14px;
            min-width: 0;
            min-height: 40px;
          }
          .lucky-notifications .nav-item:hover,
          .lucky-notifications .nav-item.active { transform: none; }
          .lucky-notifications .nav-item .nav-badge {
            position: static;
            transform: none;
            margin-left: 4px;
          }

          .lucky-notifications .panel-right {
            width: 100%;
            padding: 1rem 2rem 4rem;
            padding-bottom: max(4rem, calc(2rem + env(safe-area-inset-bottom)));
            gap: 18px;
          }
        }

        @media (max-width: 640px) {
          .lucky-notifications .panel-left { padding: 1rem 1.25rem 0; }
          .lucky-notifications .brand { font-size: 18px; gap: 10px; }
          .lucky-notifications .brand-icon { width: 30px; height: 30px; }
          .lucky-notifications .user-profile { right: 1.25rem; }
          .lucky-notifications .user-profile .avatar { width: 36px; height: 36px; }

          .lucky-notifications .hero-content { margin-top: 0.5rem; }
          .lucky-notifications .hero-title { font-size: 28px; line-height: 1.2; word-wrap: break-word; margin-bottom: 12px; }

          .lucky-notifications .nav-item { padding: 9px 14px; font-size: 13px; }
          .lucky-notifications .nav-item svg { width: 16px; height: 16px; }
          .lucky-notifications .nav-item .nav-badge {
            font-size: 10px;
            padding: 1px 6px;
            min-width: 20px;
            height: 18px;
          }

          .lucky-notifications .panel-right {
            padding: 0.875rem 1rem max(3rem, calc(2rem + env(safe-area-inset-bottom)));
            gap: 14px;
          }

          .lucky-notifications .page-header { gap: 12px; align-items: flex-start; margin-bottom: 0; }
          .lucky-notifications .header-left .section-title { font-size: 21px; gap: 8px; flex-wrap: wrap; }
          .lucky-notifications .header-left .section-title svg { width: 22px; height: 22px; }
          .lucky-notifications .header-subtitle { font-size: 13px; }
          .lucky-notifications .header-actions { width: 100%; justify-content: stretch; gap: 8px; }
          .lucky-notifications .btn-ghost {
            flex: 1;
            justify-content: center;
            padding: 9px 12px;
            font-size: 12px;
            min-height: 38px;
            border-radius: 14px;
          }
          .lucky-notifications .btn-icon { width: 36px; height: 36px; }

          .lucky-notifications .filter-tab { padding: 7px 13px; font-size: 12px; }

          .lucky-notifications .nc-card {
            padding: 16px;
            border-radius: 20px;
            gap: 12px;
            display: grid;
            grid-template-columns: 42px minmax(0, 1fr);
            align-items: flex-start;
          }

          .lucky-notifications .nc-card.unread::before {
            left: 0;
            top: 0;
            bottom: auto;
            right: 0;
            width: auto;
            height: 3px;
            border-radius: 0 0 4px 4px;
          }

          .lucky-notifications .nc-icon { width: 42px; height: 42px; border-radius: 12px; }
          .lucky-notifications .nc-icon svg { width: 20px; height: 20px; }
          .lucky-notifications .nc-body { min-width: 0; }

          .lucky-notifications .nc-tag { font-size: 10.5px; padding: 2px 8px; }
          .lucky-notifications .nc-title { font-size: 15px; }
          .lucky-notifications .nc-desc { font-size: 13px; }
          .lucky-notifications .nc-link { font-size: 12.5px; }
          .lucky-notifications .nc-meta { font-size: 11.5px; }

          .lucky-notifications .nc-actions {
            grid-column: 1 / -1;
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            padding-top: 8px;
            margin-top: 4px;
            border-top: 1px solid rgba(15, 23, 42, 0.06);
          }

          .lucky-notifications .nc-action-btn { padding: 7px 14px; font-size: 12px; }
        }

        @media (max-width: 480px) {
          .lucky-notifications .panel-left { padding: 0.875rem 1rem 0; }
          .lucky-notifications .panel-right { padding: 0.75rem 0.875rem 2.5rem; }
          .lucky-notifications .user-profile { right: 1rem; }

          .lucky-notifications .hero-title { font-size: 26px; }
          .lucky-notifications .hero-content { margin-top: 0.25rem; }

          .lucky-notifications .nc-card { padding: 14px; border-radius: 18px; }
          .lucky-notifications .nc-icon { width: 38px; height: 38px; border-radius: 11px; }
          .lucky-notifications .nc-title { font-size: 14.5px; }
          .lucky-notifications .nc-desc { font-size: 12.5px; }
          .lucky-notifications .nc-card { grid-template-columns: 38px minmax(0, 1fr); }
          .lucky-notifications .nc-pagination {
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            align-items: center;
            gap: 8px;
            padding: 10px;
            border-radius: 18px;
          }
          .lucky-notifications .nc-pagination .page-btn {
            width: 100%;
            padding: 8px 10px;
            font-size: 12px;
            min-height: 38px;
          }
          .lucky-notifications .nc-pagination .page-indicator {
            min-width: 58px;
            min-height: 58px;
            padding: 6px;
            border-radius: 18px;
            flex-direction: column;
            gap: 0;
            line-height: 1.05;
          }
          .lucky-notifications .nc-pagination .page-indicator strong {
            font-size: 20px;
            line-height: 1;
          }
          .lucky-notifications .nc-pagination .page-total {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
