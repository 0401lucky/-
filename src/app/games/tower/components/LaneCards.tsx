'use client';

import type { TowerFloor, TowerLaneContent } from '@/lib/tower-engine';

type AnimState = 'idle' | 'walking' | 'attacking' | 'powerup' | 'death' | 'nextFloor';

interface LaneCardsProps {
  floor: TowerFloor;
  playerPower: number;
  onChooseLane: (index: number) => void;
  disabled: boolean;
  selectedLane: number | null;
  animState: AnimState;
}

export default function LaneCards({
  floor,
  playerPower,
  onChooseLane,
  disabled,
  selectedLane,
  animState,
}: LaneCardsProps) {
  const isAnimating = animState !== 'idle';

  return (
    <div key={floor.floor} className="animate-slide-up">
      <div className="flex gap-3 justify-center px-2">
        {floor.lanes.map((lane, i) => {
          const isSelected = selectedLane === i;
          const isOther = selectedLane !== null && !isSelected;

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
                ${getCardStyle(lane, playerPower, isSelected, animState)}
              `}
            >
              <div className="text-center space-y-2">
                <div className={`text-3xl ${getIconAnim(lane, isSelected, animState)}`}>
                  {getIcon(lane)}
                </div>
                <div className="text-2xl font-black text-slate-900">
                  {getLabel(lane)}
                </div>
                <div className={`text-sm font-bold ${getHintColor(lane, playerPower)}`}>
                  {getHint(lane, playerPower)}
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
  if (lane.type === 'monster') return '👾';
  if (lane.type === 'add') return '💚';
  return '⭐';
}

function getLabel(lane: TowerLaneContent): string {
  if (lane.type === 'monster') return `${lane.value}`;
  if (lane.type === 'add') return `+${lane.value}`;
  return `×${lane.value}`;
}

function getHint(lane: TowerLaneContent, power: number): string {
  if (lane.type === 'monster') {
    return power > lane.value ? `→ ${power + lane.value}` : '危险!';
  }
  if (lane.type === 'add') return `→ ${power + lane.value}`;
  return `→ ${power * lane.value}`;
}

function getHintColor(lane: TowerLaneContent, power: number): string {
  if (lane.type === 'monster') {
    return power > lane.value ? 'text-green-600' : 'text-red-500';
  }
  return 'text-green-600';
}

function getCardStyle(
  lane: TowerLaneContent,
  power: number,
  isSelected: boolean,
  animState: AnimState
): string {
  const base = 'bg-white/90 backdrop-blur-sm';

  if (lane.type === 'monster') {
    const canBeat = power > lane.value;
    if (isSelected && animState === 'attacking') {
      return `${base} border-red-400 animate-tile-match`;
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
  if (animState === 'attacking') return 'scale-110';
  if (animState === 'powerup') return 'scale-110';
  return '';
}
