// src/app/games/farm/components/FarmHeader.tsx

'use client';

import Link from 'next/link';
import type { FarmState } from '@/lib/types/farm';
import { FARM_LEVELS } from '@/lib/farm-config';
import type { FarmLevel } from '@/lib/types/farm';

interface FarmHeaderProps {
  farmState: FarmState;
  balance: number;
  dailyEarned: number;
  dailyLimit: number;
  pointsLimitReached: boolean;
}

export default function FarmHeader({
  farmState,
  balance,
  dailyEarned,
  dailyLimit,
  pointsLimitReached,
}: FarmHeaderProps) {
  const levelConfig = FARM_LEVELS[farmState.level];
  const nextLevel = (farmState.level < 5 ? farmState.level + 1 : 5) as FarmLevel;
  const nextLevelConfig = FARM_LEVELS[nextLevel];
  const expProgress = farmState.level >= 5
    ? 1
    : (farmState.exp - levelConfig.expRequired) / (nextLevelConfig.expRequired - levelConfig.expRequired);

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 space-y-4">
      {/* 顶部信息行 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-xl shadow-md">
            🌻
          </div>
          <div>
            <div className="font-bold text-slate-800">
              Lv.{farmState.level} {levelConfig.title}
            </div>
            <div className="text-xs text-slate-400">
              田地 {farmState.plots.length} 块 | 累计收获 {farmState.totalHarvests} 次
            </div>
          </div>
        </div>

        <Link
          href="/games"
          className="text-sm text-slate-500 hover:text-slate-800 transition-colors flex items-center gap-1"
        >
          <span className="hover:-translate-x-0.5 transition-transform inline-block">←</span>
          返回
        </Link>
      </div>

      {/* 经验条 */}
      {farmState.level < 5 && (
        <div>
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>经验 {farmState.exp} / {nextLevelConfig.expRequired}</span>
            <span>Lv.{nextLevel} {nextLevelConfig.title}</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-400 to-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, expProgress * 100))}%` }}
            />
          </div>
        </div>
      )}

      {/* 积分信息 */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-yellow-500">⭐</span>
          <span className="font-bold text-slate-800">{balance}</span>
          <span className="text-slate-400">积分</span>
        </div>
        <div className="text-slate-300">|</div>
        <div className="flex items-center gap-1.5">
          <span className={pointsLimitReached ? 'text-orange-500 font-bold' : 'text-green-600 font-bold'}>
            {dailyEarned}
          </span>
          <span className="text-slate-300">/</span>
          <span className="text-slate-400">{dailyLimit}</span>
          <span className="text-slate-400">今日积分</span>
          {pointsLimitReached && (
            <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">已达上限</span>
          )}
        </div>
      </div>
    </div>
  );
}
