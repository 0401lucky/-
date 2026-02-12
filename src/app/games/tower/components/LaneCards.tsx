'use client';

import type { TowerFloor, TowerLaneContent } from '@/lib/tower-engine';

type AnimState = 'idle' | 'walking' | 'attacking' | 'powerup' | 'death' | 'nextFloor' | 'revealing' | 'shieldBlock' | 'bossDefeated';

interface LaneCardsProps {
  floor: TowerFloor;
  playerPower: number;
  onChooseLane: (index: number) => void;
  disabled: boolean;
  selectedLane: number | null;
  animState: AnimState;
  revealedLane?: TowerLaneContent | null;
  hasShield?: boolean;
}

export default function LaneCards({
  floor,
  playerPower,
  onChooseLane,
  disabled,
  selectedLane,
  animState,
  revealedLane,
  hasShield,
}: LaneCardsProps) {
  const isAnimating = animState !== 'idle';

  return (
    <div key={floor.floor} className="animate-slide-up">
      {/* Boss 层标题 */}
      {floor.isBoss && (
        <div className="text-center mb-3">
          <span className="inline-block px-4 py-1.5 bg-gradient-to-r from-red-500 to-orange-500 text-white text-sm font-extrabold rounded-full shadow-lg animate-boss-glow">
            BOSS 层
          </span>
        </div>
      )}

      <div className="flex gap-3 justify-center px-2">
        {floor.lanes.map((lane, i) => {
          const isSelected = selectedLane === i;
          const isOther = selectedLane !== null && !isSelected;

          // 迷雾揭示：选中的迷雾卡片切换为揭示后的内容渲染
          const displayLane = (isSelected && animState === 'revealing' && revealedLane)
            ? revealedLane
            : (isSelected && revealedLane && animState !== 'walking' && animState !== 'idle')
              ? revealedLane
              : lane;

          return (
            <button
              key={i}
              onClick={() => onChooseLane(i)}
              disabled={disabled}
              className={`
                flex-1 max-w-[180px] rounded-2xl p-4 transition-all duration-300 border-2
                ${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:-translate-y-1 hover:shadow-lg active:scale-95'}
                ${isSelected ? 'ring-2 ring-slate-900 scale-[1.02]' : ''}
                ${isOther && isAnimating ? 'opacity-30 scale-95' : ''}
                ${isSelected && animState === 'revealing' ? 'animate-mystery-reveal' : ''}
                ${getCardStyle(displayLane, playerPower, isSelected, animState, hasShield)}
              `}
            >
              <div className="text-center space-y-2">
                <div className={`text-3xl ${getIconAnim(displayLane, isSelected, animState)}`}>
                  {getIcon(displayLane)}
                </div>
                <div className="text-2xl font-black text-slate-900">
                  {getLabel(displayLane)}
                </div>
                <div className={`text-sm font-bold ${getHintColor(displayLane, playerPower, hasShield)}`}>
                  {getHint(displayLane, playerPower, hasShield)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getIcon(lane: TowerLaneContent): string {
  if (lane.type === 'mystery') return '❓';
  if (lane.type === 'monster') return '👾';
  if (lane.type === 'boss') return '💀';
  if (lane.type === 'shield') return '🛡️';
  if (lane.type === 'add') return '💚';
  return '⭐';
}

function getLabel(lane: TowerLaneContent): string {
  if (lane.type === 'mystery') return '???';
  if (lane.type === 'monster') return `${lane.value}`;
  if (lane.type === 'boss') return `${lane.value}`;
  if (lane.type === 'shield') return '护盾';
  if (lane.type === 'add') return `+${lane.value}`;
  return `×${lane.value}`;
}

function getHint(lane: TowerLaneContent, power: number, hasShield?: boolean): string {
  if (lane.type === 'mystery') return '未知内容';
  if (lane.type === 'boss') {
    if (power > lane.value) return `→ ${power + lane.value * 2}`;
    if (hasShield) return '护盾抵挡';
    return '危险!';
  }
  if (lane.type === 'monster') {
    if (power > lane.value) return `→ ${power + lane.value}`;
    if (hasShield) return '护盾抵挡';
    return '危险!';
  }
  if (lane.type === 'shield') {
    if (hasShield) return `→ ${power + lane.value}`;
    return '获得护盾';
  }
  if (lane.type === 'add') return `→ ${power + lane.value}`;
  return `→ ${power * lane.value}`;
}

function getHintColor(lane: TowerLaneContent, power: number, hasShield?: boolean): string {
  if (lane.type === 'mystery') return 'text-purple-500';
  if (lane.type === 'boss') {
    if (power > lane.value) return 'text-green-600';
    if (hasShield) return 'text-blue-500';
    return 'text-red-500';
  }
  if (lane.type === 'monster') {
    if (power > lane.value) return 'text-green-600';
    if (hasShield) return 'text-blue-500';
    return 'text-red-500';
  }
  if (lane.type === 'shield') return 'text-blue-500';
  return 'text-green-600';
}

function getCardStyle(
  lane: TowerLaneContent,
  power: number,
  isSelected: boolean,
  animState: AnimState,
  hasShield?: boolean,
): string {
  const base = 'bg-white/90 backdrop-blur-sm';

  if (lane.type === 'mystery') {
    return `bg-gradient-to-br from-purple-100 to-violet-100 border-purple-300 hover:border-purple-400 shadow-sm animate-tile-pulse`;
  }

  if (lane.type === 'boss') {
    if (isSelected && animState === 'bossDefeated') {
      return `bg-gradient-to-br from-amber-100 to-orange-100 border-orange-400 animate-tile-match`;
    }
    if (isSelected && animState === 'shieldBlock') {
      return `${base} border-blue-400 animate-shield-break`;
    }
    if (isSelected && animState === 'death') {
      return `${base} border-red-500 animate-tile-shake`;
    }
    const canBeat = power > lane.value;
    if (canBeat) {
      return `bg-gradient-to-br from-amber-100 to-orange-100 border-orange-400 hover:border-orange-500 shadow-sm animate-boss-glow`;
    }
    return `bg-gradient-to-br from-amber-100 to-orange-100 border-orange-500 shadow-orange-200 shadow-sm animate-boss-glow`;
  }

  if (lane.type === 'shield') {
    if (isSelected && animState === 'powerup') {
      return `bg-gradient-to-br from-blue-100 to-cyan-100 border-blue-400 ring-4 ring-blue-300/50 animate-glow`;
    }
    return `bg-gradient-to-br from-blue-100 to-cyan-100 border-blue-300 hover:border-blue-400 shadow-sm`;
  }

  if (lane.type === 'monster') {
    const canBeat = power > lane.value;
    if (isSelected && animState === 'attacking') {
      return `${base} border-red-400 animate-tile-match`;
    }
    if (isSelected && animState === 'shieldBlock') {
      return `${base} border-blue-400 animate-shield-break`;
    }
    if (isSelected && animState === 'death') {
      return `${base} border-red-500 animate-tile-shake`;
    }
    if (canBeat) {
      return `${base} border-red-300 hover:border-red-400 shadow-sm`;
    }
    return `${base} border-red-400 shadow-red-100 shadow-sm animate-tile-pulse`;
  }

  if (lane.type === 'add') {
    if (isSelected && animState === 'powerup') {
      return `${base} border-green-400 ring-4 ring-green-300/50 animate-glow`;
    }
    return `${base} border-green-300 hover:border-green-400 shadow-sm`;
  }

  // multiply
  if (isSelected && animState === 'powerup') {
    return `${base} border-amber-400 ring-4 ring-yellow-300/50 animate-glow`;
  }
  return `${base} border-amber-300 hover:border-amber-400 shadow-sm animate-glow`;
}

function getIconAnim(
  lane: TowerLaneContent,
  isSelected: boolean,
  animState: AnimState
): string {
  if (!isSelected) return '';
  if (animState === 'attacking' || animState === 'bossDefeated') return 'scale-110';
  if (animState === 'powerup') return 'scale-110';
  if (animState === 'shieldBlock') return 'scale-110';
  return '';
}
