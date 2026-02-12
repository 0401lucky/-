'use client';

import { Zap, Layers } from 'lucide-react';

interface PlayerStatsProps {
  power: number;
  floorNumber: number;
  choicesCount: number;
}

export default function PlayerStats({ power, floorNumber, choicesCount }: PlayerStatsProps) {
  return (
    <div className="bg-white/90 backdrop-blur-md rounded-2xl p-5 shadow-sm border border-slate-100">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-yellow-50 border border-yellow-100 flex items-center justify-center">
            <Zap className="w-5 h-5 text-yellow-600" />
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">力量</div>
            <div className="text-2xl font-black text-slate-900 tabular-nums">{power}</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
            <Layers className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">当前层</div>
            <div className="text-2xl font-black text-slate-900 tabular-nums">{floorNumber}</div>
          </div>
        </div>

        <div className="text-center">
          <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">已选择</div>
          <div className="text-lg font-bold text-slate-600 tabular-nums">{choicesCount} 次</div>
        </div>
      </div>
    </div>
  );
}
