'use client';

import type { TowerFloor, TowerLaneContent } from '@/lib/tower-engine';

interface FloorDisplayProps {
  floor: TowerFloor;
  playerPower: number;
  onChooseLane: (index: number) => void;
  disabled: boolean;
  selectedLane: number | null;
}

export default function FloorDisplay({
  floor,
  playerPower,
  onChooseLane,
  disabled,
  selectedLane,
}: FloorDisplayProps) {
  return (
    <div className="absolute bottom-32 left-0 right-0 px-4 flex justify-center gap-3 z-10">
      {floor.lanes.map((lane, i) => (
        <button
          key={i}
          onClick={() => onChooseLane(i)}
          disabled={disabled}
          className={`
            flex-1 max-w-[120px] py-3 px-2 rounded-xl font-bold text-sm transition-all
            border-2 backdrop-blur-sm
            ${selectedLane === i ? 'ring-2 ring-white scale-105' : ''}
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 active:scale-95 cursor-pointer'}
            ${getLaneButtonStyle(lane, playerPower)}
          `}
        >
          <div className="text-center">
            <div className="text-2xl mb-1">{getLaneIcon(lane)}</div>
            <div className="text-white font-black text-lg">{getLaneLabel(lane)}</div>
            <div className={`text-xs mt-1 ${getLaneHintColor(lane, playerPower)}`}>
              {getLaneHint(lane, playerPower)}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function getLaneIcon(lane: TowerLaneContent): string {
  if (lane.type === 'monster') return '👾';
  if (lane.type === 'add') return '💚';
  return '⭐';
}

function getLaneLabel(lane: TowerLaneContent): string {
  if (lane.type === 'monster') return `${lane.value}`;
  if (lane.type === 'add') return `+${lane.value}`;
  return `x${lane.value}`;
}

function getLaneHint(lane: TowerLaneContent, power: number): string {
  if (lane.type === 'monster') {
    return power > lane.value ? `→ ${power + lane.value}` : 'GAME OVER';
  }
  if (lane.type === 'add') return `→ ${power + lane.value}`;
  return `→ ${power * lane.value}`;
}

function getLaneHintColor(lane: TowerLaneContent, power: number): string {
  if (lane.type === 'monster') {
    return power > lane.value ? 'text-green-300' : 'text-red-300';
  }
  return 'text-green-300';
}

function getLaneButtonStyle(lane: TowerLaneContent, power: number): string {
  if (lane.type === 'monster') {
    if (power > lane.value) {
      return 'bg-red-900/60 border-red-500/60 hover:bg-red-800/70';
    }
    return 'bg-red-900/80 border-red-400/80 hover:bg-red-700/80';
  }
  if (lane.type === 'add') {
    return 'bg-green-900/60 border-green-500/60 hover:bg-green-800/70';
  }
  return 'bg-amber-900/60 border-amber-500/60 hover:bg-amber-800/70';
}
