// src/app/games/farm/components/CropShop.tsx

'use client';

import type { CropId, FarmLevel } from '@/lib/types/farm';
import { getCropsForLevel } from '@/lib/farm-config';

interface CropShopProps {
  level: FarmLevel;
  unlockedCrops: CropId[];
  balance: number;
  actionLoading: boolean;
  error?: string | null;
  onSelect: (cropId: CropId) => void;
  onClose: () => void;
}

export default function CropShop({
  level,
  unlockedCrops,
  balance,
  actionLoading,
  error,
  onSelect,
  onClose,
}: CropShopProps) {
  const availableCrops = getCropsForLevel(level);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-hidden border border-white/60"
        onClick={e => e.stopPropagation()}
        style={{ animation: 'farmPlotEntrance 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}
      >
        {/* 头部 */}
        <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-6 py-4 flex items-center justify-between relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.15),transparent_50%)]" />
          <div className="flex items-center gap-2 relative z-10">
            <span className="text-xl">🌱</span>
            <h3 className="font-bold text-lg">种子商店</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-all relative z-10 active:scale-90"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-2 bg-green-50/80 text-sm text-green-700 flex items-center gap-1.5 border-b border-green-100/60">
          <span>⭐</span>
          <span>余额: <b>{balance}</b> 积分</span>
        </div>

        {actionLoading && (
          <div className="mx-4 mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-center text-sm text-blue-700">
            已加入种植队列，正在依次处理...
          </div>
        )}

        {!actionLoading && error && (
          <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-600">
            {error}
          </div>
        )}

        {/* 作物列表 */}
        <div className="p-4 overflow-y-auto max-h-[60vh] space-y-2">
          {availableCrops.map((crop, index) => {
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
                    : 'border-green-200/60 bg-green-50/50 hover:bg-green-100 hover:border-green-300 hover:shadow-md active:scale-[0.98]'
                  }`}
                style={{
                  animation: `farmShopItemSlide 0.4s ease-out both`,
                  animationDelay: `${index * 50 + 100}ms`,
                }}
              >
                <span className="text-3xl drop-shadow-sm">{crop.icon}</span>
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
