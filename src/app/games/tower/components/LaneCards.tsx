'use client';

import type { TowerFloor, TowerLaneContent, BuffType, ThemeFloorType, ActiveBlessing, ActiveCurse } from '@/lib/tower-engine';
import { BUFF_LABELS, BUFF_DESCRIPTIONS, THEME_ICONS } from '@/lib/tower-engine';
import {
  HelpCircle, Ghost, Skull, Shield, Plus, X as XIcon, ShoppingBag, Bomb, Wind
} from 'lucide-react';

type AnimState = 'idle' | 'walking' | 'attacking' | 'powerup' | 'death' | 'nextFloor' | 'revealing' | 'shieldBlock' | 'bossDefeated' | 'trapped' | 'shopping';

interface LaneCardsProps {
  floor: TowerFloor;
  playerPower: number;
  onChooseLane: (index: number) => void;
  disabled: boolean;
  selectedLane: number | null;
  animState: AnimState;
  revealedLane?: TowerLaneContent | null;
  hasShield?: boolean;
  shieldCount?: number;
  combo?: number;
  buffs?: BuffType[];
  blessings?: ActiveBlessing[];
  curses?: ActiveCurse[];
}

const THEME_BANNER: Record<ThemeFloorType, { gradient: string; text: string }> = {
  gambling: { gradient: 'from-violet-500 to-amber-500', text: '赌博层 — 全部迷雾，命运未知' },
  treasure: { gradient: 'from-amber-400 to-yellow-500', text: '宝藏层 — 丰厚奖励等着你' },
  hell_theme: { gradient: 'from-red-600 to-rose-700', text: '地狱层 — 全是怪物' },
  chaos: { gradient: 'from-purple-500 via-cyan-400 to-pink-500', text: '混沌层 — 危机四伏' },
};

