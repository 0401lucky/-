'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { SLOT_BET_OPTIONS } from '@/lib/slot-constants';

interface SystemConfig {
  dailyPointsLimit: number;
  updatedAt?: number;
  updatedBy?: string;
}

interface SlotConfig {
  betModeEnabled: boolean;
  betCost: number;
  updatedAt?: number;
  updatedBy?: string;
}

export default function AdminSettingsPage() {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [slotConfig, setSlotConfig] = useState<SlotConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingSlot, setSavingSlot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 表单状态
  const [dailyPointsLimit, setDailyPointsLimit] = useState('');
  const [betModeEnabled, setBetModeEnabled] = useState(false);
  const [betCost, setBetCost] = useState('');

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
      const [systemRes, slotRes] = await Promise.all([
        fetch('/api/admin/config'),
        fetch('/api/admin/games/slot/config'),
      ]);

      const systemData = await systemRes.json();
      if (systemData.success) {
        setConfig(systemData.config);
        setDailyPointsLimit(String(systemData.config.dailyPointsLimit));
      } else {
        setError(systemData.error || '获取系统配置失败');
      }

      const slotData = await slotRes.json();
      if (slotData.success && slotData.data?.config) {
        setSlotConfig(slotData.data.config);
        setBetModeEnabled(!!slotData.data.config.betModeEnabled);
        const parsedBetCost = Number(slotData.data.config.betCost);
        const safeBetCost =
          Number.isInteger(parsedBetCost) &&
          SLOT_BET_OPTIONS.includes(parsedBetCost as (typeof SLOT_BET_OPTIONS)[number])
            ? parsedBetCost
            : SLOT_BET_OPTIONS[0];
        setBetCost(String(safeBetCost));
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
        body: JSON.stringify({
          dailyPointsLimit: Number(dailyPointsLimit),
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

  const handleSaveSlot = async () => {
    setError(null);
    setSuccess(null);
    setSavingSlot(true);

    try {
      const res = await fetch('/api/admin/games/slot/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          betModeEnabled,
          betCost: Number(betCost),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSlotConfig(data.data.config);
        setSuccess('老虎机配置已保存');
        scheduleSuccessClear();
      } else {
        setError(data.message || '保存失败');
      }
    } catch {
      setError('网络错误');
    } finally {
      setSavingSlot(false);
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
      <h1 className="text-2xl font-bold text-stone-800 mb-8">设置</h1>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
          {error}
        </div>
      )}

      {/* 成功提示 */}
      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl text-green-700">
          ✓ {success}
        </div>
      )}

      {/* 配置表单 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">游戏配置</h2>
        </div>

        <div className="p-6 space-y-6">
          {/* 每日积分上限 */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              每日积分上限
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={dailyPointsLimit}
                onChange={(e) => setDailyPointsLimit(e.target.value)}
                min="100"
                max="100000"
                className="w-40 px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <span className="text-slate-500">积分/天/用户</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              用户每天通过游戏最多可获得的积分数量（所有游戏累计）。
              达到上限后仍可游玩，但不再获得积分。
            </p>
          </div>

          {/* 保存按钮 */}
          <div className="pt-4 border-t border-slate-100">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-lg transition-colors"
            >
              {saving ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      </div>

      {/* 老虎机配置 */}
      <div className="mt-6 bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">老虎机设置</h2>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div className="pr-6">
              <div className="text-sm font-semibold text-slate-800">挑战模式</div>
              <div className="text-xs text-slate-500 mt-1">
                开启后，用户可消耗积分选择档位旋转（默认期望为负，避免刷分）。
              </div>
            </div>
            <button
              type="button"
              onClick={() => setBetModeEnabled((v) => !v)}
              className={`relative w-12 h-7 rounded-full transition-colors ${
                betModeEnabled ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
              aria-label="Toggle bet mode"
            >
              <span
                className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${
                  betModeEnabled ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">每次消耗积分</label>
            <div className="flex items-center gap-4">
              <select
                value={betCost}
                onChange={(e) => setBetCost(e.target.value)}
                className="w-40 px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
              >
                {SLOT_BET_OPTIONS.map((opt) => (
                  <option key={opt} value={String(opt)}>
                    {opt}
                  </option>
                ))}
              </select>
              <span className="text-slate-500">积分/次</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              下注档位固定为 <span className="font-semibold">{SLOT_BET_OPTIONS.join(' / ')}</span>。
            </p>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <button
              onClick={handleSaveSlot}
              disabled={savingSlot}
              className="px-6 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-semibold rounded-lg transition-colors"
            >
              {savingSlot ? '保存中...' : '保存老虎机配置'}
            </button>
          </div>
        </div>
      </div>

      {/* 配置信息 */}
      {(config?.updatedAt || slotConfig?.updatedAt) && (
        <div className="mt-6 text-sm text-slate-400 text-center space-y-1">
          {config?.updatedAt && (
            <div>
              系统配置更新：{new Date(config.updatedAt).toLocaleString('zh-CN')}
              {config.updatedBy && ` · 操作人：${config.updatedBy}`}
            </div>
          )}
          {slotConfig?.updatedAt && (
            <div>
              老虎机配置更新：{new Date(slotConfig.updatedAt).toLocaleString('zh-CN')}
              {slotConfig.updatedBy && ` · 操作人：${slotConfig.updatedBy}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
