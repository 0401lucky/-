'use client';

import { useCallback, useEffect, useState } from 'react';
import { Send, Search, AlertTriangle } from 'lucide-react';

type RewardType = 'points' | 'quota';
type TargetMode = 'all' | 'selected';

interface UserOption {
  id: number;
  username: string;
}

interface RewardBatchItem {
  id: string;
  type: RewardType;
  amount: number;
  targetMode: TargetMode;
  title: string;
  message: string;
  createdBy: string;
  createdAt: number;
  status: string;
  totalTargets: number;
  distributedCount: number;
  claimedCount: number;
  failedClaimCount: number;
}

export default function AdminRewardsPage() {
  // 表单状态
  const [rewardType, setRewardType] = useState<RewardType>('points');
  const [amount, setAmount] = useState('');
  const [targetMode, setTargetMode] = useState<TargetMode>('all');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');

  // 用户选择
  const [userSearchTab, setUserSearchTab] = useState<'search' | 'manual'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<UserOption[]>([]);
  const [manualIds, setManualIds] = useState('');

  // 发放状态
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 记录列表
  const [batches, setBatches] = useState<RewardBatchItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listPage, setListPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [listTotalPages, setListTotalPages] = useState(1);

  const fetchBatches = useCallback(async (p = listPage) => {
    setListLoading(true);
    try {
      const res = await fetch(`/api/admin/rewards?page=${p}&limit=10`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success) {
        setBatches(data.data?.items ?? []);
        setListTotal(data.data?.total ?? 0);
        setListTotalPages(data.data?.totalPages ?? 1);
        setListPage(p);
      }
    } catch {
      // ignore
    } finally {
      setListLoading(false);
    }
  }, [listPage]);

  useEffect(() => {
    void fetchBatches(1);
  }, [fetchBatches]);

  // 搜索用户
  const searchUsers = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/users?search=${encodeURIComponent(searchQuery)}&limit=20`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data?.users)) {
        setSearchResults(
          data.data.users.map((u: { id: number; username: string }) => ({
            id: u.id,
            username: u.username,
          }))
        );
      }
    } catch {
      // ignore
    } finally {
      setSearching(false);
    }
  };

  const toggleUser = (user: UserOption) => {
    setSelectedUsers((prev) => {
      const exists = prev.find((u) => u.id === user.id);
      return exists ? prev.filter((u) => u.id !== user.id) : [...prev, user];
    });
  };

  const removeUser = (userId: number) => {
    setSelectedUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  // 获取目标用户 ID 列表
  const getTargetUserIds = (): number[] => {
    if (userSearchTab === 'manual') {
      return manualIds
        .split(/[,，\s]+/)
        .map((s) => Number(s.trim()))
        .filter((id) => Number.isFinite(id) && id > 0);
    }
    return selectedUsers.map((u) => u.id);
  };

  const resetForm = () => {
    setRewardType('points');
    setAmount('');
    setTargetMode('all');
    setTitle('');
    setMessage('');
    setSelectedUsers([]);
    setManualIds('');
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleSubmit = async () => {
    setShowConfirm(false);
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const amountNum = Number(amount);
    const targetUserIds = targetMode === 'selected' ? getTargetUserIds() : undefined;

    try {
      const res = await fetch('/api/admin/rewards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: rewardType,
          amount: amountNum,
          targetMode,
          targetUserIds,
          title,
          message,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || '发放失败');
      }
      setSuccess(`发放完成！已向 ${data.data?.distributedCount ?? 0} 位用户发送奖励通知。`);
      resetForm();
      void fetchBatches(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发放失败');
    } finally {
      setSubmitting(false);
    }
  };

  const validateForm = (): string | null => {
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) return '数量必须为正数';
    if (rewardType === 'quota' && amountNum > 100) return '直充额度不能超过 100 美元';
    if (rewardType === 'points' && amountNum > 1000000) return '积分不能超过 1,000,000';
    if (!title.trim()) return '通知标题不能为空';
    if (!message.trim()) return '通知内容不能为空';
    if (targetMode === 'selected') {
      const ids = getTargetUserIds();
      if (ids.length === 0) return '请选择至少一位目标用户';
    }
    return null;
  };

  const onConfirmClick = () => {
    const err = validateForm();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setShowConfirm(true);
  };

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleString('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  const typeLabel = (t: RewardType) => (t === 'points' ? '积分' : '直充额度');
  const modeLabel = (m: TargetMode) => (m === 'all' ? '全部用户' : '指定用户');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* 左侧：发放表单 */}
      <section className="lg:col-span-2 bg-white border border-stone-200 rounded-2xl p-5">
        <h2 className="text-base font-semibold text-stone-800 mb-4">发放奖励</h2>

        <div className="space-y-4">
          {/* 奖励类型 */}
          <div>
            <label className="block text-xs text-stone-500 mb-1">奖励类型</label>
            <select
              value={rewardType}
              onChange={(e) => setRewardType(e.target.value as RewardType)}
              className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-orange-500 outline-none"
            >
              <option value="points">积分</option>
              <option value="quota">直充额度 (美元)</option>
            </select>
          </div>

          {/* 数量 */}
          <div>
            <label className="block text-xs text-stone-500 mb-1">
              {rewardType === 'points' ? '积分数量' : '额度金额 (美元)'}
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={0}
              step={rewardType === 'quota' ? 0.01 : 1}
              max={rewardType === 'quota' ? 100 : 1000000}
              className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-orange-500 outline-none"
              placeholder={rewardType === 'points' ? '输入积分数量' : '输入美元金额'}
            />
            <p className="mt-1 text-xs text-stone-400">
              {rewardType === 'points' ? '上限 1,000,000' : '上限 100 美元'}
            </p>
          </div>

          {/* 发放范围 */}
          <div>
            <label className="block text-xs text-stone-500 mb-1">发放范围</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="targetMode"
                  value="all"
                  checked={targetMode === 'all'}
                  onChange={() => setTargetMode('all')}
                  className="accent-orange-500"
                />
                <span className="text-sm text-stone-700">全部用户</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="targetMode"
                  value="selected"
                  checked={targetMode === 'selected'}
                  onChange={() => setTargetMode('selected')}
                  className="accent-orange-500"
                />
                <span className="text-sm text-stone-700">指定用户</span>
              </label>
            </div>
          </div>

          {/* 指定用户选择器 */}
          {targetMode === 'selected' && (
            <div className="border border-stone-200 rounded-xl p-3 space-y-3">
              <div className="flex gap-1 border-b border-stone-100 pb-2">
                <button
                  type="button"
                  onClick={() => setUserSearchTab('search')}
                  className={`px-3 py-1 rounded-lg text-xs font-medium ${
                    userSearchTab === 'search'
                      ? 'bg-orange-50 text-orange-700 border border-orange-200'
                      : 'text-stone-500 hover:bg-stone-50'
                  }`}
                >
                  搜索用户
                </button>
                <button
                  type="button"
                  onClick={() => setUserSearchTab('manual')}
                  className={`px-3 py-1 rounded-lg text-xs font-medium ${
                    userSearchTab === 'manual'
                      ? 'bg-orange-50 text-orange-700 border border-orange-200'
                      : 'text-stone-500 hover:bg-stone-50'
                  }`}
                >
                  手动输入 ID
                </button>
              </div>

              {userSearchTab === 'search' ? (
                <>
                  <div className="flex gap-2">
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void searchUsers()}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-stone-200 bg-stone-50 text-sm outline-none focus:border-orange-400"
                      placeholder="搜索用户名或 ID"
                    />
                    <button
                      type="button"
                      onClick={() => void searchUsers()}
                      disabled={searching}
                      className="px-3 py-1.5 rounded-lg bg-stone-100 text-stone-600 text-sm hover:bg-stone-200 disabled:opacity-50"
                    >
                      <Search className="w-4 h-4" />
                    </button>
                  </div>

                  {searchResults.length > 0 && (
                    <div className="max-h-32 overflow-y-auto border border-stone-100 rounded-lg divide-y divide-stone-100">
                      {searchResults.map((user) => {
                        const isSelected = selectedUsers.some((u) => u.id === user.id);
                        return (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => toggleUser(user)}
                            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-stone-50 ${
                              isSelected ? 'bg-orange-50 text-orange-700' : 'text-stone-700'
                            }`}
                          >
                            {user.username} (ID: {user.id})
                            {isSelected && <span className="ml-2 text-xs">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {selectedUsers.length > 0 && (
                    <div>
                      <p className="text-xs text-stone-500 mb-1">
                        已选 {selectedUsers.length} 人:
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {selectedUsers.map((user) => (
                          <span
                            key={user.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 text-xs border border-orange-200"
                          >
                            {user.username}
                            <button
                              type="button"
                              onClick={() => removeUser(user.id)}
                              className="hover:text-red-500"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <textarea
                    value={manualIds}
                    onChange={(e) => setManualIds(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-stone-50 text-sm outline-none focus:border-orange-400 resize-y"
                    placeholder="输入用户 ID，用逗号分隔，如: 123, 456, 789"
                  />
                  <p className="mt-1 text-xs text-stone-400">
                    {(() => {
                      const ids = getTargetUserIds();
                      return ids.length > 0 ? `解析到 ${ids.length} 个有效 ID` : '暂无有效 ID';
                    })()}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 通知标题 */}
          <div>
            <label className="block text-xs text-stone-500 mb-1">通知标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-orange-500 outline-none"
              placeholder="如: 新年积分奖励"
            />
          </div>

          {/* 通知内容 */}
          <div>
            <label className="block text-xs text-stone-500 mb-1">通知内容</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              rows={4}
              className="w-full px-3 py-2 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-orange-500 outline-none resize-y"
              placeholder="如: 恭喜获得 100 积分奖励，请点击领取！"
            />
          </div>

          {/* 提交按钮 */}
          <button
            type="button"
            disabled={submitting}
            onClick={onConfirmClick}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-600 text-white text-sm font-medium hover:bg-orange-700 disabled:opacity-60"
          >
            <Send className="w-4 h-4" />
            {submitting ? '发放中...' : '确认发放'}
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        {success && <p className="mt-4 text-sm text-emerald-600">{success}</p>}
      </section>

      {/* 右侧：发放记录 */}
      <section className="lg:col-span-3 bg-white border border-stone-200 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-base font-semibold text-stone-800">发放记录</h2>
          <span className="text-xs text-stone-400">共 {listTotal} 条</span>
        </div>

        {listLoading ? (
          <div className="p-8 text-center text-stone-500">加载中...</div>
        ) : batches.length === 0 ? (
          <div className="p-8 text-center text-stone-400">暂无发放记录</div>
        ) : (
          <div className="space-y-3">
            {batches.map((batch) => (
              <div key={batch.id} className="border border-stone-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border ${
                          batch.type === 'points'
                            ? 'bg-amber-50 border-amber-200 text-amber-700'
                            : 'bg-blue-50 border-blue-200 text-blue-700'
                        }`}
                      >
                        {typeLabel(batch.type)}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 border border-stone-200 text-stone-600">
                        {modeLabel(batch.targetMode)}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full border ${
                          batch.status === 'completed'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : batch.status === 'failed'
                              ? 'bg-red-50 border-red-200 text-red-700'
                              : 'bg-yellow-50 border-yellow-200 text-yellow-700'
                        }`}
                      >
                        {batch.status === 'completed'
                          ? '已完成'
                          : batch.status === 'failed'
                            ? '失败'
                            : '分发中'}
                      </span>
                    </div>

                    <h3 className="text-sm font-semibold text-stone-800">{batch.title}</h3>
                    <p className="mt-1 text-sm text-stone-600 line-clamp-2">{batch.message}</p>

                    <div className="mt-2 flex items-center gap-3 text-xs text-stone-500">
                      <span>
                        {batch.type === 'points'
                          ? `${batch.amount} 积分`
                          : `$${batch.amount} 额度`}
                      </span>
                      <span>·</span>
                      <span>已发放 {batch.distributedCount}/{batch.totalTargets}</span>
                      <span>·</span>
                      <span>已领取 {batch.claimedCount}</span>
                      {batch.failedClaimCount > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-red-500">失败 {batch.failedClaimCount}</span>
                        </>
                      )}
                    </div>

                    <p className="mt-1 text-xs text-stone-400">
                      由 {batch.createdBy} 于 {formatTime(batch.createdAt)} 发放
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {listTotalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              disabled={listPage <= 1 || listLoading}
              onClick={() => void fetchBatches(listPage - 1)}
              className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 text-stone-600 disabled:opacity-50"
            >
              上一页
            </button>
            <span className="text-sm text-stone-500">
              第 {listPage} / {listTotalPages} 页
            </span>
            <button
              disabled={listPage >= listTotalPages || listLoading}
              onClick={() => void fetchBatches(listPage + 1)}
              className="px-3 py-1.5 text-sm rounded-lg border border-stone-200 text-stone-600 disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        )}
      </section>

      {/* 二次确认弹窗 */}
      {showConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="取消"
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowConfirm(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
              </div>
              <h3 className="text-base font-semibold text-stone-800">确认发放</h3>
            </div>

            <div className="space-y-2 text-sm text-stone-600">
              <p>
                奖励类型：<strong>{typeLabel(rewardType)}</strong>
              </p>
              <p>
                数量：
                <strong>
                  {rewardType === 'points' ? `${amount} 积分` : `$${amount} 美元`}
                </strong>
              </p>
              <p>
                发放范围：
                <strong>
                  {targetMode === 'all'
                    ? '全部用户'
                    : `指定 ${getTargetUserIds().length} 位用户`}
                </strong>
              </p>
              <p>
                通知标题：<strong>{title}</strong>
              </p>
            </div>

            <p className="mt-3 text-xs text-orange-600">
              发放后将向目标用户发送奖励通知，用户需在通知中心领取。此操作不可撤销。
            </p>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 rounded-xl border border-stone-200 text-stone-600 text-sm hover:bg-stone-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmit()}
                className="px-4 py-2 rounded-xl bg-orange-600 text-white text-sm font-medium hover:bg-orange-700 disabled:opacity-60"
              >
                {submitting ? '发放中...' : '确认发放'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
