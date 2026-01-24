'use client';

import { memo } from 'react';
import type { Match3Config } from '@/lib/match3-engine';
import { Diamond, Droplet, Flame, Gem, Leaf, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

const TILE_META = [
  { 
    Icon: Flame, 
    bg: 'bg-gradient-to-br from-orange-400 to-red-600', 
    shadow: 'shadow-red-500/50',
    ring: 'ring-orange-400', 
    label: 'Flame',
    glow: 'after:bg-orange-400/30'
  },
  { 
    Icon: Droplet, 
    bg: 'bg-gradient-to-br from-cyan-400 to-blue-600', 
    shadow: 'shadow-blue-500/50',
    ring: 'ring-cyan-400', 
    label: 'Droplet',
    glow: 'after:bg-blue-400/30'
  },
  { 
    Icon: Leaf, 
    bg: 'bg-gradient-to-br from-lime-400 to-emerald-600', 
    shadow: 'shadow-emerald-500/50',
    ring: 'ring-lime-400', 
    label: 'Leaf',
    glow: 'after:bg-emerald-400/30'
  },
  { 
    Icon: Zap, 
    bg: 'bg-gradient-to-br from-yellow-300 to-amber-500', 
    shadow: 'shadow-amber-500/50',
    ring: 'ring-yellow-400', 
    label: 'Zap',
    glow: 'after:bg-yellow-400/30'
  },
  { 
    Icon: Gem, 
    bg: 'bg-gradient-to-br from-violet-400 to-purple-600', 
    shadow: 'shadow-purple-500/50',
    ring: 'ring-violet-400', 
    label: 'Gem',
    glow: 'after:bg-purple-400/30'
  },
  { 
    Icon: Diamond, 
    bg: 'bg-gradient-to-br from-fuchsia-400 to-pink-600', 
    shadow: 'shadow-pink-500/50',
    ring: 'ring-fuchsia-400', 
    label: 'Diamond',
    glow: 'after:bg-pink-400/30'
  },
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
    <>
      <style jsx global>{`
        @keyframes popIn {
          0% { transform: scale(0); opacity: 0; }
          60% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
        .tile-pop {
          animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        }
        @keyframes shine {
          0% { transform: skewX(-20deg) translateX(-150%); }
          100% { transform: skewX(-20deg) translateX(150%); }
        }
        .shine-effect {
          position: absolute;
          top: 0; left: 0; width: 100%; height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
          transform: skewX(-20deg) translateX(-150%);
        }
        .group:hover .shine-effect {
          animation: shine 0.7s;
        }
      `}</style>
      
      <div
        className="relative w-full max-w-[420px] mx-auto bg-slate-900/5 rounded-3xl p-4 sm:p-5 backdrop-blur-sm border border-white/20 shadow-inner"
        role="group"
        aria-label="Match3 board"
      >
        <div
          className="grid gap-2 relative z-10"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {board.map((tile, index) => {
            const meta = TILE_META[tile % TILE_META.length];
            const isSelected = selectedIndex === index;
            const isSwapHint = selectedIndex !== null && isAdjacent(selectedIndex, index, config);
            const Icon = meta.Icon;
            
            // Generate a key based on index AND tile type to force re-render animation on change
            const tileKey = `${index}-${tile}`;

            return (
              <div key={tileKey} className="relative aspect-square tile-pop">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onTileClick(index)}
                  aria-label={`Tile ${meta.label}`}
                  className={cn(
                    'group relative w-full h-full rounded-xl sm:rounded-2xl flex items-center justify-center overflow-hidden',
                    'transition-all duration-200 ease-out',
                    meta.bg,
                    meta.shadow,
                    'shadow-lg',
                    disabled ? 'opacity-80 grayscale-[0.2] cursor-not-allowed' : 'cursor-pointer active:scale-95',
                    isSelected && [
                      'scale-105 z-20 ring-4 ring-offset-2 ring-offset-slate-50',
                      meta.ring
                    ],
                    !disabled && !isSelected && 'hover:scale-[1.02] hover:brightness-110 hover:-translate-y-0.5',
                    isSwapHint && !disabled && 'animate-pulse ring-2 ring-white/50 ring-offset-1',
                    // Glossy overlay
                    'before:absolute before:inset-0 before:bg-gradient-to-b before:from-white/30 before:to-transparent before:pointer-events-none'
                  )}
                >
                  {/* Inner shine effect */}
                  <div className="shine-effect" />
                  
                  {/* Icon */}
                  <Icon 
                    className={cn(
                      "relative z-10 w-3/5 h-3/5 text-white drop-shadow-md transition-transform duration-300",
                      isSelected ? "scale-110 rotate-12" : "group-hover:rotate-6"
                    )} 
                    strokeWidth={2.5}
                  />
                  
                  {/* Bottom reflection/depth */}
                  <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-black/10 blur-[1px] rounded-b-xl sm:rounded-b-2xl pointer-events-none" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
});

