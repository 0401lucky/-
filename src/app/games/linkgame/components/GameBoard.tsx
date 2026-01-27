'use client';

import { useState, useEffect } from 'react';
import type { LinkGameDifficulty, LinkGameDifficultyConfig } from '@/lib/types/game';
import { cn } from '@/lib/utils';

interface GameBoardProps {
  difficulty: LinkGameDifficulty;
  tileLayout: (string | null)[];
  config: LinkGameDifficultyConfig;
  selected: number | null;
  shakingIndices?: number[];
  matchingIndices?: number[];
  onSelect: (index: number) => void;
  onMatch?: (index1: number, index2: number) => void;
  onGameEnd?: () => void;
}

export function GameBoard({
  difficulty,
  tileLayout,
  config,
  selected,
  shakingIndices = [],
  matchingIndices = [],
  onSelect,
}: GameBoardProps) {
  const [entranceComplete, setEntranceComplete] = useState(false);
  const [matchingTiles, setMatchingTiles] = useState<number[]>([]);
  const [shakingTiles, setShakingTiles] = useState<number[]>([]);

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
    <div className="w-full max-w-2xl mx-auto p-4">
      <div 
        className="grid gap-2 sm:gap-3 mx-auto relative"
        style={{
          gridTemplateColumns: `repeat(${config.cols}, minmax(0, 1fr))`,
          maxWidth: '100%',
          aspectRatio: `${config.cols} / ${config.rows}`,
        }}
      >
        {tileLayout.map((tile, index) => {
          const isSelected = selected === index;
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
            <div key={index} className="relative group">
              <button
                onClick={() => isVisible && onSelect(index)}
                disabled={!isVisible || isMatching}
                onAnimationEnd={(e) => handleAnimationEnd(index, e.animationName)}
                className={cn(
                  "relative w-full h-full flex items-center justify-center text-3xl sm:text-4xl select-none transition-all duration-200",
                  "rounded-xl aspect-square shadow-sm",
                  isVisible 
                    ? "bg-white border-2 border-slate-200 cursor-pointer hover:border-blue-300 hover:shadow-md hover:-translate-y-0.5 active:scale-95" 
                    : "invisible opacity-0",
                  
                  // Entrance animation - only run if not complete
                  isVisible && !entranceComplete && "animate-tile-entrance",
                  
                  // Selection state
                  isSelected && isVisible && "animate-tile-pulse ring-4 ring-blue-400 scale-110 border-blue-500 z-10 shadow-xl",
                  
                  // Shaking state (error)
                  isShaking && "animate-tile-shake bg-red-50 border-red-300 text-red-500 ring-2 ring-red-200",
                  
                  // Matching state (success)
                  isMatching && "animate-tile-match z-20 border-green-400 bg-green-50 ring-4 ring-green-200"
                )}
                style={{
                  animationDelay: isVisible && !entranceComplete && !isShaking && !isMatching ? `${delay}ms` : '0ms'
                }}
              >
                {getTileContent(tile)}
                
                {/* Sparkle effects for matching tiles */}
                {isMatching && (
                  <>
                    <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xl animate-sparkle" style={{ animationDelay: '0.1s' }}>✨</span>
                    <span className="absolute bottom-0 left-0 -translate-x-1/4 translate-y-1/4 text-lg animate-sparkle" style={{ animationDelay: '0.2s' }}>✨</span>
                    <span className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 text-lg animate-sparkle" style={{ animationDelay: '0.3s' }}>⭐</span>
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
