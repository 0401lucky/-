// src/app/admin/settings/page.tsx

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

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
  
  // 表单状态
  const [dailyPointsLimit, setDailyPointsLimit] = useState('');

  // 获取配置
  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/admin/config');
      const data = await res.json();
      
      if (data.success) {
        setConfig(data.config);
        setDailyPointsLimit(String(data.config.dailyPointsLimit));
      } else {
        setError(data.error || '获取配置失败');
      }
    } catch (err) {
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
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(data.message || '保存失败');
      }
    } catch (err) {
      setError('网络错误');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* 顶部导航 */}
        <div className="flex items-center justify-between mb-8">
          <Link
            href="/admin"
            className="group flex items-center text-slate-500 hover:text-slate-800 transition-colors font-medium"
          >
            <span className="mr-2 group-hover:-translate-x-1 transition-transform">←</span>
            返回管理后台
          </Link>
        </div>

        {/* 页面标题 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <span className="text-3xl">⚙️</span>
            系统设置
          </h1>
          <p className="text-slate-500 mt-2">配置系统全局参数</p>
        </div>

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

        {/* 配置信息 */}
        {config?.updatedAt && (
          <div className="mt-6 text-sm text-slate-400 text-center">
            最后更新：{new Date(config.updatedAt).toLocaleString('zh-CN')}
            {config.updatedBy && ` · 操作人：${config.updatedBy}`}
          </div>
        )}
      </div>
    </div>
  );
}
