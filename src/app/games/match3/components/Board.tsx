'use client';

import { memo } from 'react';
import type { Match3Config } from '@/lib/match3-engine';
import { Diamond, Droplet, Flame, Gem, Leaf, Zap } from 'lucide-react';

const TILE_META = [
  { Icon: Flame, bg: 'bg-rose-500', ring: 'ring-rose-300', label: 'Flame' },
  { Icon: Droplet, bg: 'bg-sky-500', ring: 'ring-sky-300', label: 'Droplet' },
  { Icon: Leaf, bg: 'bg-emerald-500', ring: 'ring-emerald-300', label: 'Leaf' },
  { Icon: Zap, bg: 'bg-amber-500', ring: 'ring-amber-300', label: 'Zap' },
  { Icon: Gem, bg: 'bg-violet-500', ring: 'ring-violet-300', label: 'Gem' },
  { Icon: Diamond, bg: 'bg-fuchsia-500', ring: 'ring-fuchsia-300', label: 'Diamond' },
] as const;

function isAdjacent(a: number, b: number, config: Match3Config): boolean {
  const rows = config.rows;
  const cols = config.cols;
  if (a < 0 || b < 0 || a >= rows * cols || b >= rows * cols) return false;
  const ar = Math.floor(a / cols);
  const ac = a % cols;
  const br = Math.floor(b / cols);
  const bc = b % cols;
  const dr = Math.abs(ar - br);
  const dc = Math.abs(ac - bc);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

interface BoardProps {
  board: number[];
  config: Match3Config;
  selectedIndex: number | null;
  onTileClick: (index: number) => void;
  disabled?: boolean;
}

export const Board = memo(function Board({
  board,
  config,
  selectedIndex,
  onTileClick,
  disabled = false,
}: BoardProps) {
  const cols = config.cols;

  return (
    <div
      className="w-full max-w-[420px] mx-auto bg-white rounded-3xl p-4 sm:p-5 shadow-sm border border-slate-100"
      role="group"
      aria-label="Match3 board"
    >
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {board.map((tile, index) => {
          const meta = TILE_META[tile % TILE_META.length];
          const isSelected = selectedIndex === index;
          const isSwapHint = selectedIndex !== null && isAdjacent(selectedIndex, index, config);
          const Icon = meta.Icon;

          return (
            <button
              key={index}
              type="button"
              disabled={disabled}
              onClick={() => onTileClick(index)}
              aria-label={`Tile ${meta.label}`}
              className={[
                'aspect-square rounded-2xl flex items-center justify-center',
                meta.bg,
                'shadow-md shadow-slate-200/50',
                'transition-transform duration-150',
                disabled ? 'opacity-60 cursor-not-allowed' : 'active:scale-95',
                isSelected ? `ring-4 ${meta.ring}` : 'ring-0',
                !disabled && isSwapHint ? 'hover:brightness-110' : '',
              ].join(' ')}
            >
              <Icon className="w-6 h-6 sm:w-7 sm:h-7 text-white drop-shadow" />
            </button>
          );
        })}
      </div>
    </div>
  );
});

