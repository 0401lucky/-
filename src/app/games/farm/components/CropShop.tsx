// src/app/games/farm/components/CropShop.tsx

'use client';

import type { CropId, FarmLevel } from '@/lib/types/farm';
import { getCropsForLevel } from '@/lib/farm-config';

interface CropShopProps {
  level: FarmLevel;
  unlockedCrops: CropId[];
  balance: number;
  onSelect: (cropId: CropId) => void;
  onClose: () => void;
}

export default function CropShop({ level, unlockedCrops, balance, onSelect, onClose }: CropShopProps) {
  const availableCrops = getCropsForLevel(level);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌱</span>
            <h3 className="font-bold text-lg">种子商店</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-2 bg-green-50 text-sm text-green-700 flex items-center gap-1.5">
          <span>⭐</span>
          <span>余额: <b>{balance}</b> 积分</span>
        </div>

        {/* 作物列表 */}
        <div className="p-4 overflow-y-auto max-h-[60vh] space-y-2">
          {availableCrops.map(crop => {
            const isUnlocked = unlockedCrops.includes(crop.id);
            const canAfford = balance >= crop.seedCost;
            const disabled = !isUnlocked || !canAfford;

            return (
              <button
                key={crop.id}
                onClick={() => !disabled && onSelect(crop.id)}
                disabled={disabled}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left
                  ${disabled
                    ? 'opacity-50 cursor-not-allowed border-slate-100 bg-slate-50'
                    : 'border-green-200 bg-green-50/50 hover:bg-green-100 hover:border-green-300 hover:shadow-sm active:scale-[0.99]'
                  }`}
              >
                <span className="text-3xl">{crop.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-800">{crop.name}</div>
                  <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                    <span>⏱ {formatGrowthTime(crop.growthTime)}</span>
                    <span>→</span>
                    <span className="text-green-600 font-medium">+{crop.baseYield} 积分</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-bold ${canAfford ? 'text-amber-600' : 'text-red-400'}`}>
                    {crop.seedCost} ⭐
                  </div>
                  {!isUnlocked && (
                    <div className="text-xs text-slate-400">Lv.{crop.unlockLevel} 解锁</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatGrowthTime(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 60) return `${minutes}分钟`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours}小时`;
  return `${Math.floor(hours / 24)}天`;
}