export default function LaneCards({
  floor,
  playerPower,
  onChooseLane,
  disabled,
  selectedLane,
  animState,
  revealedLane,
  hasShield,
  combo = 0,
  buffs = [],
  blessings = [],
  curses = [],
}: LaneCardsProps) {
  const isAnimating = animState !== 'idle';
  const hasEagleEye = buffs.includes('eagle_eye');
  const hasInsightEye = blessings.some(b => b.type === 'insight_eye');
  const canSeeThrough = hasEagleEye || hasInsightEye;

  // 计算有效攻击力（用于 hint 显示）
  const hasFlame = blessings.some(b => b.type === 'flame_power');
  const hasWeakness = curses.some(c => c.type === 'weakness');
  let effectivePower = playerPower;
  if (hasFlame) effectivePower = Math.floor(playerPower * 1.5);
  if (hasWeakness) effectivePower = Math.floor(effectivePower * 0.75);

  const hasGolden = blessings.some(b => b.type === 'golden_touch');

  // 混沌层超过3列时缩小卡片
  const isChaos = floor.theme === 'chaos' && floor.lanes.length > 3;

  return (
    <div key={floor.floor} className="animate-slide-up w-full">
      {/* Boss 层标题 */}
      {floor.isBoss && (
        <div className="text-center mb-4">
          <span className="inline-flex items-center gap-1 px-4 py-1.5 bg-gradient-to-r from-red-500 to-orange-600 text-white text-sm font-bold rounded-full shadow-lg animate-boss-glow ring-2 ring-red-200">
            <span className="text-lg">💀</span> BOSS 层
          </span>
        </div>
      )}

      {/* 商店层标题 */}
      {floor.isShop && (
        <div className="text-center mb-4">
          <span className="inline-flex items-center gap-1 px-4 py-1.5 bg-gradient-to-r from-purple-500 to-pink-600 text-white text-sm font-bold rounded-full shadow-lg animate-shop-glow ring-2 ring-purple-200">
            <span className="text-lg">🛍️</span> 商店层 — 选择一个永久增益
          </span>
        </div>
      )}

      {/* 主题层标题 */}
      {floor.theme && THEME_BANNER[floor.theme] && (
        <div className="text-center mb-4">
          <span className={`inline-flex items-center gap-1 px-4 py-1.5 bg-gradient-to-r ${THEME_BANNER[floor.theme].gradient} text-white text-sm font-bold rounded-full shadow-lg ring-2 ring-white/30`}>
            {THEME_ICONS[floor.theme]} {THEME_BANNER[floor.theme].text}
          </span>
        </div>
      )}

      <div className={`flex gap-3 justify-center px-1 ${isChaos ? 'flex-wrap' : ''}`}>
        {floor.lanes.map((lane, i) => {
          const isSelected = selectedLane === i;
          const isOther = selectedLane !== null && !isSelected;

          // 鹰眼 buff 或 洞察之眼祝福：迷雾通道变透明
          const effectiveLane = (canSeeThrough && lane.type === 'mystery') ? lane.hidden : lane;

          // 迷雾揭示：选中的迷雾卡片切换为揭示后的内容渲染
          const displayLane = (isSelected && animState === 'revealing' && revealedLane)
            ? revealedLane
            : (isSelected && revealedLane && animState !== 'walking' && animState !== 'idle')
              ? revealedLane
              : effectiveLane;

          return (
            <button
              key={i}
              onClick={() => onChooseLane(i)}
              disabled={disabled}
              className={`
                relative isolate overflow-hidden
                ${isChaos ? 'min-w-[100px] flex-1' : 'flex-1 max-w-[160px] aspect-[3/4]'} 
                rounded-3xl p-3 transition-all duration-300 border
                flex flex-col items-center justify-center gap-1
                ${disabled ? 'cursor-not-allowed contrast-75' : 'cursor-pointer hover:-translate-y-2 hover:shadow-xl active:scale-95 active:shadow-sm'}
                ${isSelected ? 'z-10 ring-4 ring-offset-2 ring-offset-slate-50 scale-105 shadow-2xl' : 'hover:scale-105'}
                ${isOther && isAnimating ? 'opacity-30 scale-90 blur-[1px]' : ''}
                ${isSelected && animState === 'revealing' ? 'animate-flip' : ''}
                ${isSelected && animState === 'trapped' ? 'animate-shake' : ''}
                ${getCardStyle(displayLane, effectivePower, isSelected, animState)}
              `}
            >
              {/* 卡片光泽效果 */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent opacity-50 pointer-events-none" />

              {/* 此处省略部分原有代码，仅调整样式 */}
              <div className={`text-4xl filter drop-shadow-sm transition-transform duration-300 ${getIconAnim(displayLane, isSelected, animState)}`}>
                {getIcon(displayLane, canSeeThrough)}
              </div>

              <div className="font-black text-slate-800 text-lg leading-tight w-full truncate">
                {getLabel(displayLane, canSeeThrough)}
              </div>

              <div className={`text-xs font-bold px-2 py-0.5 rounded-full bg-white/50 backdrop-blur-sm shadow-sm ${getHintColor(displayLane, effectivePower, hasShield)}`}>
                {getHint(displayLane, playerPower, effectivePower, hasShield, combo, buffs, hasGolden)}
              </div>

              {/* 商店卡片额外描述 */}
              {displayLane.type === 'shop' && (
                <div className="text-[10px] text-purple-600 font-medium px-1 leading-tight line-clamp-2">
                  {BUFF_DESCRIPTIONS[displayLane.buff]}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}


function getIcon(lane: TowerLaneContent, seeThrough?: boolean): React.ReactNode {
  if (lane.type === 'mystery') {
    if (seeThrough) return getIcon(lane.hidden);
    return <HelpCircle className="w-10 h-10 text-purple-400" />;
  }
  if (lane.type === 'monster') return <Ghost className="w-10 h-10 text-red-500" />;
  if (lane.type === 'boss') return <Skull className="w-10 h-10 text-red-700" />;
  if (lane.type === 'shield') return <Shield className="w-10 h-10 text-blue-500" />;
  if (lane.type === 'add') return <Plus className="w-10 h-10 text-green-500" />;
  if (lane.type === 'multiply') return <XIcon className="w-10 h-10 text-amber-500" />;
  if (lane.type === 'shop') return <ShoppingBag className="w-10 h-10 text-purple-500" />;
  if (lane.type === 'trap') return lane.subtype === 'sub' ? <Bomb className="w-10 h-10 text-slate-700" /> : <Wind className="w-10 h-10 text-slate-500" />;
  return <HelpCircle className="w-10 h-10 text-slate-300" />;
}

function getLabel(lane: TowerLaneContent, seeThrough?: boolean): string {
  if (lane.type === 'mystery') {
    if (seeThrough) return getLabel(lane.hidden);
    return '???';
  }
  if (lane.type === 'monster') return `${lane.value}`;
  if (lane.type === 'boss') return `${lane.value}`;
  if (lane.type === 'shield') return '护盾';
  if (lane.type === 'add') return `+${lane.value}`;
  if (lane.type === 'multiply') return `×${lane.value}`;
  if (lane.type === 'shop') return BUFF_LABELS[lane.buff];
  if (lane.type === 'trap') return lane.subtype === 'sub' ? `-${lane.value}` : `÷${lane.value}`;
  return '???';
}

function getHint(
  lane: TowerLaneContent,
  rawPower: number,
  effectivePower: number,
  hasShield?: boolean,
  combo?: number,
  buffs?: BuffType[],
  hasGolden?: boolean,
): string {
  if (lane.type === 'mystery') return '未知';
  if (lane.type === 'boss') {
    if (effectivePower > lane.value) {
      let gain = lane.value * 2;
      if (hasGolden) gain *= 2;
      return `+${gain}`;
    }
    if (hasShield) return '抵挡';
    return '危险';
  }
  if (lane.type === 'monster') {
    if (effectivePower > lane.value) {
      let gain = lane.value;
      if (hasGolden) gain *= 2;
      const comboText = (combo && combo > 0) ? `+🔥` : '';
      return `+${gain}${comboText}`;
    }
    if (hasShield) return '抵挡';
    return '危险';
  }
  if (lane.type === 'shield') {
    if (hasShield) return `+${lane.value}`;
    return '获得';
  }
  if (lane.type === 'add') {
    const hasLucky = buffs?.includes('lucky');
    let v = hasLucky ? Math.floor(lane.value * 1.3) : lane.value;
    if (hasGolden) v *= 2;
    return `+${v}`;
  }
  if (lane.type === 'multiply') {
    const hasLucky = buffs?.includes('lucky');
    let v = hasLucky ? lane.value + 1 : lane.value;
    if (hasGolden) v *= 2;
    return `x${v}`;
  }
  if (lane.type === 'shop') return '购买';
  if (lane.type === 'trap') {
    if (lane.subtype === 'sub') return `-${lane.value}`;
    return `÷${lane.value}`;
  }
  return '';
}

function getHintColor(lane: TowerLaneContent, power: number, hasShield?: boolean): string {
  if (lane.type === 'mystery') return 'text-purple-600';
  if (lane.type === 'boss') {
    if (power > lane.value) return 'text-green-600';
    if (hasShield) return 'text-blue-600';
    return 'text-red-600';
  }
  if (lane.type === 'monster') {
    if (power > lane.value) return 'text-green-600';
    if (hasShield) return 'text-blue-600';
    return 'text-red-600';
  }
  if (lane.type === 'shield') return 'text-blue-600';
  if (lane.type === 'shop') return 'text-purple-600';
  if (lane.type === 'trap') return 'text-red-500';
  return 'text-green-600';
}

function getCardStyle(
  lane: TowerLaneContent,
  power: number,
  isSelected: boolean,
  animState: AnimState,
): string {


  if (lane.type === 'mystery') {
    return `bg-gradient-to-br from-indigo-50 to-purple-50 border-purple-200 hover:border-purple-300 text-purple-900`;
  }

  if (lane.type === 'boss') {
    if (isSelected && animState === 'bossDefeated') {
      return `bg-gradient-to-br from-orange-100 to-red-100 border-orange-400 ring-orange-300`;
    }
    const canBeat = power > lane.value;
    if (canBeat) {
      return `bg-gradient-to-br from-orange-50 to-amber-50 border-orange-200 hover:border-orange-300 hover:shadow-orange-100`;
    }
    return `bg-gradient-to-br from-red-50 to-orange-50 border-red-200 hover:border-red-300`;
  }

  if (lane.type === 'shield') {
    if (isSelected && animState === 'powerup') {
      return `bg-blue-50 border-blue-400 ring-blue-200`;
    }
    return `bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-200 hover:border-blue-300 hover:shadow-blue-100`;
  }

  if (lane.type === 'shop') {
    if (isSelected && animState === 'shopping') {
      return `bg-purple-50 border-purple-400 ring-purple-200`;
    }
    return `bg-gradient-to-br from-purple-50 to-pink-50 border-purple-200 hover:border-purple-300 hover:shadow-purple-100`;
  }

  if (lane.type === 'trap') {
    if (isSelected && animState === 'trapped') {
      return `bg-red-50 border-red-400 ring-red-200`;
    }
    return `bg-gradient-to-br from-red-50 to-rose-50 border-red-200 hover:border-red-300 hover:shadow-red-100`;
  }

  if (lane.type === 'monster') {
    const canBeat = power > lane.value;
    if (isSelected && animState === 'attacking') {
      return `bg-red-50 border-red-400 ring-red-200`;
    }
    if (canBeat) {
      return `bg-gradient-to-br from-slate-50 to-red-50 border-slate-200 hover:border-red-300 hover:shadow-red-50`;
    }
    return `bg-gradient-to-br from-red-50 to-slate-50 border-red-300 hover:border-red-400 hover:shadow-red-100`;
  }

  if (lane.type === 'add') {
    if (isSelected && animState === 'powerup') {
      return `bg-green-50 border-green-400 ring-green-200`;
    }
    return `bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200 hover:border-emerald-300 hover:shadow-emerald-100`;
  }

  // multiply
  if (isSelected && animState === 'powerup') {
    return `bg-yellow-50 border-yellow-400 ring-yellow-200`;
  }
  return `bg-gradient-to-br from-yellow-50 to-amber-50 border-yellow-200 hover:border-yellow-300 hover:shadow-yellow-100`;
}

function getIconAnim(
  lane: TowerLaneContent,
  isSelected: boolean,
  animState: AnimState
): string {
  if (!isSelected) return '';
  if (animState === 'attacking' || animState === 'bossDefeated') return 'scale-110';
  if (animState === 'powerup' || animState === 'shopping') return 'scale-110';
  if (animState === 'shieldBlock') return 'scale-110';
  if (animState === 'trapped') return 'scale-110';
  return '';
}
