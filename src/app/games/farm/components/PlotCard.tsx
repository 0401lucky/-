// src/app/games/farm/components/PlotCard.tsx

'use client';

import type { ComputedPlotState } from '@/lib/types/farm';
import { CROPS } from '@/lib/farm-config';

interface PlotCardProps {
  plot: ComputedPlotState;
  actionLoading: boolean;
  onPlant: () => void;
  onWater: () => void;
  onHarvest: () => void;
  onRemovePest: () => void;
  onRemoveCrop: () => void;
}

export default function PlotCard({
  plot,
  actionLoading,
  onPlant,
  onWater,
  onHarvest,
  onRemovePest,
  onRemoveCrop,
}: PlotCardProps) {
  const isEmpty = !plot.cropId;
  const crop = plot.cropId ? CROPS[plot.cropId] : null;

  // 空地
  if (isEmpty) {
    return (
      <button
        onClick={onPlant}
        disabled={actionLoading}
        className="aspect-square rounded-2xl border-2 border-dashed border-slate-200 hover:border-green-400 hover:bg-green-50/50 transition-all flex flex-col items-center justify-center gap-1 group disabled:opacity-50"
      >
        <span className="text-2xl opacity-30 group-hover:opacity-60 transition-opacity">🌱</span>
        <span className="text-xs text-slate-400 group-hover:text-green-600 transition-colors">种植</span>
      </button>
    );
  }

  // 有作物
  const stageIcons: Record<string, string> = {
    seed: '🟤',
    sprout: '🌱',
    growing: crop?.icon ?? '🌿',
    mature: crop?.icon ?? '🌾',
    withered: '🥀',
  };

  const stageBg: Record<string, string> = {
    seed: 'from-amber-50 to-yellow-50 border-amber-200',
    sprout: 'from-lime-50 to-green-50 border-lime-200',
    growing: 'from-green-50 to-emerald-50 border-green-300',
    mature: 'from-yellow-50 to-amber-50 border-amber-400 ring-2 ring-amber-200',
    withered: 'from-gray-100 to-slate-100 border-gray-300',
  };

  const progressPercent = Math.min(100, Math.floor(plot.growthProgress * 100));

  return (
    <div className={`aspect-square rounded-2xl border-2 bg-gradient-to-br ${stageBg[plot.stage]} relative overflow-hidden flex flex-col items-center justify-center p-2 transition-all`}>
      {/* 害虫标记 */}
      {plot.hasPest && (
        <button
          onClick={onRemovePest}
          disabled={actionLoading}
          className="absolute top-1 right-1 z-10 animate-bounce"
          title="点击除虫"
        >
          <span className="text-lg">🐛</span>
        </button>
      )}

      {/* 作物图标 */}
      <span className={`text-3xl sm:text-4xl ${plot.stage === 'withered' ? 'grayscale' : ''} ${plot.stage === 'mature' ? 'animate-pulse' : ''}`}>
        {stageIcons[plot.stage]}
      </span>

      {/* 作物名 */}
      <div className="text-xs font-medium text-slate-600 mt-1 truncate w-full text-center">
        {crop?.name}
      </div>

      {/* 进度条 - 非成熟/枯萎时显示 */}
      {plot.stage !== 'mature' && plot.stage !== 'withered' && (
        <div className="w-full mt-1 px-1">
          <div className="h-1.5 bg-white/60 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-400 to-emerald-500 rounded-full transition-all duration-1000"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="text-center text-[10px] text-slate-400 mt-0.5">
            {progressPercent}%
          </div>
        </div>
      )}

      {/* 需要浇水提示 */}
      {plot.needsWater && plot.stage !== 'withered' && plot.stage !== 'mature' && (
        <div className="absolute top-1 left-1">
          <span className="text-sm animate-pulse" title="需要浇水">💧</span>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="absolute bottom-1 left-1 right-1 flex gap-1 justify-center">
        {plot.stage === 'mature' && (
          <button
            onClick={onHarvest}
            disabled={actionLoading}
            className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-2 py-0.5 rounded-full font-medium transition-colors disabled:opacity-50 shadow-sm"
          >
            收获
          </button>
        )}
        {plot.needsWater && plot.stage !== 'withered' && plot.stage !== 'mature' && (
          <button
            onClick={onWater}
            disabled={actionLoading}
            className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-2 py-0.5 rounded-full font-medium transition-colors disabled:opacity-50 shadow-sm"
          >
            浇水
          </button>
        )}
        {plot.stage === 'withered' && (
          <button
            onClick={onRemoveCrop}
            disabled={actionLoading}
            className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-0.5 rounded-full font-medium transition-colors disabled:opacity-50 shadow-sm"
          >
            铲除
          </button>
        )}
      </div>

      {/* 产量预估 */}
      {plot.stage === 'mature' && plot.estimatedYield > 0 && (
        <div className="absolute top-1 left-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
          +{plot.estimatedYield}⭐
        </div>
      )}

      {/* 减产警告 */}
      {plot.missedWaterCycles > 0 && plot.stage !== 'withered' && (
        <div className="absolute top-1 left-1 text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">
          -{plot.missedWaterCycles * 20}%
        </div>
      )}
    </div>
  );
}
