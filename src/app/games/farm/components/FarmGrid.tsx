// src/app/games/farm/components/FarmGrid.tsx

'use client';

import type { ComputedPlotState } from '@/lib/types/farm';
import PlotCard from './PlotCard';

interface FarmGridProps {
  plots: ComputedPlotState[];
  actionLoading: boolean;
  onPlant: (plotIndex: number) => void;
  onWater: (plotIndex: number) => void;
  onHarvest: (plotIndex: number) => void;
  onRemovePest: (plotIndex: number) => void;
  onRemoveCrop: (plotIndex: number) => void;
}

export default function FarmGrid({
  plots,
  actionLoading,
  onPlant,
  onWater,
  onHarvest,
  onRemovePest,
  onRemoveCrop,
}: FarmGridProps) {
  // 自适应列数
  const count = plots.length;
  let gridCols = 'grid-cols-2';
  if (count >= 9) gridCols = 'grid-cols-3 sm:grid-cols-4';
  else if (count >= 6) gridCols = 'grid-cols-3';

  return (
    <div className={`grid ${gridCols} gap-3`}>
      {plots.map((plot) => (
        <PlotCard
          key={plot.index}
          plot={plot}
          actionLoading={actionLoading}
          onPlant={() => onPlant(plot.index)}
          onWater={() => onWater(plot.index)}
          onHarvest={() => onHarvest(plot.index)}
          onRemovePest={() => onRemovePest(plot.index)}
          onRemoveCrop={() => onRemoveCrop(plot.index)}
        />
      ))}
    </div>
  );
}
