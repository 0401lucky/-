'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface SystemConfig {
  dailyPointsLimit: number;
  dailyWithdrawLimit: number;
  vipDailyWithdrawLimit: number;
  vipPricePoints: number;
  vipDurationDays: number;
  vipWithdrawFeePercent: number;
  vipDailyLotterySpins: number;
  vipMaxTotalDays: number;
  withdrawBalanceCapDollars: number;
  updatedAt?: number;
  updatedBy?: string;
}

export default function AdminSettingsPage() {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 表单状态
  const [dailyPointsLimit, setDailyPointsLimit] = useState('');
  const [dailyWithdrawLimit, setDailyWithdrawLimit] = useState('');
  const [vipDailyWithdrawLimit, setVipDailyWithdrawLimit] = useState('');
  const [vipPricePoints, setVipPricePoints] = useState('');
  const [vipDurationDays, setVipDurationDays] = useState('');
  const [vipWithdrawFeePercent, setVipWithdrawFeePercent] = useState('');
  const [vipDailyLotterySpins, setVipDailyLotterySpins] = useState('');
  const [vipMaxTotalDays, setVipMaxTotalDays] = useState('');
  const [withdrawBalanceCapDollars, setWithdrawBalanceCapDollars] = useState('');

  const scheduleSuccessClear = useCallback(() => {
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = setTimeout(() => {
      setSuccess(null);
      successTimeoutRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);
  // 获取配置
  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const systemRes = await fetch('/api/admin/config');

      const systemData = await systemRes.json();
      if (systemData.success) {
        setConfig(systemData.config);
        setDailyPointsLimit(String(systemData.config.dailyPointsLimit));
        setDailyWithdrawLimit(String(systemData.config.dailyWithdrawLimit));
        setVipDailyWithdrawLimit(String(systemData.config.vipDailyWithdrawLimit));
        setVipPricePoints(String(systemData.config.vipPricePoints));
        setVipDurationDays(String(systemData.config.vipDurationDays));
        setVipWithdrawFeePercent(String(systemData.config.vipWithdrawFeePercent));
        setVipDailyLotterySpins(String(systemData.config.vipDailyLotterySpins));
        setVipMaxTotalDays(String(systemData.config.vipMaxTotalDays));
        setWithdrawBalanceCapDollars(String(systemData.config.withdrawBalanceCapDollars));
      } else {
        setError(systemData.error || '获取系统配置失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  };

  // 保存配置
  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // 后端的 nil 语义是「重置为默认值」，必须全量提交 9 个字段
        body: JSON.stringify({
          dailyPointsLimit: Number(dailyPointsLimit),
          dailyWithdrawLimit: Number(dailyWithdrawLimit),
          vipDailyWithdrawLimit: Number(vipDailyWithdrawLimit),
          vipPricePoints: Number(vipPricePoints),
          vipDurationDays: Number(vipDurationDays),
          vipWithdrawFeePercent: Number(vipWithdrawFeePercent),
          vipDailyLotterySpins: Number(vipDailyLotterySpins),
          vipMaxTotalDays: Number(vipMaxTotalDays),
          withdrawBalanceCapDollars: Number(withdrawBalanceCapDollars),
        }),
      });

      const data = await res.json();

      if (data.success) {
        setConfig(data.config);
        setSuccess('配置已保存');
        scheduleSuccessClear();
      } else {
        setError(data.message || '保存失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-slate-500">加载中...</div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-black text-stone-800 mb-8 tracking-tight">系统设置</h1>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 font-bold animate-pulse">
          {error}
        </div>
      )}

      {/* 成功提示 */}
      {success && (
        <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-700 font-bold animate-flip-in-x">
          ✓ {success}
        </div>
      )}

      {/* 配置表单 */}
      <div className="glass-card rounded-[2rem] shadow-sm border border-white/60 overflow-hidden">
        <div className="p-8 border-b border-stone-100 bg-white/40">
          <h2 className="text-lg font-black text-stone-800">游戏配置</h2>
        </div>

        <div className="p-8 space-y-8">
          {/* 每日积分上限 */}
          <div>
            <label className="block text-sm font-bold text-stone-500 uppercase tracking-widest mb-3">
              每日积分上限
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={dailyPointsLimit}
                onChange={(e) => setDailyPointsLimit(e.target.value)}
                min="100"
                max="100000"
                className="w-48 px-5 py-3 border-2 border-stone-100 bg-stone-50/50 rounded-2xl focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 outline-none font-black text-lg transition-all"
              />
              <span className="text-stone-400 font-bold">积分/天/用户</span>
            </div>
            <p className="mt-3 text-sm text-stone-400 font-medium leading-relaxed">
              用户每天通过游戏最多可获得的积分数量（所有游戏累计）。
              达到上限后仍可游玩，但不再获得积分。
            </p>
          </div>

          {/* 保存按钮 */}
          <div className="pt-6 border-t border-stone-100">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-8 py-3.5 gradient-warm text-white font-black rounded-2xl shadow-lg shadow-orange-500/30 hover:shadow-orange-500/40 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {saving ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      </div>

      {/* 钱包与 VIP 配置 */}
      <div className="glass-card rounded-[2rem] shadow-sm border border-white/60 overflow-hidden mt-8">
        <div className="p-8 border-b border-stone-100 bg-white/40">
          <h2 className="text-lg font-black text-stone-800">钱包与 VIP 配置</h2>
        </div>

        <div className="p-8 space-y-8">
          {/* 账户额度提现上限 */}
          <div>
            <label className="block text-sm font-bold text-stone-500 uppercase tracking-widest mb-3">
              账户额度提现上限
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={withdrawBalanceCapDollars}
                onChange={(e) => setWithdrawBalanceCapDollars(e.target.value)}
                min="1"
                max="1000000000000"
                className="w-48 px-5 py-3 border-2 border-stone-100 bg-stone-50/50 rounded-2xl focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 outline-none font-black text-lg transition-all"
              />
              <span className="text-stone-400 font-bold">美元</span>
            </div>
            <p className="mt-3 text-sm text-stone-400 font-medium leading-relaxed">
              用户在 new-api 的账户额度余额<strong className="font-black text-stone-500">达到该金额后禁止继续提现</strong>，
              需先消耗额度。VIP 与管理员均不豁免。把它调到远高于任何真实余额即等价于关闭本限制。
            </p>
          </div>

          {/* 普通用户每日提现次数 */}
          <div>
            <label className="block text-sm font-bold text-stone-500 uppercase tracking-widest mb-3">
              普通用户每日提现次数
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={dailyWithdrawLimit}
                onChange={(e) => setDailyWithdrawLimit(e.target.value)}
                min="1"
                max="100"
                className="w-48 px-5 py-3 border-2 border-stone-100 bg-stone-50/50 rounded-2xl focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 outline-none font-black text-lg transition-all"
              />
              <span className="text-stone-400 font-bold">次/天</span>
            </div>
            <p className="mt-3 text-sm text-stone-400 font-medium leading-relaxed">
              每天 0 点（中国时区）重置。管理员同样受限。
            </p>
          </div>

          {/* VIP 每日提现次数 */}
          <div>
            <label className="block text-sm font-bold text-stone-500 uppercase tracking-widest mb-3">
              VIP 每日提现次数
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={vipDailyWithdrawLimit}
                onChange={(e) => setVipDailyWithdrawLimit(e.target.value)}
                min="1"
                max="100"
                className="w-48 px-5 py-3 border-2 border-stone-100 bg-stone-50/50 rounded-2xl focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 outline-none font-black text-lg transition-all"
              />
              <span className="text-stone-400 font-bold">次/天</span>
            </div>
            <p className="mt-3 text-sm text-stone-400 font-medium leading-relaxed">
              VIP 用户享受的提现次数上限。
            </p>
          </div>

          {/* 月卡价格 */}
          <div>
            <label className="block text-sm font-bold text-stone-500 uppercase tracking-widest mb-3">
              月卡价格
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={vipPricePoints}
                onChange={(e) => setVipPricePoints(e.target.value)}
                min="1"
                max="1000000"
                className="w-48 px-5 py-3 border-2 border-stone-100 bg-stone-50/50 rounded-2xl focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 outline-none font-black text-lg transition-all"
              />
              <span className="text-stone-400 font-bold">积分</span>
            </div>
            <p className="mt-3 text-sm text-stone-400 font-medium leading-relaxed">
              购买一次 VIP 所需积分。
            </p>
          </div>

          {/* 月卡时长 */}
          <div>
            <label className="block text-sm font-bold text-stone-500 uppercase tracking-widest mb-3">
              月卡时长
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={vipDurationDays}
                onChange={(e) => setVipDurationDays(e.target.value)}
                min="1"
                max="365"
                className="w-48 px-5 py-3 border-2 border-stone-100 bg-stone-50/50 rounded-2xl focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 outline-none font-black text-lg transition-all"
              />
              <span className="text-stone-400 font-bold">天</span>
            </div>
            <p className="mt-3 text-sm text-stone-400 font-medium leading-relaxed">
              每次购买增加的天数，重复购买时长累加。
            </p>
          </div>

          {/* VIP 手续费百分比 */}
          <div>
            <label className="block text-sm font-bold text-stone-500 uppercase tracking-widest mb-3">
              VIP 手续费百分比
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={vipWithdrawFeePercent}
                onChange={(e) => setVipWithdrawFeePercent(e.target.value)}
                min="0"
                max="100"
                className="w-48 px-5 py-3 border-2 border-stone-100 bg-stone-50/50 rounded-2xl focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 outline-none font-black text-lg transition-all"
              />
              <span className="text-stone-400 font-bold">%</span>
            </div>
            <p className="mt-3 text-sm text-stone-400 font-medium leading-relaxed">
              按原阶梯费率的百分比收取，50 即五折，0 为免手续费。
            </p>
          </div>

          {/* VIP 每日赠送抽奖次数 */}
          <div>
            <label className="block text-sm font-bold text-stone-500 uppercase tracking-widest mb-3">
              VIP 每日赠送抽奖次数
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={vipDailyLotterySpins}
                onChange={(e) => setVipDailyLotterySpins(e.target.value)}
                min="0"
                max="50"
                className="w-48 px-5 py-3 border-2 border-stone-100 bg-stone-50/50 rounded-2xl focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 outline-none font-black text-lg transition-all"
              />
              <span className="text-stone-400 font-bold">次/天</span>
            </div>
            <p className="mt-3 text-sm text-stone-400 font-medium leading-relaxed">
              在每日 1 次免费抽奖的基础上额外赠送。
            </p>
          </div>

          {/* VIP 累计时长上限 */}
          <div>
            <label className="block text-sm font-bold text-stone-500 uppercase tracking-widest mb-3">
              VIP 累计时长上限
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={vipMaxTotalDays}
                onChange={(e) => setVipMaxTotalDays(e.target.value)}
                min="1"
                max="3650"
                className="w-48 px-5 py-3 border-2 border-stone-100 bg-stone-50/50 rounded-2xl focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 outline-none font-black text-lg transition-all"
              />
              <span className="text-stone-400 font-bold">天</span>
            </div>
            <p className="mt-3 text-sm text-stone-400 font-medium leading-relaxed">
              用户剩余 VIP 时长的上限，<strong className="font-black text-stone-500">必须不小于月卡时长</strong>，否则用户第一次购买就会被拒。
            </p>
          </div>
        </div>
      </div>

      {/* 配置信息 */}
      {config?.updatedAt && (
        <div className="mt-8 text-xs font-bold text-stone-300 text-center space-y-1 uppercase tracking-wider">
          <div>
            系统配置更新：{new Date(config.updatedAt).toLocaleString('zh-CN')}
            {config.updatedBy && ` · 操作人：${config.updatedBy}`}
          </div>
        </div>
      )}
    </div>
  );
}
