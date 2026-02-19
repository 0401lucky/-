// src/app/games/farm/components/HarvestModal.tsx

'use client';

import { useEffect, useRef } from 'react';
import type { HarvestResult, LevelUpInfo } from '../hooks/useFarmState';

interface HarvestModalProps {
  result: HarvestResult;
  levelUp: LevelUpInfo | null;
  onClose: () => void;
}

export default function HarvestModal({ result, levelUp, onClose }: HarvestModalProps) {
  const confettiTriggered = useRef(false);

  useEffect(() => {
    if (confettiTriggered.current) return;
    confettiTriggered.current = true;

    import('canvas-confetti').then(mod => {
      const confetti = mod.default;
      // 先来一波大的
      confetti({
        particleCount: 80,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7'],
      });
      // 延迟再来一波小的
      setTimeout(() => {
        confetti({
          particleCount: 40,
          spread: 60,
          origin: { y: 0.5, x: 0.3 },
          colors: ['#fbbf24', '#34d399'],
        });
        confetti({
          particleCount: 40,
          spread: 60,
          origin: { y: 0.5, x: 0.7 },
          colors: ['#f97316', '#06b6d4'],
        });
      }, 200);
    }).catch(() => {});
  }, []);

  const { harvest } = result;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden border border-white/60"
        onClick={e => e.stopPropagation()}
        style={{ animation: 'farmPlotEntrance 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}
      >
        {/* 头部 */}
        <div className="bg-gradient-to-r from-amber-400 to-orange-500 text-white px-6 py-6 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.2),transparent_60%)]" />
          <span className="text-5xl block mb-2 relative z-10 drop-shadow-lg animate-farm-harvest">{harvest.cropIcon}</span>
          <h3 className="text-xl font-bold relative z-10">收获成功！</h3>
          <p className="text-amber-100 text-sm mt-1 relative z-10">{harvest.cropName}</p>
        </div>

        {/* 收益详情 */}
        <div className="p-6 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">基础产出</span>
            <span className="font-semibold text-slate-700">{harvest.baseYield} 积分</span>
          </div>

          {harvest.weatherBonus !== 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">天气加成</span>
              <span className={`font-semibold ${harvest.weatherBonus > 0 ? 'text-green-600' : 'text-red-500'}`}>
                {harvest.weatherBonus > 0 ? '+' : ''}{harvest.weatherBonus}%
              </span>
            </div>
          )}

          {harvest.waterBonus !== 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">浇水影响</span>
              <span className={`font-semibold ${harvest.waterBonus > 0 ? 'text-green-600' : 'text-red-500'}`}>
                {harvest.waterBonus > 0 ? '+' : ''}{harvest.waterBonus}%
              </span>
            </div>
          )}

          {harvest.pestPenalty > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">害虫减产</span>
              <span className="font-semibold text-red-500">-{harvest.pestPenalty}%</span>
            </div>
          )}

          <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
            <span className="text-slate-700 font-semibold">获得积分</span>
            <span className="text-xl font-bold text-amber-600 drop-shadow-sm">+{result.pointsEarned} ⭐</span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">获得经验</span>
            <span className="font-semibold text-green-600">+{result.expGained} EXP</span>
          </div>

          {result.limitReached && (
            <div className="text-center text-xs text-orange-500 bg-orange-50 rounded-lg py-2">
              今日积分已达上限，超出部分不计入
            </div>
          )}

          {/* 升级提示 */}
          {levelUp && (
            <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200/60 rounded-xl p-4 text-center space-y-1" style={{ animation: 'farmPlotEntrance 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s both' }}>
              <div className="text-2xl">🎉</div>
              <div className="font-bold text-purple-700">农场升级！</div>
              <div className="text-sm text-purple-600">
                Lv.{levelUp.newLevel} {levelUp.title}
              </div>
              <div className="text-xs text-purple-400">
                解锁更多田地和新作物！
              </div>
            </div>
          )}
        </div>

        {/* 关闭按钮 */}
        <div className="px-6 pb-5">
          <button
            onClick={onClose}
            className="w-full py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-green-500/25 transition-all active:scale-[0.97]"
          >
            继续种地
          </button>
        </div>
      </div>
    </div>
  );
}
