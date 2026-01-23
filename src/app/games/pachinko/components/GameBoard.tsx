'use client';

import { CANVAS_WIDTH, CANVAS_HEIGHT, SLOT_SCORES } from '../lib/constants';
import { RefObject } from 'react';

interface GameBoardProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  ballsRemaining: number;
  currentScore: number;
}

export function GameBoard({ canvasRef, ballsRemaining, currentScore }: GameBoardProps) {
  return (
    <div
      className="flex flex-col w-full max-w-[400px] mx-auto select-none"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
    >
      {/* 游戏画布 */}
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="w-full aspect-[2/3] rounded-t-lg border-2 border-b-0 border-purple-500/30"
      />
      
      {/* 槽位分数标签 - 移出画布，使用 grid 对齐 */}
      <div className="w-full grid grid-cols-9 rounded-b-lg border-2 border-t-0 border-purple-500/30 bg-slate-900/80">
        {SLOT_SCORES.map((score, i) => (
          <div
            key={i}
            className={`text-center py-2 text-[11px] sm:text-sm font-bold tabular-nums ${
              score === 80 
                ? 'text-red-400 bg-red-500/10' 
                : score === 40 
                  ? 'text-orange-400' 
                  : score === 20 
                    ? 'text-yellow-400' 
                    : 'text-slate-400'
            }`}
          >
            {score}
          </div>
        ))}
      </div>
      
      {/* 状态栏 - 使用 grid 对齐 */}
      <div className="w-full grid grid-cols-2 gap-3 sm:gap-4 mt-3 sm:mt-4 text-white">
        <div className="flex items-center justify-center gap-2 bg-slate-800/50 rounded-lg py-2 text-sm">
          <span className="text-yellow-400">🎱</span>
          <span className="tabular-nums">剩余: {ballsRemaining}</span>
        </div>
        <div className="flex items-center justify-center gap-2 bg-slate-800/50 rounded-lg py-2 text-sm">
          <span className="text-green-400">⭐</span>
          <span className="tabular-nums">得分: {currentScore}</span>
        </div>
      </div>
    </div>
  );
}
