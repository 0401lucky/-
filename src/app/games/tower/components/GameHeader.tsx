'use client';

import { Layers, Zap, Star, Shield } from 'lucide-react';
import { floorToPoints } from '@/lib/tower-engine';

interface GameHeaderProps {
  floorNumber: number;
  power: number;
  choicesCount: number;
  powerChanged?: boolean;
  hasShield?: boolean;
  isBossFloor?: boolean;
}

export default function GameHeader({ floorNumber, power, choicesCount, powerChanged, hasShield, isBossFloor }: GameHeaderProps) {
  const estimatedScore = floorToPoints(choicesCount);

  // 进度条颜色随层数变化
  const progressColor =
    floorNumber <= 10
      ? 'bg-green-500'
      : floorNumber <= 20
        ? 'bg-yellow-500'
        : floorNumber <= 30
          ? 'bg-orange-500'
          : 'bg-red-500';

  // 进度百分比 (50层为满)
  const progressPercent = Math.min((floorNumber / 50) * 100, 100);

  const headerBg = isBossFloor
    ? 'bg-red-50/90 backdrop-blur-md border border-red-200'
    : 'bg-white/90 backdrop-blur-md border border-slate-100';

  return (
    <div className={`sticky top-0 z-20 ${headerBg} rounded-2xl shadow-sm mb-4 overflow-hidden transition-colors duration-300`}>
      <div className="flex items-center justify-between px-4 py-3">
        {/* 层数 */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
            <Layers className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold leading-none">层数</div>
            <div className="text-lg font-black text-slate-900 tabular-nums leading-tight">{floorNumber}</div>
          </div>
        </div>

        {/* 力量值 */}
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-1.5">
          <Zap className="w-5 h-5 text-amber-600" />
          <span className={`text-xl font-black text-amber-700 tabular-nums ${powerChanged ? 'animate-score-pop' : ''}`}>
            {power}
          </span>
        </div>

        {/* 护盾状态 */}
        <div className={`flex items-center justify-center w-9 h-9 rounded-xl border transition-colors duration-300 ${
          hasShield
            ? 'bg-blue-50 border-blue-200'
            : 'bg-slate-50 border-slate-200'
        }`}>
          <Shield className={`w-5 h-5 transition-colors duration-300 ${
            hasShield ? 'text-blue-500' : 'text-slate-300'
          }`} />
        </div>

        {/* 预估得分 */}
        <div className="flex items-center gap-2">
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-bold leading-none text-right">得分</div>
            <div className="text-lg font-black text-emerald-600 tabular-nums leading-tight">{estimatedScore}</div>
          </div>
          <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center">
            <Star className="w-4 h-4 text-emerald-600" />
          </div>
        </div>
      </div>

      {/* 进度条 */}
      <div className="h-1 bg-slate-100">
        <div
          className={`h-full ${progressColor} transition-all duration-500`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
