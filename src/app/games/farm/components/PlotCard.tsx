// src/app/games/farm/components/PlotCard.tsx

'use client';

import type { ComputedPlotState } from '@/lib/types/farm';
import { CROPS, WATER_MISS_PENALTY } from '@/lib/farm-config';

interface PlotCardProps {
  plot: ComputedPlotState;
  onPlant: () => void;
  onWater: () => void;
  onHarvest: () => void;
  onRemovePest: () => void;
  onRemoveCrop: () => void;
}

const stageAnimation: Record<string, string> = {
  seed: 'animate-farm-seed',
  sprout: 'animate-farm-sprout',
  growing: 'animate-farm-grow',
  mature: 'animate-farm-mature',
  withered: 'animate-farm-wither',
};

export default function PlotCard({
  plot,
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
        className="aspect-square rounded-2xl border-2 border-dashed border-slate-200/60 bg-white/30 backdrop-blur-sm hover:border-green-400 hover:bg-green-50/50 transition-all flex flex-col items-center justify-center gap-1 group disabled:opacity-50 animate-farm-empty-breath active:scale-95"
      >
        <span className="text-2xl opacity-30 group-hover:opacity-70 transition-all group-hover:scale-110 duration-300">🌱</span>
        <span className="text-xs text-slate-400 group-hover:text-green-600 transition-colors font-medium">种植</span>
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
    seed: 'from-amber-50/80 to-yellow-50/80 border-amber-200/60',
    sprout: 'from-lime-50/80 to-green-50/80 border-lime-200/60',
    growing: 'from-green-50/80 to-emerald-50/80 border-green-300/60',
    mature: 'from-yellow-50/80 to-amber-50/80 border-amber-400/80 ring-2 ring-amber-200/50',
    withered: 'from-gray-100/80 to-slate-100/80 border-gray-300/60',
  };

  const progressPercent = Math.min(100, Math.floor(plot.growthProgress * 100));
  const waterPenaltyPercent = Math.round(plot.missedWaterCycles * WATER_MISS_PENALTY * 100);

  return (
    <div className={`aspect-square rounded-2xl border-2 bg-gradient-to-br backdrop-blur-sm ${stageBg[plot.stage]} relative overflow-hidden flex flex-col items-center justify-center p-2 transition-all shadow-sm hover:shadow-md`}>
      {/* 土壤纹理 */}
      <div className="absolute bottom-0 left-0 right-0 h-1/4 bg-gradient-to-t from-amber-900/10 to-transparent rounded-b-2xl" />

      {/* 害虫标记 */}
      {plot.hasPest && (
        <button
          onClick={onRemovePest}
          className="absolute top-1 right-1 z-10 animate-farm-pest"
          title="点击除虫"
        >
          <span className="text-lg drop-shadow-sm">🐛</span>
        </button>
      )}

      {/* 作物图标 */}
      <span className={`text-3xl sm:text-4xl ${plot.stage === 'withered' ? 'grayscale' : ''} ${stageAnimation[plot.stage]} inline-block drop-shadow-md`}>
        {stageIcons[plot.stage]}
      </span>

      {/* 作物名 */}
      <div className="text-xs font-medium text-slate-600 mt-1 truncate w-full text-center">
        {crop?.name}
      </div>

      {/* 进度条 */}
      {plot.stage !== 'mature' && plot.stage !== 'withered' && (
        <div className="w-full mt-1 px-1">
          <div className="h-1.5 bg-white/60 rounded-full overflow-hidden shadow-inner">
            <div
              className="h-full rounded-full transition-all duration-1000 relative"
              style={{
                width: `${progressPercent}%`,
                background: 'linear-gradient(90deg, #4ade80, #10b981, #4ade80)',
                backgroundSize: '200% 100%',
                animation: 'farmProgressShimmer 2s linear infinite',
              }}
            />
          </div>
          <div className="text-center text-[10px] text-slate-400 mt-0.5 font-medium">
            {progressPercent}%
          </div>
        </div>
      )}

      {/* 需要浇水提示 */}
      {plot.needsWater && plot.stage !== 'withered' && plot.stage !== 'mature' && (
        <div className="absolute top-1 left-1">
          <span className="text-sm inline-block" style={{ animation: 'farmWaterDrop 1.5s ease-in-out infinite' }} title="需要浇水">💧</span>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="absolute bottom-1 left-1 right-1 flex gap-1 justify-center">
        {plot.stage === 'mature' && (
          <button
            onClick={onHarvest}
            className="text-xs bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white px-2.5 py-1 rounded-full font-medium transition-all disabled:opacity-50 shadow-md shadow-amber-500/25 active:scale-90"
          >
            收获
          </button>
        )}
        {plot.needsWater && plot.stage !== 'withered' && plot.stage !== 'mature' && (
          <button
            onClick={onWater}
            className="text-xs bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white px-2.5 py-1 rounded-full font-medium transition-all disabled:opacity-50 shadow-md shadow-blue-500/25 active:scale-90"
          >
            浇水
          </button>
        )}
        {plot.stage === 'withered' && (
          <button
            onClick={onRemoveCrop}
            className="text-xs bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 text-white px-2.5 py-1 rounded-full font-medium transition-all disabled:opacity-50 shadow-md shadow-red-500/25 active:scale-90"
          >
            铲除
          </button>
        )}
      </div>

      {/* 产量预估 */}
      {plot.stage === 'mature' && plot.estimatedYield > 0 && (
        <div className="absolute top-1 left-1 text-[10px] bg-amber-100/90 text-amber-700 px-1.5 py-0.5 rounded-full font-bold shadow-sm">
          +{plot.estimatedYield}⭐
        </div>
      )}

      {/* 减产警告 */}
      {plot.missedWaterCycles > 0 && plot.stage !== 'withered' && (
        <div className="absolute top-1 left-1 text-[10px] bg-red-100/90 text-red-600 px-1.5 py-0.5 rounded-full font-bold shadow-sm">
          -{waterPenaltyPercent}%
        </div>
      )}
    </div>
  );
}
