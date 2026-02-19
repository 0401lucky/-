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

    // 动态导入 canvas-confetti
    import('canvas-confetti').then(mod => {
      const confetti = mod.default;
      confetti({
        particleCount: 60,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#10b981', '#f59e0b', '#ef4444', '#3b82f6'],
      });
    }).catch(() => {});
  }, []);

  const { harvest } = result;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-[bounceIn_0.4s_ease-out]"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="bg-gradient-to-r from-amber-400 to-orange-500 text-white px-6 py-5 text-center">
          <span className="text-5xl block mb-2">{harvest.cropIcon}</span>
          <h3 className="text-xl font-bold">收获成功！</h3>
          <p className="text-amber-100 text-sm mt-1">{harvest.cropName}</p>
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
            <span className="text-xl font-bold text-amber-600">+{result.pointsEarned} ⭐</span>
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
            <div className="bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-xl p-4 text-center space-y-1">
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
            className="w-full py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-semibold rounded-xl hover:shadow-lg transition-all active:scale-[0.98]"
          >
            继续种地
          </button>
        </div>
      </div>
    </div>
  );
}
