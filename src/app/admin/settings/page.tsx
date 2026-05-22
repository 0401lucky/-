'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface SystemConfig {
  dailyPointsLimit: number;
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
