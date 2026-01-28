'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, CalendarDays, Gift, ChevronLeft, Loader2, PartyPopper, Sparkles } from 'lucide-react';

interface CheckinResult {
  quotaDisplay?: string;
  extraSpins?: number;
}

export default function CheckinPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);
  const [extraSpins, setExtraSpins] = useState(0);
  const [checkinResult, setCheckinResult] = useState<CheckinResult | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const [userRes, statusRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/checkin')
      ]);

      if (userRes.ok) {
        const userData = await userRes.json();
        if (!userData.success) {
          router.push('/login?redirect=/checkin');
          return;
        }
      }

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setCheckedIn(statusData.checkedIn);
        setExtraSpins(statusData.extraSpins || 0);
      }
    } catch (error) {
      console.error('Failed to fetch status:', error);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const handleCheckin = async () => {
    if (submitting || checkedIn) return;
    setSubmitting(true);

    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
      });
      const data = await res.json();

      if (data.success) {
        setCheckedIn(true);
        setExtraSpins(data.extraSpins || extraSpins + 1);
        setCheckinResult({
          quotaDisplay: data.quotaDisplay,
          extraSpins: data.extraSpins,
        });
        // [Perf] 动态导入彩带特效，减少首屏 JS 体积
        import('canvas-confetti').then(({ default: confetti }) => {
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#f97316', '#fbbf24', '#ffffff']
          });
        });
      } else {
        alert(data.message || '签到失败');
      }
    } catch {
      alert('签到请求失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafaf9]">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafaf9] flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* 顶部导航 */}
        <div className="mb-8 flex items-center text-stone-500 hover:text-stone-800 transition-colors">
          <Link href="/" className="flex items-center gap-1 text-sm font-semibold">
            <ChevronLeft className="w-4 h-4" />
            返回首页
          </Link>
        </div>

        {/* 主卡片 */}
        <div className="glass rounded-3xl p-8 border border-white/60 shadow-xl shadow-orange-500/5 relative overflow-hidden">
          {/* 背景装饰 */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-orange-100/50 to-transparent rounded-full blur-3xl -z-10 translate-x-1/3 -translate-y-1/3 pointer-events-none"></div>
          
          <div className="text-center mb-8">
            <div className={`w-20 h-20 mx-auto rounded-2xl flex items-center justify-center mb-4 transition-all duration-500 ${
              checkedIn 
                ? 'bg-gradient-to-br from-green-400 to-emerald-500 shadow-lg shadow-emerald-500/30 rotate-3 scale-105' 
                : 'bg-gradient-to-br from-orange-400 to-orange-500 shadow-lg shadow-orange-500/30'
            }`}>
              {checkedIn ? (
                <Check className="w-10 h-10 text-white" />
              ) : (
                <CalendarDays className="w-10 h-10 text-white" />
              )}
            </div>
            
            <h1 className="text-2xl font-bold text-stone-800 mb-2">
              {checkedIn ? '今日已签到' : '每日签到'}
            </h1>
            <p className="text-stone-500 text-sm">
              {checkedIn 
                ? '明天记得再来哦！' 
                : '签到可获得一次额外抽奖机会'}
            </p>
            
            {/* 显示奖励信息 */}
            {checkedIn && checkinResult?.quotaDisplay && (
              <div className="mt-4 p-3 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-200">
                <div className="flex items-center justify-center gap-2 text-amber-700">
                  <Sparkles className="w-4 h-4" />
                  <span className="text-sm font-medium">
                    获得额度：{checkinResult.quotaDisplay}
                  </span>
                </div>
              </div>
            )}
            
            {/* 显示抽奖次数 */}
            {extraSpins > 0 && (
              <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-100 text-orange-700 rounded-full text-sm font-medium">
                <Gift className="w-3.5 h-3.5" />
                剩余 {extraSpins} 次额外抽奖
              </div>
            )}
          </div>

          <div className="space-y-4">
            <button
              onClick={handleCheckin}
              disabled={checkedIn || submitting}
              className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all duration-300 ${
                checkedIn
                  ? 'bg-stone-100 text-stone-400 cursor-default border border-stone-200'
                  : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/30 hover:shadow-orange-500/40 hover:-translate-y-0.5 active:translate-y-0'
              }`}
            >
              {submitting ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : checkedIn ? (
                <>
                  <Check className="w-5 h-5" />
                  已完成
                </>
              ) : (
                <>
                  <PartyPopper className="w-5 h-5" />
                  立即签到
                </>
              )}
            </button>

            {checkedIn && (
              <Link 
                href="/lottery"
                className="block w-full py-4 rounded-xl font-bold text-lg text-center bg-white/50 text-orange-600 border border-orange-200 hover:bg-white hover:border-orange-300 transition-all duration-300"
              >
                去抽奖 <Gift className="w-4 h-4 inline-block ml-1" />
              </Link>
            )}
          </div>

          {/* 底部提示 */}
          <div className="mt-8 pt-6 border-t border-stone-100 text-center">
            <p className="text-xs text-stone-400">
              签到数据同步自 New API 系统
              <br />
              每日 00:00 重置签到状态
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
