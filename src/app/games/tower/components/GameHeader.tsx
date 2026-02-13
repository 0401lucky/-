'use client';

import { Zap, Shield, Flame } from 'lucide-react';
import { floorToPoints, formatPower } from '@/lib/tower-engine';
import type { BuffType, TowerDifficulty, ThemeFloorType, ActiveBlessing, ActiveCurse } from '@/lib/tower-engine';
import {
  BUFF_ICONS, BUFF_LABELS,
  DIFFICULTY_LABELS,
  BLESSING_ICONS, BLESSING_LABELS,
  CURSE_ICONS, CURSE_LABELS,
} from '@/lib/tower-engine';

interface GameHeaderProps {
  floorNumber: number;
  power: number;
  choicesCount: number;
  powerChanged?: boolean;
  hasShield?: boolean;
  shieldCount?: number;
  isBossFloor?: boolean;
  isShopFloor?: boolean;
  combo?: number;
  buffs?: BuffType[];
  difficulty?: TowerDifficulty;
  themeFloor?: ThemeFloorType;
  blessings?: ActiveBlessing[];
  curses?: ActiveCurse[];
}

const THEME_BG: Record<ThemeFloorType, string> = {
  gambling: 'bg-violet-50/90 backdrop-blur-md border border-violet-300',
  treasure: 'bg-amber-50/90 backdrop-blur-md border border-amber-300',
  hell_theme: 'bg-red-50/90 backdrop-blur-md border border-red-300',
  chaos: 'bg-gradient-to-r from-purple-50/90 to-cyan-50/90 backdrop-blur-md border border-purple-200',
};

export default function GameHeader({
  floorNumber,
  power,
  choicesCount,
  powerChanged,
  shieldCount = 0,
  isBossFloor,
  isShopFloor,
  combo = 0,
  buffs = [],
  difficulty,
  themeFloor,
  blessings = [],
  curses = [],
}: GameHeaderProps) {
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

  const headerBg = themeFloor
    ? THEME_BG[themeFloor]
    : isBossFloor
      ? 'bg-red-50/90 backdrop-blur-md border border-red-200'
      : isShopFloor
        ? 'bg-purple-50/90 backdrop-blur-md border border-purple-200'
        : 'bg-white/90 backdrop-blur-md border border-slate-100';

  return (
    <div className={`sticky top-0 z-30 ${headerBg} shadow-sm transition-colors duration-500`}>
      {/* 顶部状态栏 */}
      <div className="flex items-center justify-between px-4 py-2 gap-2">

        {/* 左侧：层数与难度 */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center justify-center w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-600 border border-indigo-200/50 shadow-inner">
            <span className="text-[10px] font-bold leading-none uppercase opacity-60">Floor</span>
            <span className="text-xl font-black leading-tight tabular-nums">{floorNumber}</span>
          </div>

          <div className="flex flex-col gap-1">
            {difficulty && (
              <span className={`text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full w-fit ${difficulty === 'hell' ? 'bg-red-100 text-red-600' :
                difficulty === 'hard' ? 'bg-orange-100 text-orange-600' :
                  'bg-emerald-100 text-emerald-600'
                }`}>
                {DIFFICULTY_LABELS[difficulty]}
              </span>
            )}
            <div className="flex items-center gap-1 text-xs font-medium text-slate-500">
              <span className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div className={`h-full ${progressColor} transition-all duration-500`} style={{ width: `${progressPercent}%` }} />
              </span>
              <span className="text-[10px] tabular-nums">{floorNumber}/50</span>
            </div>
          </div>
        </div>

        {/* 中间：力量值 (核心属性) */}
        <div className="flex-1 flex justify-center">
          <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full border border-amber-200/50 shadow-sm transition-transform duration-200 ${powerChanged ? 'bg-amber-100 scale-110' : 'bg-white/50'
            }`}>
            <div className="p-1.5 bg-amber-100 rounded-full text-amber-600">
              <Zap className="w-4 h-4 fill-current" />
            </div>
            <span className={`text-2xl font-black text-slate-800 tabular-nums`}>
              {formatPower(power)}
            </span>
          </div>
        </div>

        {/* 右侧：护盾、Combo、得分 */}
        <div className="flex items-center gap-2">
          {/* 护盾 */}
          <div className={`relative flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-300 ${shieldCount > 0
            ? 'bg-blue-50 text-blue-500 shadow-sm border border-blue-200'
            : 'bg-transparent text-slate-300'
            }`}>
            <Shield className="w-6 h-6" />
            {shieldCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
                {shieldCount}
              </span>
            )}
          </div>

          {/* 得分 (紧凑模式) */}
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Score</span>
            <span className="text-sm font-black text-emerald-600 tabular-nums">{estimatedScore}</span>
          </div>
        </div>
      </div>

      {/* 下方状态条：Combo, Buffs, Debuffs */}
      {(combo > 0 || buffs.length > 0 || blessings.length > 0 || curses.length > 0) && (
        <div className="flex items-center gap-2 px-4 pb-2 text-xs overflow-x-auto no-scrollbar mask-linear-fade">
          {/* Combo */}
          {combo > 0 && (
            <div className={`flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-lg border font-bold ${combo >= 3
              ? 'bg-red-50 text-red-600 border-red-200 animate-pulse'
              : 'bg-orange-50 text-orange-600 border-orange-200'
              }`}>
              <Flame className="w-3 h-3 fill-current" />
              <span>Combo x{combo}</span>
            </div>
          )}

          {/* Buffs */}
          {buffs.map(buff => (
            <div key={buff} className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-100 rounded-lg">
              {BUFF_ICONS[buff]}
              <span className="font-semibold">{BUFF_LABELS[buff]}</span>
            </div>
          ))}

          {/* Blessings */}
          {blessings.map(b => (
            <div key={b.type} className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg">
              {BLESSING_ICONS[b.type]}
              <span className="font-semibold">{BLESSING_LABELS[b.type]}</span>
              <span className="bg-amber-100 text-amber-600 px-1 rounded-full text-[9px]">{b.remainingFloors}</span>
            </div>
          ))}

          {/* Curses */}
          {curses.map(c => (
            <div key={c.type} className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded-lg">
              {CURSE_ICONS[c.type]}
              <span className="font-semibold">{CURSE_LABELS[c.type]}</span>
              <span className="bg-red-100 text-red-600 px-1 rounded-full text-[9px]">{c.remainingFloors}</span>
            </div>
          ))}
        </div>
      )}

      {/* 进度条底线 */}
      <div className="absolute bottom-0 left-0 w-full h-[2px] bg-slate-100/50">
        <div
          className={`h-full ${progressColor} transition-all duration-300 ease-out shadow-[0_0_10px_rgba(0,0,0,0.2)]`}
          style={{ width: `${progressPercent}%`, opacity: 0.7 }}
        />
      </div>
    </div>
  );
}
