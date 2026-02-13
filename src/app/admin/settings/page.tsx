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
      <div className="glass-card rounded-[2rem] shadow-sm border border-white/60 overflow-hidden mb-8">
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

      {/* 老虎机配置 */}
      <div className="glass-card rounded-[2rem] shadow-sm border border-white/60 overflow-hidden">
        <div className="p-8 border-b border-stone-100 bg-white/40">
          <h2 className="text-lg font-black text-stone-800">老虎机设置</h2>
        </div>

        <div className="p-8 space-y-8">
          <div className="flex items-center justify-between p-6 bg-stone-50/50 rounded-3xl border border-stone-100 hover:bg-stone-50 transition-colors">
            <div className="pr-6">
              <div className="text-base font-black text-stone-800">挑战模式</div>
              <div className="text-sm text-stone-400 mt-1 font-medium">
                开启后，用户可消耗积分选择档位旋转（默认期望为负，避免刷分）。
              </div>
            </div>
            <button
              type="button"
              onClick={() => setBetModeEnabled((v) => !v)}
              className={`relative w-14 h-8 rounded-full transition-all duration-300 shadow-inner ${betModeEnabled ? 'bg-emerald-500' : 'bg-stone-300'
                }`}
              aria-label="Toggle bet mode"
            >
              <span
                className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-sm transition-all duration-300 ${betModeEnabled ? 'left-7' : 'left-1'
                  }`}
              />
            </button>
          </div>

          <div>
            <label className="block text-sm font-bold text-stone-500 uppercase tracking-widest mb-3">每次消耗积分</label>
            <div className="flex items-center gap-4">
              <div className="relative">
                <select
                  value={betCost}
                  onChange={(e) => setBetCost(e.target.value)}
                  className="w-48 px-5 py-3 border-2 border-stone-100 bg-stone-50/50 rounded-2xl focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 outline-none font-black text-lg transition-all appearance-none pr-10 cursor-pointer hover:bg-white"
                >
                  {SLOT_BET_OPTIONS.map((opt) => (
                    <option key={opt} value={String(opt)}>
                      {opt}
                    </option>
                  ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2.5 4.5L6 8L9.5 4.5" stroke="#a8a29e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
              <span className="text-stone-400 font-bold">积分/次</span>
            </div>
            <p className="mt-3 text-sm text-stone-400 font-medium">
              下注档位固定为 <span className="font-bold text-stone-600">{SLOT_BET_OPTIONS.join(' / ')}</span>。
            </p>
          </div>

          <div className="pt-6 border-t border-stone-100">
            <button
              onClick={handleSaveSlot}
              disabled={savingSlot}
              className="px-8 py-3.5 bg-stone-800 hover:bg-stone-900 disabled:bg-stone-400 text-white font-black rounded-2xl shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all"
            >
              {savingSlot ? '保存中...' : '保存老虎机配置'}
            </button>
          </div>
        </div>
      </div>

      {/* 配置信息 */}
      {(config?.updatedAt || slotConfig?.updatedAt) && (
        <div className="mt-8 text-xs font-bold text-stone-300 text-center space-y-1 uppercase tracking-wider">
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
