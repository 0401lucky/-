'use client';

import { useState, useEffect } from 'react';

interface GameHeaderProps {
  timeRemaining: number;
  score: number;
  combo: number;
  hintsRemaining: number;
  shufflesRemaining: number;
  onHint: () => void;
  onShuffle: () => void;
}

export function GameHeader({
  timeRemaining,
  score,
  combo,
  hintsRemaining,
  shufflesRemaining,
  onHint,
  onShuffle,
}: GameHeaderProps) {
  const [scorePopping, setScorePopping] = useState(false);

  useEffect(() => {
    setScorePopping(true);
    const timer = setTimeout(() => setScorePopping(false), 300);
    return () => clearTimeout(timer);
  }, [score]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-white rounded-2xl p-4 mb-6 shadow-sm border border-slate-100 w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="text-center relative">
            <div className="text-xs text-slate-400 uppercase tracking-wider">得分</div>
            <div 
              className={`text-xl font-bold text-slate-900 tabular-nums ${scorePopping ? 'animate-score-pop' : ''}`}
            >
              {score}
            </div>
            {combo > 1 && (
              <div 
                key={combo}
                className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-orange-500 font-bold text-lg animate-bounce-in"
              >
                🔥 Combo x{combo}!
              </div>
            )}
          </div>
          
          <div className="text-center">
            <div className="text-xs text-slate-400 uppercase tracking-wider">时间</div>
            <div className={`text-xl font-bold tabular-nums transition-colors duration-300 ${
              timeRemaining < 30 ? 'text-red-500 animate-tile-pulse' : 'text-slate-900'
            }`}>
              {formatTime(timeRemaining)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onHint}
            disabled={hintsRemaining <= 0}
            className={`
              flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors
              ${hintsRemaining > 0 
                ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200' 
                : 'bg-slate-50 text-slate-400 cursor-not-allowed border border-slate-100'}
            `}
            title="提示 (-10分)"
          >
            <span>💡</span>
            <span>提示 ({hintsRemaining})</span>
          </button>

          <button
            onClick={onShuffle}
            disabled={shufflesRemaining <= 0}
            className={`
              flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors
              ${shufflesRemaining > 0 
                ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200' 
                : 'bg-slate-50 text-slate-400 cursor-not-allowed border border-slate-100'}
            `}
            title="重排 (-20分)"
          >
            <span>🔄</span>
            <span>重排 ({shufflesRemaining})</span>
          </button>
        </div>
      </div>
    </div>
  );
}
