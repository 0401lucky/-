'use client';

import { useState, useEffect, useRef } from 'react';
import type { LinkGameDifficultyConfig, LinkGamePosition } from '@/lib/types/game';
import { cn } from '@/lib/utils';

interface GameBoardProps {
  tileLayout: (string | null)[];
  config: LinkGameDifficultyConfig;
  selected: number[];
  shakingIndices?: number[];
  matchingIndices?: number[];
  matchPaths?: LinkGamePosition[][];
  onSelect: (index: number) => void;
  onMatch?: (index1: number, index2: number) => void;
  onGameEnd?: () => void;
}

export function GameBoard({
  tileLayout,
  config,
  selected,
  shakingIndices = [],
  matchingIndices = [],
  matchPaths,
  onSelect,
}: GameBoardProps) {
  const [entranceComplete, setEntranceComplete] = useState(false);
  const [matchingTiles, setMatchingTiles] = useState<number[]>([]);
  const [shakingTiles, setShakingTiles] = useState<number[]>([]);
  const [pathPointsList, setPathPointsList] = useState<string[]>([]);
  const gridRef = useRef<HTMLDivElement>(null);

  // Calculate path points for the connecting line
  useEffect(() => {
    if (!matchPaths || matchPaths.length === 0 || !gridRef.current) {
      setPathPointsList([]);
      return;
    }

    const validPaths = matchPaths.filter((p) => Array.isArray(p) && p.length >= 2);
    if (validPaths.length === 0) {
      setPathPointsList([]);
      return;
    }

    const updatePath = () => {
      if (!gridRef.current) return;
      const { width, height } = gridRef.current.getBoundingClientRect();
      const computedStyle = getComputedStyle(gridRef.current);
      const gapX = parseFloat(computedStyle.columnGap) || 0;
      const gapY = parseFloat(computedStyle.rowGap) || 0;
      const { rows, cols } = config;

      // Calculate cell dimensions including gap distribution
      // Grid width = cols * cellWidth + (cols - 1) * gap
      const cellWidth = (width - (cols - 1) * gapX) / cols;
      const cellHeight = (height - (rows - 1) * gapY) / rows;

      const getX = (c: number) => {
        // Center of tile: col * (size + gap) + size/2
        // Border left (-1): -gap/2 (in the gap before start) -> actually inside the padding
        // Let's place border lines in the middle of the padding area effectively
        // We have p-8 (32px) padding in parent.
        // Let's offset border paths by roughly half a cell or just outside the grid
        const offset = Math.max(gapX, gapY) * 1.5; 
        if (c < 0) return -offset; 
        if (c >= cols) return width + offset;
        return c * (cellWidth + gapX) + cellWidth / 2;
      };

      const getY = (r: number) => {
        const offset = Math.max(gapX, gapY) * 1.5;
        if (r < 0) return -offset;
        if (r >= rows) return height + offset;
        return r * (cellHeight + gapY) + cellHeight / 2;
      };

      const pointsList = validPaths.map((path) => path.map((p) => `${getX(p.col)},${getY(p.row)}`).join(' '));
      setPathPointsList(pointsList);
    };

    updatePath();
    // Use ResizeObserver for more robust resizing support
    const resizeObserver = new ResizeObserver(updatePath);
    resizeObserver.observe(gridRef.current);
    
    return () => resizeObserver.disconnect();
  }, [matchPaths, config.rows, config.cols]);

  // Sync props to local state for animation control
  useEffect(() => {
    if (matchingIndices.length > 0) {
      setMatchingTiles(prev => [...new Set([...prev, ...matchingIndices])]);
    } else {
      // Only clear matching tiles if they are no longer in the layout (null)
      // This prevents the animation from being cut off if the prop clears early
      // But for simplicity, we'll just sync for now, or maybe keep them until animation end?
      // Let's stick to syncing with props but using local state for the class application
      setMatchingTiles(matchingIndices);
    }
  }, [matchingIndices]);

  useEffect(() => {
    if (shakingIndices.length > 0) {
      setShakingTiles(shakingIndices);
      // Auto clear shaking state after animation duration to allow re-trigger
      const timer = setTimeout(() => {
        setShakingTiles([]);
      }, 400); // Duration of tile-shake
      return () => clearTimeout(timer);
    }
  }, [shakingIndices]);

  useEffect(() => {
    // Mark entrance as complete after max possible delay + animation duration
    const maxDelay = (config.rows + config.cols) * 50;
    const timer = setTimeout(() => {
      setEntranceComplete(true);
    }, maxDelay + 500);
    return () => clearTimeout(timer);
  }, [config.rows, config.cols]);

  const getTileContent = (tile: string | null) => {
    if (!tile) return null;
    return tile;
  };

  const handleAnimationEnd = (index: number, animationName: string) => {
    // If needed, we can trigger cleanup here
    if (animationName.includes('tile-match')) {
      // Animation finished
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-8 bg-white/40 backdrop-blur-xl rounded-[2.5rem] border-4 border-white shadow-2xl shadow-indigo-500/10 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent pointer-events-none" />
      
      <div 
        ref={gridRef}
        className="grid gap-2 sm:gap-3 mx-auto relative z-10"
        style={{
          gridTemplateColumns: `repeat(${config.cols}, minmax(0, 1fr))`,
          maxWidth: '100%',
          aspectRatio: `${config.cols} / ${config.rows}`,
        }}
      >
        {pathPointsList.length > 0 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-50 overflow-visible">
            <defs>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>
            {pathPointsList.map((points, idx) => {
              const colors = ['#f472b6', '#a78bfa', '#22d3ee']; // pink-400, violet-400, cyan-400
              const color = colors[idx % colors.length];
              return (
                <g key={idx}>
                  {/* Outer glow/stroke */}
                  <polyline
                    points={points}
                    fill="none"
                    stroke={color}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="opacity-50 blur-sm"
                  />
                  {/* Main stroke */}
                  <polyline
                    points={points}
                    fill="none"
                    stroke={color}
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter="url(#glow)"
                    className="animate-draw-line"
                  />
                  {/* Inner highlight */}
                  <polyline
                    points={points}
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="opacity-70"
                  />
                </g>
              );
            })}
          </svg>
        )}
        {tileLayout.map((tile, index) => {
          const isSelected = selected.includes(index);
          const isVisible = tile !== null;
          
          // Use props or local state - local state allows us to keep 'shaking' active for the duration
          const isShaking = shakingTiles.includes(index) || shakingIndices.includes(index);
          const isMatching = matchingTiles.includes(index) || matchingIndices.includes(index);
          
          // Calculate staggered delay for entrance animation based on grid position
          const row = Math.floor(index / config.cols);
          const col = index % config.cols;
          // Calculate manhattan distance from center or top-left for a nice wave
          const delay = (row + col) * 50; 

          return (
            <div key={index} className="relative group perspective-500">
              <button
                onClick={() => isVisible && onSelect(index)}
                disabled={!isVisible || isMatching}
                onAnimationEnd={(e) => handleAnimationEnd(index, e.animationName)}
                className={cn(
                  "relative w-full h-full flex items-center justify-center text-3xl sm:text-5xl select-none transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
                  "rounded-3xl aspect-square shadow-[0_4px_0_0_rgba(0,0,0,0.05)] active:shadow-none active:translate-y-[4px]",
                  isVisible 
                    ? "bg-white border-b-4 border-r-2 border-l-2 border-t-2 border-white cursor-pointer hover:-translate-y-1 hover:shadow-[0_8px_0_0_rgba(0,0,0,0.05)]" 
                    : "invisible opacity-0",
                  
                  // Entrance animation - only run if not complete
                  isVisible && !entranceComplete && "animate-tile-entrance",
                  
                  // Normal state gradient (subtle)
                  isVisible && !isSelected && !isMatching && !isShaking && "bg-gradient-to-br from-white to-slate-50",

                  // Selection state
                  isSelected && isVisible && "animate-tile-pulse ring-4 ring-pink-400 border-pink-500 z-10 shadow-xl scale-110 bg-pink-50 text-6xl rotate-3",
                  
                  // Shaking state (error)
                  isShaking && "animate-tile-shake bg-red-50 border-red-400 text-red-500 ring-4 ring-red-200 z-10 rotate-12",
                  
                  // Matching state (success)
                  isMatching && "animate-tile-match z-20 border-emerald-400 bg-emerald-50 ring-4 ring-emerald-200 scale-125 rotate-[-12deg]"
                )}
                style={{
                  animationDelay: isVisible && !entranceComplete && !isShaking && !isMatching ? `${delay}ms` : '0ms'
                }}
              >
                <span className="drop-shadow-sm filter transform hover:scale-110 transition-transform">{getTileContent(tile)}</span>
                
                {/* Sparkle effects for matching tiles */}
                {isMatching && (
                  <>
                    <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl animate-sparkle" style={{ animationDelay: '0.1s' }}>✨</span>
                    <span className="absolute bottom-0 left-0 -translate-x-1/4 translate-y-1/4 text-xl animate-sparkle" style={{ animationDelay: '0.2s' }}>💖</span>
                    <span className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 text-xl animate-sparkle" style={{ animationDelay: '0.3s' }}>⭐</span>
                    <span className="absolute -top-2 -right-2 text-xl animate-sparkle" style={{ animationDelay: '0.4s' }}>🍬</span>
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
