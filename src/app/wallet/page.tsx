'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Crown,
  Info,
  Loader2,
  RefreshCw,
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

interface WalletVIPBenefits {
  dailyWithdrawLimit: number;
  withdrawFeePercent: number;
  dailyLotterySpins: number;
}

interface WalletVIPView {
  active: boolean;
  expiresAt?: number;
  pricePoints: number;
  durationDays: number;
  maxTotalDays: number;
  canPurchase: boolean;
  purchaseBlockedReason?: string;
  benefits: WalletVIPBenefits;
}

interface WalletDailyWithdraw {
  used: number;
  limit: number;
  remaining: number;
  resetAtMs: number;
}

interface WalletOverview {
  balance: number;
  pointsPerDollar: number;
  minWithdrawPoints: number;
  minTopupDollars: number;
  feePercent: number;
  withdrawBalanceCapDollars: number;
  dailyWithdraw: WalletDailyWithdraw;
  vip: WalletVIPView;
}

interface WalletTransaction {
  id: string;
  operation: 'withdraw' | 'topup';
  status: 'pending' | 'success' | 'failed' | 'uncertain';
  pointsDelta: number;
  dollarsDelta: number;
  feePoints?: number;
  netPoints?: number;
  message: string;
  createdAt: number;
}

interface NewApiBalance {
  balanceDollars: number;
  balanceWholeDollars: number;
}

type WalletResultKind = 'success' | 'error' | 'warning';

interface WalletResultDetail {
  label: string;
  value: string;
  tone?: 'success' | 'danger' | 'warning';
}

interface WalletResult {
  kind: WalletResultKind;
  kicker: string;
  title: string;
  detail: string;
  details: WalletResultDetail[];
}

const TRANSACTION_PAGE_SIZE = 20;

const STATUS_LABELS: Record<WalletTransaction['status'], { text: string; className: string }> = {
  success: { text: '成功', className: 'wallet-badge-success' },
  pending: { text: '处理中', className: 'wallet-badge-pending' },
  failed: { text: '失败', className: 'wallet-badge-failed' },
  uncertain: { text: '结果待确认', className: 'wallet-badge-uncertain' },
};

const OPERATION_LABELS: Record<string, string> = {
  withdraw: '积分提现',
  topup: '额度充值',
};

function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN');
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN');
}

