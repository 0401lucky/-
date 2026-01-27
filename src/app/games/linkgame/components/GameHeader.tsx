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
    <div className="bg-white/80 backdrop-blur-xl rounded-[2.5rem] p-3 sm:p-4 mb-8 shadow-xl shadow-indigo-500/5 border-2 border-white w-full max-w-2xl mx-auto relative overflow-visible transform hover:scale-[1.02] transition-transform duration-500">
      <div className="absolute -top-4 -right-4 w-24 h-24 bg-pink-200 rounded-full blur-2xl opacity-60 -z-10 animate-pulse" />
      <div className="absolute -bottom-4 -left-4 w-20 h-20 bg-cyan-200 rounded-full blur-2xl opacity-60 -z-10 animate-pulse" style={{ animationDelay: '1s' }} />
      
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3 w-full sm:w-auto justify-center sm:justify-start">
          <div className="flex items-center gap-3 bg-gradient-to-r from-orange-50 to-amber-50 px-4 py-2 rounded-2xl border border-orange-100 relative group">
            <div className="text-center">
              <div className="text-[10px] text-orange-400 font-black uppercase tracking-widest mb-0.5">SCORE</div>
              <div 
                className={`text-2xl font-black text-slate-800 tabular-nums leading-none ${scorePopping ? 'animate-score-pop text-orange-500' : ''}`}
              >
                {score}
              </div>
            </div>
            {combo > 1 && (
              <div 
                key={combo}
                className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-orange-500 text-white px-3 py-1 rounded-full font-black text-sm animate-bounce-in shadow-lg rotate-[-5deg] z-20 border-2 border-white"
              >
                🔥 {combo} COMBO!
              </div>
            )}
          </div>
          
          <div className={`flex items-center gap-3 px-4 py-2 rounded-2xl border relative transition-all duration-300 ${
              timeRemaining < 30 
                ? 'bg-red-50 border-red-200 animate-pulse' 
                : 'bg-gradient-to-r from-blue-50 to-cyan-50 border-blue-100'
            }`}>
            <div className="text-center">
              <div className={`text-[10px] font-black uppercase tracking-widest mb-0.5 ${timeRemaining < 30 ? 'text-red-400' : 'text-cyan-600'}`}>TIME</div>
              <div className={`text-2xl font-black tabular-nums leading-none transition-all duration-300 ${
                timeRemaining < 30 ? 'text-red-500 scale-110' : 'text-slate-800'
              }`}>
                {formatTime(timeRemaining)}
              </div>
            </div>
            {timeRemaining < 10 && (
              <span className="absolute -top-2 -right-2 text-xl animate-bounce">⏰</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-center sm:justify-end">
          <button
            onClick={onHint}
            disabled={hintsRemaining <= 0}
            className={`
              flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-black transition-all active:scale-95 border-b-4 relative overflow-hidden group
              ${hintsRemaining > 0 
                ? 'bg-amber-300 border-amber-500 text-amber-900 hover:bg-amber-400 hover:-translate-y-1 hover:border-b-[6px]' 
                : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}
            `}
            title="提示 (-10分)"
          >
            <span className="text-xl relative z-10 group-hover:rotate-12 transition-transform">💡</span>
            <span className="relative z-10">{hintsRemaining}</span>
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
          </button>

          <button
            onClick={onShuffle}
            disabled={shufflesRemaining <= 0}
            className={`
              flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-black transition-all active:scale-95 border-b-4 relative overflow-hidden group
              ${shufflesRemaining > 0 
                ? 'bg-indigo-300 border-indigo-500 text-indigo-900 hover:bg-indigo-400 hover:-translate-y-1 hover:border-b-[6px]' 
                : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}
            `}
            title="重排 (-20分)"
          >
            <span className="text-xl relative z-10 group-hover:animate-spin transition-transform">🔄</span>
            <span className="relative z-10">{shufflesRemaining}</span>
            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
          </button>
        </div>
      </div>
    </div>
  );
}