/** 只接受有限数字，其余情况回落到 fallback（响应字段缺失时不要把展示刷成 undefined/0） */
function pickNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export default function WalletPage() {
  const [overview, setOverview] = useState<WalletOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WalletResult | null>(null);

  const [withdrawInput, setWithdrawInput] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [topupInput, setTopupInput] = useState('');
  const [topping, setTopping] = useState(false);
  const [purchasing, setPurchasing] = useState(false);

  const [newApiBalance, setNewApiBalance] = useState<NewApiBalance | null>(null);
  const [newApiLoading, setNewApiLoading] = useState(false);
  const [newApiError, setNewApiError] = useState<string | null>(null);

  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [transactionTotal, setTransactionTotal] = useState(0);
  const [transactionOffset, setTransactionOffset] = useState(0);
  const [transactionsLoading, setTransactionsLoading] = useState(false);

  // 一次「购买意图」对应一把幂等键：只有后端给出确定性响应后才作废。
  // 若每次点击都现场生成新键，键就只满足了后端的非空校验而没有幂等语义 ——
  // 请求已扣分、响应在回程丢失时，用户重试会带上新键，后端视为全新请求再扣一次。
  const purchaseKeyRef = useRef<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/wallet');
      const data = await res.json();
      if (!data.success) {
        setError(data.message ?? '读取钱包信息失败');
        return;
      }
      setOverview(data.data as WalletOverview);
      setError(null);
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTransactions = useCallback(async (offset: number) => {
    setTransactionsLoading(true);
    try {
      const res = await fetch(`/api/wallet/transactions?limit=${TRANSACTION_PAGE_SIZE}&offset=${offset}`);
      const data = await res.json();
      if (data.success) {
        setTransactions(data.data.transactions ?? []);
        setTransactionTotal(data.data.total ?? 0);
        setTransactionOffset(offset);
      }
    } catch {
      // 流水加载失败不阻塞页面其余部分，静默保留上一页数据
    } finally {
      setTransactionsLoading(false);
    }
  }, []);

  // 账户额度懒加载：走外部 new-api，失败不能拖垮首屏
  const loadNewApiBalance = useCallback(async () => {
    setNewApiLoading(true);
    setNewApiError(null);
    try {
      const res = await fetch('/api/store/topup');
      const data = await res.json();
      if (!data.success) {
        setNewApiError(data?.message ?? '读取账户额度失败');
        return;
      }
      setNewApiBalance({
        balanceDollars: pickNumber(data.data?.newApiBalanceDollars, 0),
        balanceWholeDollars: pickNumber(data.data?.newApiBalanceWholeDollars, 0),
      });
    } catch {
      setNewApiError('读取账户额度失败');
    } finally {
      setNewApiLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    void loadTransactions(0);
    void loadNewApiBalance();
  }, [loadOverview, loadTransactions, loadNewApiBalance]);

  const withdrawPoints = Number(withdrawInput);
  const withdrawPreview = useMemo(
    () => previewWithdraw(withdrawPoints, overview?.feePercent ?? 100),
    [withdrawPoints, overview?.feePercent],
  );
  const topupPreview = useMemo(() => previewTopup(Number(topupInput)), [topupInput]);

  const balance = overview?.balance ?? 0;
  // 管理员下调上限或计数 fallback 递增时 limit - used 可能为负，展示前一律夹到 0
  const dailyRemaining = Math.max(0, overview?.dailyWithdraw.remaining ?? 0);
  const dailyLimit = overview?.dailyWithdraw.limit ?? 0;

  const canAffordVIP = balance >= (overview?.vip.pricePoints ?? 0);
  // 两个原因都成立时优先显示上限原因，它更需要解释
  const vipBlockedReason = !overview
    ? null
    : !overview.vip.canPurchase
      ? (overview.vip.purchaseBlockedReason ?? '当前无法购买')
      : !canAffordVIP
        ? `积分不足，还差 ${formatNumber(overview.vip.pricePoints - overview.balance)} 积分`
        : null;

  const vipRemainingDays =
    overview?.vip.active && overview.vip.expiresAt
      ? Math.max(0, Math.ceil((overview.vip.expiresAt - Date.now()) / 86_400_000))
      : 0;

  const topupExceeded =
    Boolean(newApiBalance) && topupPreview.ok && topupPreview.spentDollars > (newApiBalance?.balanceWholeDollars ?? 0);

  // 账户额度到顶时后端一定会拒，这里提前禁用按钮并说明原因，省掉一次白跑的请求。
  // 余额是懒加载的，没拿到之前不预判：否则首屏那一小段时间会把按钮误禁。
  // 该窗口内仍由后端兜底拦截，所以不构成绕过。
  const withdrawCapDollars = overview?.withdrawBalanceCapDollars ?? 0;
  const balanceCapReached =
    withdrawCapDollars > 0 &&
    newApiBalance !== null &&
    newApiBalance.balanceWholeDollars >= withdrawCapDollars;

  const withdrawDisabled =
    withdrawing ||
    !overview ||
    !withdrawPreview.ok ||
    balance < withdrawPreview.deducted ||
    balanceCapReached ||
    dailyRemaining <= 0;

  const topupDisabled = topping || !overview || !topupPreview.ok || topupExceeded;

  const refreshAll = () => {
    void loadOverview();
    void loadTransactions(0);
  };

  const handleWithdraw = async () => {
    if (withdrawDisabled) return;
    setWithdrawing(true);
    try {
      const res = await fetch('/api/store/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: withdrawPoints }),
      });
      const data = await res.json();

      // 用响应里的用量就地更新，不重新拉整页。
      // limit 必须 > 0 才采信：「操作繁忙」一类的早退路径会带回 0/0，
      // 无条件套用会把今日次数刷成 0/0。
      const responseLimit = pickNumber(data?.data?.dailyWithdrawLimit, 0);
      if (responseLimit > 0) {
        const responseUsed = pickNumber(data?.data?.dailyWithdrawUsed, 0);
        setOverview((current) =>
          current
            ? {
                ...current,
                balance: pickNumber(data?.data?.newBalance, current.balance),
                dailyWithdraw: {
                  ...current.dailyWithdraw,
                  used: responseUsed,
                  limit: responseLimit,
                  remaining: Math.max(0, responseLimit - responseUsed),
                },
              }
            : current,
        );
      } else if (typeof data?.data?.newBalance === 'number') {
        setOverview((current) =>
          current ? { ...current, balance: pickNumber(data.data.newBalance, current.balance) } : current,
        );
      } else {
        // 500 一类的异常响应体里既没有 limit 也没有 newBalance，上面两条分支都不走，
        // 头部余额会停在扣款前的旧值 —— 而流水已经把 uncertain 那笔拉出来了，页面会自相矛盾。
        // 响应体不可用，只能重新拉一次真实状态，与下面 catch 分支的处理一致。
        void loadOverview();
      }

      if (data.success) {
        setResult({
          kind: data.uncertain ? 'warning' : 'success',
          kicker: '积分提现',
          title: data.uncertain ? '提现结果待确认' : '提现成功',
          detail: data.message ?? '',
          details: [
            { label: '提现积分', value: `${formatNumber(withdrawPreview.deducted)} 积分` },
            {
              label: '手续费',
              value: `${formatNumber(pickNumber(data?.data?.feePoints, withdrawPreview.feePoints))} 积分`,
              tone: 'danger',
            },
            {
              label: '到账额度',
              value: `$${pickNumber(data?.data?.dollars, withdrawPreview.dollars).toFixed(2)}`,
              tone: 'success',
            },
          ],
        });
        setWithdrawInput('');
        // 提现推高账户额度，而封顶闸门就是拿这个余额判的：不刷新会让按钮停在旧状态，
        // 用户越过上限后还能点，再被后端拒一次。
        void loadNewApiBalance();
      } else {
        setResult({
          kind: 'error',
          kicker: '积分提现',
          title: '提现失败',
          detail: data.message ?? '未知错误',
          details: [{ label: '申请提现', value: `${formatNumber(withdrawPreview.deducted)} 积分` }],
        });
      }
      void loadTransactions(0);
    } catch {
      setResult({
        kind: 'error',
        kicker: '积分提现',
        title: '提现失败',
        detail: '网络错误',
        details: [],
      });
      // 请求可能已在后端生效，只是响应丢在回程 —— 拉一次真实余额与流水
      void loadOverview();
      void loadTransactions(0);
      void loadNewApiBalance();
    } finally {
      setWithdrawing(false);
    }
  };

  const handleTopup = async () => {
    if (topupDisabled) return;
    setTopping(true);
    try {
      const res = await fetch('/api/store/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dollars: topupPreview.spentDollars }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({
          kind: data.uncertain ? 'warning' : 'success',
          kicker: '额度充值',
          title: data.uncertain ? '充值结果待确认' : '充值成功',
          detail: data.message ?? '',
          details: [
            { label: '消耗额度', value: `$${topupPreview.spentDollars}` },
            {
              label: '到账积分',
              value: `+${formatNumber(pickNumber(data?.data?.pointsGained, topupPreview.pointsGained))} 积分`,
              tone: 'success',
            },
          ],
        });
        setTopupInput('');
        setOverview((current) =>
          current ? { ...current, balance: pickNumber(data?.data?.newBalance, current.balance) } : current,
        );
        void loadNewApiBalance();
      } else {
        setResult({
          kind: 'error',
          kicker: '额度充值',
          title: '充值失败',
          detail: data.message ?? '未知错误',
          details: [{ label: '申请充值', value: `$${topupPreview.spentDollars}` }],
        });
      }
      void loadTransactions(0);
    } catch {
      setResult({
        kind: 'error',
        kicker: '额度充值',
        title: '充值失败',
        detail: '网络错误',
        details: [],
      });
      // 同提现：请求可能已生效，积分、流水与账户额度三处都拉一次真实状态
      void loadOverview();
      void loadTransactions(0);
      void loadNewApiBalance();
    } finally {
      setTopping(false);
    }
  };

  const handlePurchaseVIP = async () => {
    if (purchasing || !overview || Boolean(vipBlockedReason)) return;
    setPurchasing(true);
    try {
      // 上一次因网络失败而未确定结果时，这里会复用同一把键，让后端去重
      if (!purchaseKeyRef.current) {
        purchaseKeyRef.current = `vip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }
      const res = await fetch('/api/vip/purchase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 后端强制要求非空幂等键，缺失直接 400 IDEMPOTENCY_KEY_REQUIRED
          'Idempotency-Key': purchaseKeyRef.current,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      // 拿到后端自己的响应信封（success 明确为布尔）才算「结果已确定」：
      // 后端已处理完这次意图，下次点击是新意图，键可以作废。
      // 网关 502 一类的非信封响应会让 res.json() 抛错或缺 success 字段，
      // 那时请求到底有没有到后端是不可知的，键必须留着给重试去重。
      if (typeof data?.success === 'boolean') {
        purchaseKeyRef.current = null;
      }
      if (data.success) {
        // 只有成功响应才带 expiresAt / daysAdded / pointsSpent；
        // 失败响应的 data 只有 newBalance，套用它会把已开通的 VIP 显示成未开通
        setResult({
          kind: 'success',
          kicker: '站内 VIP',
          title: 'VIP 已开通',
          detail: data.message ?? '',
          details: [
            { label: '本次时长', value: `${formatNumber(pickNumber(data?.data?.daysAdded, overview.vip.durationDays))} 天` },
            {
              label: '花费积分',
              value: `${formatNumber(pickNumber(data?.data?.pointsSpent, overview.vip.pricePoints))} 积分`,
              tone: 'danger',
            },
            ...(typeof data?.data?.expiresAt === 'number' && data.data.expiresAt > 0
              ? [{ label: '到期时间', value: formatDateTime(data.data.expiresAt), tone: 'success' as const }]
              : []),
          ],
        });
        void loadOverview();
        void loadTransactions(0);
      } else {
        // 失败分支只采信 newBalance，到期时间等一律不动
        const failedBalance = data?.data?.newBalance;
        if (typeof failedBalance === 'number') {
          setOverview((current) =>
            current ? { ...current, balance: pickNumber(failedBalance, current.balance) } : current,
          );
        }
        setResult({
          kind: 'error',
          kicker: '站内 VIP',
          title: '开通失败',
          detail: data.message ?? '未知错误',
          details:
            typeof failedBalance === 'number'
              ? [{ label: '当前积分', value: `${formatNumber(failedBalance)} 积分` }]
              : [],
        });
      }
    } catch {
      // 键刻意不清空：请求到底有没有到后端不可知，重试必须复用同一把键
      setResult({
        kind: 'error',
        kicker: '站内 VIP',
        title: '开通失败',
        detail: '网络错误，请重试；若已扣分本次重试不会重复扣除',
        details: [],
      });
      // 后端可能已扣分成功，只是响应丢在回程 —— 拉一次真实状态，别停在旧值
      void loadOverview();
      void loadTransactions(0);
    } finally {
      setPurchasing(false);
    }
  };

  const transactionPage = Math.floor(transactionOffset / TRANSACTION_PAGE_SIZE) + 1;
  const transactionPageCount = Math.max(1, Math.ceil(transactionTotal / TRANSACTION_PAGE_SIZE));
  const hasPrevPage = transactionOffset > 0;
  const hasNextPage = transactionOffset + TRANSACTION_PAGE_SIZE < transactionTotal;

  return (
    <div className="lucky-wallet">
      <header className="wallet-topbar">
        <div className="wallet-brand">
          <div className="wallet-brand-icon">
            <Wallet size={20} />
          </div>
          我的钱包
        </div>
        <div className="wallet-topbar-actions">
          <Link href="/store" className="wallet-back-link">
            <ArrowLeft size={15} />
            返回商店
          </Link>
          <button
            type="button"
            className="wallet-icon-btn"
            onClick={refreshAll}
            disabled={loading || transactionsLoading}
            title="刷新钱包"
            aria-label="刷新钱包"
          >
            <RefreshCw size={16} className={loading || transactionsLoading ? 'wallet-spin' : undefined} />
          </button>
        </div>
      </header>

      <main className="wallet-container">
        {/* 结果条：操作区在页面中部，结果条置顶才不会落到视口之外 */}
        {result && (
          <div className={`wallet-result-bar is-${result.kind}`}>
            <button
              type="button"
              className="wallet-result-close"
              onClick={() => setResult(null)}
              aria-label="关闭结果提示"
            >
              <X size={16} />
            </button>

            <div className="wallet-result-body">
              <div className="wallet-result-mark" aria-hidden>
                {result.kind === 'success' ? <BadgeCheck size={34} /> : <Info size={34} />}
              </div>
              <div className="wallet-result-kicker">{result.kicker}</div>
              <h3>{result.title}</h3>
              {result.detail && <p>{result.detail}</p>}

              {result.details.length > 0 && (
                <div className="wallet-result-details">
                  {result.details.map((detail) => (
                    <div key={detail.label} className="wallet-result-detail">
                      <span>{detail.label}</span>
                      <strong className={detail.tone ? `tone-${detail.tone}` : undefined}>{detail.value}</strong>
                    </div>
                  ))}
                </div>
              )}

              <button type="button" className="wallet-result-primary" onClick={() => setResult(null)}>
                {result.kind === 'error' ? '返回修改' : '知道了'}
              </button>
            </div>
          </div>
        )}

        {error && <div className="wallet-error">{error}</div>}

        {/* 双余额卡片 */}
        <section className="wallet-top-grid">
          <div className="wallet-summary">
            <div>
              <div className="wallet-summary-label">积分余额</div>
              <div className="wallet-summary-value">
                {!overview ? '···' : formatNumber(balance)}
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

          <div className={`wallet-balance-card ${newApiError ? 'is-error' : ''}`}>
            <div>
              <div className="wallet-balance-label">账户额度（new-api）</div>
              <div className="wallet-balance-value">
                {newApiLoading ? (
                  <>
                    <Loader2 size={14} className="wallet-spin" />
                    读取中
                  </>
                ) : newApiError ? (
                  newApiError
                ) : newApiBalance ? (
                  <>
                    ${newApiBalance.balanceDollars.toFixed(2)}
                    <span>可充值 ${newApiBalance.balanceWholeDollars}</span>
                  </>
                ) : (
                  '暂未读取'
                )}
              </div>
            </div>
            {newApiError ? (
              <button
                type="button"
                className="wallet-max-btn"
                onClick={loadNewApiBalance}
                disabled={newApiLoading}
              >
                重试
              </button>
            ) : (
              <button
                type="button"
                className="wallet-refresh-btn"
                onClick={loadNewApiBalance}
                disabled={newApiLoading}
                title="刷新账户额度"
                aria-label="刷新账户额度"
              >
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        </section>

        {/* VIP 状态条 */}
        {overview && (
          <section className={`wallet-vip-bar ${overview.vip.active ? 'is-active' : ''}`}>
            <div className="wallet-vip-main">
              <div className="wallet-vip-head">
                <div className="wallet-vip-icon">
                  <Crown size={18} />
                </div>
                <div>
                  <div className="wallet-vip-title">
                    站内 VIP
                    <span className="wallet-vip-state">{overview.vip.active ? '已开通' : '未开通'}</span>
                  </div>
                  <div className="wallet-vip-sub">
                    {overview.vip.active && overview.vip.expiresAt
                      ? `到期时间 ${formatDateTime(overview.vip.expiresAt)} · 剩余 ${vipRemainingDays} 天`
                      : `${formatNumber(overview.vip.pricePoints)} 积分可开通 ${overview.vip.durationDays} 天`}
                  </div>
                </div>
              </div>

              {overview.vip.active ? (
                <p className="wallet-vip-note">
                  续费时长累加，最多可囤 {overview.vip.maxTotalDays} 天。
                </p>
              ) : (
                <div className="wallet-vip-benefits">
                  <div className="wallet-vip-benefit">
                    <span>每日提现次数</span>
                    <strong>{overview.vip.benefits.dailyWithdrawLimit} 次</strong>
                  </div>
                  <div className="wallet-vip-benefit">
                    <span>提现手续费</span>
                    <strong>阶梯费率的 {overview.vip.benefits.withdrawFeePercent}%</strong>
                  </div>
                  <div className="wallet-vip-benefit">
                    <span>每日免费抽奖</span>
                    <strong>{overview.vip.benefits.dailyLotterySpins} 次</strong>
                  </div>
                </div>
              )}
            </div>

            <div className="wallet-vip-cta">
              <button
                type="button"
                className="wallet-submit-btn is-vip"
                onClick={handlePurchaseVIP}
                disabled={purchasing || Boolean(vipBlockedReason)}
              >
                {purchasing ? <Loader2 size={14} className="wallet-spin" /> : <Crown size={14} />}
                {overview.vip.active
                  ? `续费 ${overview.vip.durationDays} 天`
                  : `${formatNumber(overview.vip.pricePoints)} 积分开通 ${overview.vip.durationDays} 天`}
              </button>
              {vipBlockedReason && <div className="wallet-vip-blocked">{vipBlockedReason}</div>}
            </div>
          </section>
        )}

        {/* 操作区 */}
        <section className="wallet-actions-grid">
          {/* 积分提现 */}
          <div className="wallet-panel">
            <div className="wallet-panel-head">
              <ArrowUpRight size={16} />
              积分提现
            </div>

            <div className="wallet-meta-row">
              <span className="wallet-meta-chip">
                {/* overview 未读到时不写 0/0，否则和「确实已用完」在视觉上无从区分 */}
                {overview ? `今日剩余 ${dailyRemaining}/${dailyLimit} 次` : '今日剩余 ···'}
              </span>
              {overview && overview.feePercent < 100 && (
                <span className="wallet-vip-flag">VIP {overview.feePercent}% 手续费</span>
              )}
            </div>

            <label className="wallet-field-label" htmlFor="wallet-withdraw-input">
              提现积分数（最低 {MIN_WITHDRAW_POINTS}）
            </label>
            <div className="wallet-field-row">
              <input
                id="wallet-withdraw-input"
                type="number"
                min={MIN_WITHDRAW_POINTS}
                step={1}
                value={withdrawInput}
                onChange={(event) => setWithdrawInput(event.target.value.replace(/[^0-9]/g, ''))}
                className="wallet-input"
                placeholder={`${MIN_WITHDRAW_POINTS}`}
              />
              <button
                type="button"
                className="wallet-max-btn"
                onClick={() => setWithdrawInput(String(Math.max(MIN_WITHDRAW_POINTS, balance)))}
                disabled={withdrawing || balance < MIN_WITHDRAW_POINTS}
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
                    <strong className={withdrawPreview.feePoints > 0 ? 'wallet-fee' : 'wallet-fee-free'}>
                      {withdrawPreview.feePoints > 0
                        ? `-${formatNumber(withdrawPreview.feePoints)} 积分`
                        : '免手续费'}
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
                  {balance < withdrawPreview.deducted && (
                    <div className="wallet-preview-warning">
                      积分不足，当前余额 {formatNumber(balance)} 积分
                    </div>
                  )}
                </>
              ) : (
                <div className="wallet-preview-empty">{withdrawPreview.message || '请输入有效的积分数'}</div>
              )}
            </div>

            <div className="wallet-fee-table">
              <div className="wallet-fee-table-title">手续费阶梯</div>
              <div className="wallet-fee-rows">
                {WITHDRAW_FEE_TIERS.map((tier, index) => {
                  const next = WITHDRAW_FEE_TIERS[index - 1];
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

            {balanceCapReached && (
              <p className="wallet-hint">
                账户额度余额已达上限 ${formatNumber(withdrawCapDollars)}，需先消耗额度后才能继续提现。
              </p>
            )}

            {overview && dailyRemaining <= 0 && (
              <p className="wallet-hint">
                今日提现次数已用完，次数将在 {formatDateTime(overview.dailyWithdraw.resetAtMs)} 重置。
              </p>
            )}

            <button type="button" className="wallet-submit-btn" onClick={handleWithdraw} disabled={withdrawDisabled}>
              {withdrawing ? <Loader2 size={14} className="wallet-spin" /> : <ArrowUpRight size={14} />}
              确认提现
            </button>
          </div>

          {/* 额度充值 */}
          <div className="wallet-panel">
            <div className="wallet-panel-head">
              <ArrowDownLeft size={16} />
              额度充值
            </div>

            <label className="wallet-field-label" htmlFor="wallet-topup-input">
              充值金额（美元，最低 ${MIN_TOPUP_DOLLARS}）
            </label>
            <div className="wallet-field-row">
              <input
                id="wallet-topup-input"
                type="number"
                min={MIN_TOPUP_DOLLARS}
                step={1}
                value={topupInput}
                onChange={(event) => setTopupInput(event.target.value.replace(/[^0-9]/g, ''))}
                className="wallet-input"
                placeholder={`${MIN_TOPUP_DOLLARS}`}
              />
              <span className="wallet-input-suffix">$</span>
            </div>

            <div className={`wallet-balance-card ${newApiError ? 'is-error' : ''}`}>
              <div>
                <div className="wallet-balance-label">可用账户额度</div>
                <div className="wallet-balance-value">
                  {newApiLoading ? (
                    <>
                      <Loader2 size={14} className="wallet-spin" />
                      读取中
                    </>
                  ) : newApiError ? (
                    newApiError
                  ) : newApiBalance ? (
                    <>
                      ${newApiBalance.balanceDollars.toFixed(2)}
                      <span>可充值 ${newApiBalance.balanceWholeDollars}</span>
                    </>
                  ) : (
                    '暂未读取'
                  )}
                </div>
              </div>
              <button
                type="button"
                className="wallet-refresh-btn"
                onClick={loadNewApiBalance}
                disabled={newApiLoading}
                title={newApiError ? '重试读取账户额度' : '刷新账户额度'}
                aria-label={newApiError ? '重试读取账户额度' : '刷新账户额度'}
              >
                <RefreshCw size={14} />
              </button>
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
                  {newApiBalance && (
                    <div className="wallet-preview-row">
                      <span>充值后额度</span>
                      <strong>
                        ${Math.max(0, newApiBalance.balanceDollars - topupPreview.spentDollars).toFixed(2)}
                      </strong>
                    </div>
                  )}
                  {topupExceeded && (
                    <div className="wallet-preview-warning">
                      账户额度不足，当前最多可充值 ${newApiBalance?.balanceWholeDollars ?? 0}
                    </div>
                  )}
                </>
              ) : (
                <div className="wallet-preview-empty">{topupPreview.message || '请输入有效的金额'}</div>
              )}
            </div>

            <p className="wallet-hint">
              充值会从您绑定的账户额度（new-api）中扣除，按 1:{POINTS_PER_DOLLAR} 比例即时兑换为积分。
            </p>

            <button
              type="button"
              className="wallet-submit-btn is-topup"
              onClick={handleTopup}
              disabled={topupDisabled}
            >
              {topping ? <Loader2 size={14} className="wallet-spin" /> : <ArrowDownLeft size={14} />}
              确认充值
            </button>
          </div>
        </section>

        {/* 交易流水 */}
        <section className="wallet-panel wallet-tx-panel">
          <div className="wallet-panel-head">
            <Info size={16} />
            交易流水
            <span className="wallet-tx-total">共 {formatNumber(transactionTotal)} 条</span>
          </div>

          {transactions.length === 0 ? (
            <div className="wallet-tx-empty">{transactionsLoading ? '读取中…' : '暂无提现或充值记录'}</div>
          ) : (
            <div className="wallet-tx-list">
              {transactions.map((transaction) => {
                const status = STATUS_LABELS[transaction.status] ?? STATUS_LABELS.pending;
                return (
                  <div key={transaction.id} className="wallet-tx-row">
                    <div className="wallet-tx-main">
                      <div className="wallet-tx-op">
                        {OPERATION_LABELS[transaction.operation] ?? transaction.operation}
                        <span className={`wallet-badge ${status.className}`}>{status.text}</span>
                      </div>
                      <div className="wallet-tx-time">{formatDateTime(transaction.createdAt)}</div>
                      {transaction.message && <div className="wallet-tx-msg">{transaction.message}</div>}
                      {transaction.status === 'uncertain' && (
                        <div className="wallet-tx-uncertain">
                          结果待确认：请稍后核对账户额度与积分余额，不要重复提交。
                        </div>
                      )}
                    </div>
                    <div className="wallet-tx-side">
                      <div
                        className={`wallet-tx-delta ${transaction.pointsDelta >= 0 ? 'is-plus' : 'is-minus'}`}
                      >
                        {transaction.pointsDelta >= 0 ? '+' : ''}
                        {formatNumber(transaction.pointsDelta)} 积分
                      </div>
                      {transaction.dollarsDelta !== 0 && (
                        <div className="wallet-tx-dollars">
                          {transaction.dollarsDelta > 0 ? '+' : ''}
                          ${transaction.dollarsDelta.toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="wallet-pager">
            <button
              type="button"
              className="wallet-pager-btn"
              onClick={() => loadTransactions(Math.max(0, transactionOffset - TRANSACTION_PAGE_SIZE))}
              disabled={!hasPrevPage || transactionsLoading}
            >
              <ChevronLeft size={14} />
              上一页
            </button>
            <span className="wallet-pager-info">
              第 {transactionPage} / {transactionPageCount} 页
            </span>
            <button
              type="button"
              className="wallet-pager-btn"
              onClick={() => loadTransactions(transactionOffset + TRANSACTION_PAGE_SIZE)}
              disabled={!hasNextPage || transactionsLoading}
            >
              下一页
              <ChevronRight size={14} />
            </button>
          </div>
        </section>
      </main>

      <style jsx global>{`
        .lucky-wallet {
          --text-main: #0f172a;
          --text-light: #64748b;
          --card-shadow: 0 24px 48px rgba(15, 23, 42, 0.06);

          --c-green: #10b981;
          --c-orange: #f97316;
          --c-red: #f43f5e;
          --c-blue: #3b82f6;
          --c-amber: #fbbf24;

          --grad-primary: linear-gradient(135deg, #ff7a00, #ff004c);
          --grad-green: linear-gradient(135deg, #34d399, #10b981);
          --grad-amber: linear-gradient(135deg, #fde047, #fbbf24);
          --grad-gold: linear-gradient(135deg, #fde047, #f59e0b 50%, #ea580c);

          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
          background:
            radial-gradient(circle at 12% 8%, rgba(255, 237, 213, 0.85) 0%, transparent 45%),
            radial-gradient(circle at 88% 12%, rgba(255, 228, 230, 0.75) 0%, transparent 45%),
            #f8fafc;
          color: var(--text-main);
          min-height: 100vh;
          -webkit-font-smoothing: antialiased;
          -webkit-tap-highlight-color: transparent;
        }
        .lucky-wallet * { box-sizing: border-box; }
        .lucky-wallet a { color: inherit; text-decoration: none; }
        .lucky-wallet button { font-family: inherit; }

        /* === 页头 === */
        .lucky-wallet .wallet-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 16px 48px;
          padding-top: max(16px, env(safe-area-inset-top));
          background: rgba(255, 255, 255, 0.72);
          border-bottom: 1px solid rgba(255, 255, 255, 0.9);
        }
        .lucky-wallet .wallet-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: -0.5px;
        }
        .lucky-wallet .wallet-brand-icon {
          width: 36px;
          height: 36px;
          border-radius: 11px;
          background: var(--grad-primary);
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 16px rgba(255, 122, 0, 0.3);
        }
        .lucky-wallet .wallet-topbar-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .lucky-wallet .wallet-back-link {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 38px;
          padding: 0 14px;
          border-radius: 12px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.85);
          color: var(--text-light);
          font-size: 13px;
          font-weight: 800;
          transition: all 0.2s;
        }
        .lucky-wallet .wallet-back-link:hover { background: #fff; color: var(--c-orange); }
        .lucky-wallet .wallet-icon-btn {
          width: 38px;
          height: 38px;
          border-radius: 12px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.85);
          color: var(--text-light);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }
        .lucky-wallet .wallet-icon-btn:hover:not(:disabled) { background: #fff; color: var(--c-orange); }
        .lucky-wallet .wallet-icon-btn:disabled { opacity: 0.55; cursor: not-allowed; }

        .lucky-wallet .wallet-spin { animation: walletSpin 1s linear infinite; }
        @keyframes walletSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        /* === 容器与区块 === */
        .lucky-wallet .wallet-container {
          max-width: 1120px;
          margin: 0 auto;
          padding: 28px 48px 64px;
          padding-bottom: max(64px, calc(32px + env(safe-area-inset-bottom)));
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .lucky-wallet .wallet-top-grid,
        .lucky-wallet .wallet-actions-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        .lucky-wallet .wallet-top-grid .wallet-summary,
        .lucky-wallet .wallet-top-grid .wallet-balance-card { margin: 0; }

        .lucky-wallet .wallet-panel {
          background: rgba(255, 255, 255, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 24px;
          padding: 20px 22px;
          box-shadow: var(--card-shadow);
        }
        .lucky-wallet .wallet-panel-head {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 14px;
          font-size: 15px;
          font-weight: 900;
          letter-spacing: -0.2px;
          color: var(--text-main);
        }
        .lucky-wallet .wallet-panel-head > svg { color: var(--c-orange); }
        .lucky-wallet .wallet-tx-total {
          margin-left: auto;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-light);
        }

        .lucky-wallet .wallet-meta-row {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 12px;
        }
        .lucky-wallet .wallet-meta-chip {
          padding: 5px 10px;
          border-radius: 10px;
          background: rgba(59, 130, 246, 0.08);
          border: 1px solid rgba(59, 130, 246, 0.18);
          color: var(--c-blue);
          font-size: 11.5px;
          font-weight: 800;
        }
        .lucky-wallet .wallet-vip-flag {
          padding: 5px 10px;
          border-radius: 10px;
          background: var(--grad-amber);
          color: #92400e;
          font-size: 11.5px;
          font-weight: 900;
        }

        /* === 提交按钮 === */
        .lucky-wallet .wallet-submit-btn {
          width: 100%;
          margin-top: 14px;
          height: 46px;
          border: 0;
          border-radius: 14px;
          background: var(--grad-primary);
          color: #fff;
          font-size: 14px;
          font-weight: 900;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          box-shadow: 0 12px 24px rgba(255, 122, 0, 0.24);
          transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
        }
        .lucky-wallet .wallet-submit-btn:hover:not(:disabled) { transform: translateY(-1px); }
        .lucky-wallet .wallet-submit-btn:disabled { opacity: 0.55; cursor: not-allowed; box-shadow: none; }
        .lucky-wallet .wallet-submit-btn.is-topup {
          background: var(--grad-green);
          box-shadow: 0 12px 24px rgba(16, 185, 129, 0.24);
        }
        .lucky-wallet .wallet-submit-btn.is-vip {
          width: auto;
          margin: 0;
          padding: 0 22px;
          background: var(--grad-gold);
          color: #7c2d12;
          box-shadow: 0 12px 24px rgba(234, 88, 12, 0.24);
        }

        /* === VIP 状态条 === */
        .lucky-wallet .wallet-vip-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          padding: 18px 22px;
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.9);
          box-shadow: var(--card-shadow);
        }
        .lucky-wallet .wallet-vip-bar.is-active {
          background: linear-gradient(135deg, rgba(253, 224, 71, 0.22), rgba(251, 191, 36, 0.1));
          border-color: rgba(251, 191, 36, 0.35);
        }
        .lucky-wallet .wallet-vip-main { min-width: 0; }
        .lucky-wallet .wallet-vip-head {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .lucky-wallet .wallet-vip-icon {
          width: 40px;
          height: 40px;
          flex-shrink: 0;
          border-radius: 14px;
          background: var(--grad-gold);
          color: #7c2d12;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 10px 20px rgba(234, 88, 12, 0.22);
        }
        .lucky-wallet .wallet-vip-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 15px;
          font-weight: 900;
          letter-spacing: -0.2px;
        }
        .lucky-wallet .wallet-vip-state {
          padding: 2px 8px;
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.06);
          color: var(--text-light);
          font-size: 11px;
          font-weight: 800;
        }
        .lucky-wallet .wallet-vip-bar.is-active .wallet-vip-state {
          background: rgba(16, 185, 129, 0.14);
          color: var(--c-green);
        }
        .lucky-wallet .wallet-vip-sub {
          margin-top: 3px;
          font-size: 12.5px;
          font-weight: 700;
          color: var(--text-light);
        }
        .lucky-wallet .wallet-vip-note {
          margin: 12px 0 0;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-light);
        }
        .lucky-wallet .wallet-vip-benefits {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 14px;
        }
        .lucky-wallet .wallet-vip-benefit {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 8px 12px;
          border-radius: 12px;
          background: rgba(248, 250, 252, 0.92);
          border: 1px solid rgba(15, 23, 42, 0.06);
          font-size: 11px;
          font-weight: 700;
          color: var(--text-light);
        }
        .lucky-wallet .wallet-vip-benefit strong {
          font-size: 13px;
          font-weight: 900;
          color: var(--text-main);
        }
        .lucky-wallet .wallet-vip-cta {
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
        }
        .lucky-wallet .wallet-vip-blocked {
          max-width: 240px;
          text-align: right;
          font-size: 11.5px;
          font-weight: 800;
          color: var(--c-red);
          line-height: 1.5;
        }

        /* === 以下为从 /store 钱包弹窗迁移的视觉规则（已去掉弹窗定位） === */
        .lucky-wallet .wallet-summary {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 14px 16px;
          background: linear-gradient(135deg, rgba(253, 224, 71, 0.18), rgba(251, 191, 36, 0.08));
          border: 1px solid rgba(251, 191, 36, 0.3);
          border-radius: 14px;
          margin-bottom: 16px;
        }
        .lucky-wallet .wallet-summary-divider {
          width: 1px;
          height: 32px;
          background: rgba(146, 64, 14, 0.18);
        }
        .lucky-wallet .wallet-summary-label {
          font-size: 11px;
          color: #92400e;
          font-weight: 700;
          letter-spacing: 0.3px;
          text-transform: uppercase;
        }
        .lucky-wallet .wallet-summary-value {
          font-size: 20px;
          font-weight: 900;
          color: #92400e;
          margin-top: 2px;
          letter-spacing: -0.3px;
          display: inline-flex;
          align-items: baseline;
          gap: 4px;
        }
        .lucky-wallet .wallet-summary-unit {
          font-size: 11px;
          color: #b45309;
          font-weight: 700;
        }

        .lucky-wallet .wallet-field-label {
          display: block;
          font-size: 13px;
          font-weight: 700;
          color: var(--text-main);
          margin-bottom: 8px;
        }
        .lucky-wallet .wallet-field-row {
          display: flex;
          align-items: stretch;
          gap: 8px;
          margin-bottom: 14px;
        }
        .lucky-wallet .wallet-input {
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
        .lucky-wallet .wallet-input:focus { background: #fff; border-color: var(--c-orange); box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.12); }
        .lucky-wallet .wallet-input::-webkit-outer-spin-button,
        .lucky-wallet .wallet-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .lucky-wallet .wallet-input { -moz-appearance: textfield; }

        .lucky-wallet .wallet-input-suffix {
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
        .lucky-wallet .wallet-max-btn {
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
        .lucky-wallet .wallet-max-btn:hover:not(:disabled) { background: rgba(249, 115, 22, 0.15); }
        .lucky-wallet .wallet-max-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .lucky-wallet .wallet-balance-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin: 0 0 14px;
          padding: 12px 14px;
          background: rgba(16, 185, 129, 0.07);
          border: 1px solid rgba(16, 185, 129, 0.2);
          border-radius: 14px;
        }
        .lucky-wallet .wallet-balance-card.is-error {
          background: rgba(244, 63, 94, 0.07);
          border-color: rgba(244, 63, 94, 0.22);
        }
        .lucky-wallet .wallet-balance-label {
          font-size: 11px;
          color: var(--text-light);
          font-weight: 800;
          margin-bottom: 3px;
        }
        .lucky-wallet .wallet-balance-value {
          display: flex;
          align-items: baseline;
          gap: 8px;
          font-size: 17px;
          font-weight: 900;
          color: var(--c-green);
        }
        .lucky-wallet .wallet-balance-card.is-error .wallet-balance-value { color: var(--c-red); font-size: 12.5px; }
        .lucky-wallet .wallet-balance-value span {
          font-size: 11.5px;
          color: var(--text-light);
          font-weight: 800;
        }
        .lucky-wallet .wallet-refresh-btn {
          width: 32px;
          height: 32px;
          border-radius: 10px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: #fff;
          color: var(--text-light);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
          flex-shrink: 0;
        }
        .lucky-wallet .wallet-refresh-btn:hover:not(:disabled) { color: var(--text-main); transform: rotate(15deg); }
        .lucky-wallet .wallet-refresh-btn:disabled { opacity: 0.55; cursor: not-allowed; }

        .lucky-wallet .wallet-preview {
          padding: 14px 16px;
          background: #f8fafc;
          border: 1px solid rgba(15, 23, 42, 0.06);
          border-radius: 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .lucky-wallet .wallet-preview-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12.5px;
          color: var(--text-light);
          font-weight: 600;
        }
        .lucky-wallet .wallet-preview-row strong { color: var(--text-main); font-weight: 800; }
        .lucky-wallet .wallet-fee { color: var(--c-red) !important; }
        .lucky-wallet .wallet-fee-free { color: var(--c-green) !important; }
        .lucky-wallet .wallet-preview-final {
          padding-top: 10px;
          border-top: 1px dashed rgba(15, 23, 42, 0.12);
          font-size: 13px;
        }
        .lucky-wallet .wallet-final { color: var(--c-orange) !important; font-size: 18px !important; letter-spacing: -0.3px; }
        .lucky-wallet .wallet-preview-empty {
          font-size: 12.5px;
          color: var(--text-light);
          text-align: center;
          padding: 8px 0;
          font-weight: 600;
        }
        .lucky-wallet .wallet-preview-warning {
          padding-top: 10px;
          border-top: 1px dashed rgba(244, 63, 94, 0.18);
          color: var(--c-red);
          font-size: 12px;
          font-weight: 800;
        }

        .lucky-wallet .wallet-fee-table {
          margin-top: 14px;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.6);
          border: 1px solid rgba(15, 23, 42, 0.05);
          border-radius: 12px;
        }
        .lucky-wallet .wallet-fee-table-title {
          font-size: 11.5px;
          color: var(--text-light);
          font-weight: 800;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .lucky-wallet .wallet-fee-rows {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .lucky-wallet .wallet-fee-row {
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
        .lucky-wallet .wallet-fee-row strong { color: var(--text-main); font-weight: 800; }
        .lucky-wallet .wallet-fee-row.is-active {
          background: rgba(249, 115, 22, 0.1);
          color: var(--c-orange);
        }
        .lucky-wallet .wallet-fee-row.is-active strong { color: var(--c-orange); }

        .lucky-wallet .wallet-hint {
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

        .lucky-wallet .wallet-error {
          margin-top: 12px;
          padding: 10px 14px;
          background: rgba(244, 63, 94, 0.08);
          border: 1px solid rgba(244, 63, 94, 0.25);
          border-radius: 12px;
          font-size: 12.5px;
          color: var(--c-red);
          font-weight: 700;
        }

        /* === 交易流水 === */
        .lucky-wallet .wallet-tx-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .lucky-wallet .wallet-tx-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
          padding: 12px 14px;
          background: #f8fafc;
          border: 1px solid rgba(15, 23, 42, 0.06);
          border-radius: 14px;
        }
        .lucky-wallet .wallet-tx-main { min-width: 0; }
        .lucky-wallet .wallet-tx-op {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13.5px;
          font-weight: 900;
          color: var(--text-main);
        }
        .lucky-wallet .wallet-tx-time {
          margin-top: 3px;
          font-size: 11.5px;
          font-weight: 700;
          color: var(--text-light);
        }
        .lucky-wallet .wallet-tx-msg {
          margin-top: 5px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-light);
          line-height: 1.5;
        }
        .lucky-wallet .wallet-tx-uncertain {
          margin-top: 6px;
          padding: 6px 10px;
          border-radius: 10px;
          background: rgba(251, 191, 36, 0.12);
          border: 1px solid rgba(251, 191, 36, 0.28);
          color: #b45309;
          font-size: 11.5px;
          font-weight: 800;
          line-height: 1.5;
        }
        .lucky-wallet .wallet-tx-side {
          flex-shrink: 0;
          text-align: right;
        }
        .lucky-wallet .wallet-tx-delta {
          font-size: 14px;
          font-weight: 900;
          letter-spacing: -0.2px;
        }
        .lucky-wallet .wallet-tx-delta.is-plus { color: var(--c-green); }
        .lucky-wallet .wallet-tx-delta.is-minus { color: var(--c-red); }
        .lucky-wallet .wallet-tx-dollars {
          margin-top: 2px;
          font-size: 11.5px;
          font-weight: 800;
          color: var(--text-light);
        }
        .lucky-wallet .wallet-tx-empty {
          padding: 28px 0;
          text-align: center;
          font-size: 13px;
          font-weight: 700;
          color: var(--text-light);
        }

        /* 状态徽章 */
        .lucky-wallet .wallet-badge {
          padding: 2px 8px;
          border-radius: 8px;
          font-size: 11px;
          font-weight: 800;
          white-space: nowrap;
        }
        .lucky-wallet .wallet-badge-success {
          background: rgba(16, 185, 129, 0.12);
          border: 1px solid rgba(16, 185, 129, 0.28);
          color: var(--c-green);
        }
        .lucky-wallet .wallet-badge-pending {
          background: rgba(100, 116, 139, 0.12);
          border: 1px solid rgba(100, 116, 139, 0.26);
          color: var(--text-light);
        }
        .lucky-wallet .wallet-badge-failed {
          background: rgba(244, 63, 94, 0.12);
          border: 1px solid rgba(244, 63, 94, 0.28);
          color: var(--c-red);
        }
        .lucky-wallet .wallet-badge-uncertain {
          background: rgba(251, 191, 36, 0.16);
          border: 1px solid rgba(251, 191, 36, 0.34);
          color: #b45309;
        }

        /* 分页 */
        .lucky-wallet .wallet-pager {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-top: 14px;
        }
        .lucky-wallet .wallet-pager-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 8px 14px;
          border-radius: 12px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: #fff;
          color: var(--text-light);
          font-size: 12.5px;
          font-weight: 800;
          cursor: pointer;
          transition: all 0.2s;
        }
        .lucky-wallet .wallet-pager-btn:hover:not(:disabled) { color: var(--c-orange); border-color: rgba(249, 115, 22, 0.3); }
        .lucky-wallet .wallet-pager-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .lucky-wallet .wallet-pager-info {
          font-size: 12px;
          font-weight: 800;
          color: var(--text-light);
        }

        /* === 结果条（迁移自 /store 结果弹窗，去掉遮罩与定位） === */
        .lucky-wallet .wallet-result-bar {
          position: relative;
          max-width: 460px;
          width: 100%;
          margin: 0 auto;
          border-radius: 24px;
          background: #fff;
          border: 1px solid rgba(15, 23, 42, 0.06);
          box-shadow: var(--card-shadow);
        }
        .lucky-wallet .wallet-result-bar.is-success { border-color: rgba(16, 185, 129, 0.28); }
        .lucky-wallet .wallet-result-bar.is-error { border-color: rgba(244, 63, 94, 0.28); }
        .lucky-wallet .wallet-result-bar.is-warning { border-color: rgba(251, 191, 36, 0.34); }
        .lucky-wallet .wallet-result-close {
          position: absolute;
          top: 14px;
          right: 14px;
          width: 34px;
          height: 34px;
          border: 0;
          border-radius: 12px;
          background: rgba(15, 23, 42, 0.05);
          color: var(--text-light);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }
        .lucky-wallet .wallet-result-close:hover {
          background: rgba(15, 23, 42, 0.09);
          color: var(--text-main);
        }
        .lucky-wallet .wallet-result-body {
          padding: 34px 28px 26px;
          text-align: center;
        }
        .lucky-wallet .wallet-result-mark {
          width: 72px;
          height: 72px;
          border-radius: 24px;
          margin: 0 auto 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          box-shadow: 0 18px 32px rgba(15, 23, 42, 0.14);
        }
        .lucky-wallet .wallet-result-bar.is-success .wallet-result-mark {
          background: var(--grad-green);
          box-shadow: 0 18px 32px rgba(16, 185, 129, 0.28);
        }
        .lucky-wallet .wallet-result-bar.is-error .wallet-result-mark {
          background: linear-gradient(135deg, #fb7185, #f43f5e);
          box-shadow: 0 18px 32px rgba(244, 63, 94, 0.28);
        }
        .lucky-wallet .wallet-result-bar.is-warning .wallet-result-mark {
          background: var(--grad-amber);
          color: #92400e;
          box-shadow: 0 18px 32px rgba(251, 191, 36, 0.28);
        }
        .lucky-wallet .wallet-result-mark svg { stroke-width: 2.4; }
        .lucky-wallet .wallet-result-kicker {
          color: var(--text-light);
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .lucky-wallet .wallet-result-body h3 {
          margin: 0;
          color: var(--text-main);
          font-size: 24px;
          line-height: 1.18;
          font-weight: 900;
          letter-spacing: -0.5px;
        }
        .lucky-wallet .wallet-result-body p {
          margin: 10px auto 0;
          max-width: 320px;
          color: var(--text-light);
          font-size: 13.5px;
          font-weight: 600;
          line-height: 1.65;
        }
        .lucky-wallet .wallet-result-details {
          margin-top: 18px;
          padding: 14px 16px;
          border-radius: 16px;
          background: rgba(248, 250, 252, 0.92);
          border: 1px solid rgba(15, 23, 42, 0.06);
          display: flex;
          flex-direction: column;
          gap: 10px;
          text-align: left;
        }
        .lucky-wallet .wallet-result-detail {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          color: var(--text-light);
          font-size: 12.5px;
          font-weight: 700;
        }
        .lucky-wallet .wallet-result-detail strong {
          color: var(--text-main);
          font-size: 13.5px;
          font-weight: 900;
          text-align: right;
          white-space: nowrap;
        }
        .lucky-wallet .wallet-result-detail strong.tone-success { color: var(--c-green); }
        .lucky-wallet .wallet-result-detail strong.tone-danger { color: var(--c-red); }
        .lucky-wallet .wallet-result-detail strong.tone-warning { color: #b45309; }
        .lucky-wallet .wallet-result-primary {
          width: 100%;
          margin-top: 18px;
          height: 46px;
          border: 0;
          border-radius: 14px;
          color: #fff;
          font-size: 14px;
          font-weight: 900;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .lucky-wallet .wallet-result-primary:hover { transform: translateY(-1px); }
        .lucky-wallet .wallet-result-bar.is-success .wallet-result-primary {
          background: var(--grad-green);
          box-shadow: 0 12px 24px rgba(16, 185, 129, 0.24);
        }
        .lucky-wallet .wallet-result-bar.is-error .wallet-result-primary {
          background: linear-gradient(135deg, #fb7185, #f43f5e);
          box-shadow: 0 12px 24px rgba(244, 63, 94, 0.24);
        }
        .lucky-wallet .wallet-result-bar.is-warning .wallet-result-primary {
          background: var(--grad-amber);
          color: #92400e;
          box-shadow: 0 12px 24px rgba(251, 191, 36, 0.24);
        }

        /* === 响应式：移动端上下堆叠 === */
        @media (max-width: 992px) {
          .lucky-wallet .wallet-topbar { padding: 12px 24px; }
          .lucky-wallet .wallet-container { padding: 20px 24px 48px; }
          .lucky-wallet .wallet-top-grid,
          .lucky-wallet .wallet-actions-grid { grid-template-columns: 1fr; }
          .lucky-wallet .wallet-vip-bar {
            flex-direction: column;
            align-items: stretch;
          }
          .lucky-wallet .wallet-vip-cta { align-items: stretch; }
          .lucky-wallet .wallet-submit-btn.is-vip { width: 100%; }
          .lucky-wallet .wallet-vip-blocked { max-width: none; text-align: center; }
        }
        @media (max-width: 640px) {
          .lucky-wallet .wallet-topbar { padding: 10px 16px; }
          .lucky-wallet .wallet-brand { font-size: 17px; }
          .lucky-wallet .wallet-container { padding: 16px 14px 40px; gap: 14px; }
          .lucky-wallet .wallet-panel { padding: 16px 14px; border-radius: 20px; }
          .lucky-wallet .wallet-vip-bar { padding: 16px 14px; border-radius: 20px; }
          .lucky-wallet .wallet-result-body { padding: 28px 18px 20px; }
          .lucky-wallet .wallet-result-body h3 { font-size: 20px; }
          .lucky-wallet .wallet-tx-row { flex-direction: column; }
          .lucky-wallet .wallet-tx-side { text-align: left; }
        }
      `}</style>
    </div>
  );
}
