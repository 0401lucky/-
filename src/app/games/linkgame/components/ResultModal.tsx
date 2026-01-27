'use client';

import { useEffect, useState, useRef } from 'react';
import confetti from 'canvas-confetti';
import { DIFFICULTY_META } from '../lib/constants';
import type { LinkGameDifficulty } from '@/lib/types/game';

interface ResultModalProps {
  isOpen: boolean;
  difficulty: LinkGameDifficulty;
  score: number;
  pointsEarned: number;
  completed: boolean;
  matchedPairs: number;
  onPlayAgain: () => void;
  onBackToGames: () => void;
}

export function ResultModal({
  isOpen,
  difficulty,
  score,
  pointsEarned,
  completed,
  matchedPairs,
  onPlayAgain,
  onBackToGames,
}: ResultModalProps) {
  const [displayScore, setDisplayScore] = useState(0);

  const playAgainRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen && completed) {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion) return;

      const duration = 3000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 60 };

      const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

      const interval = window.setInterval(() => {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          window.clearInterval(interval);
          return;
        }

        const particleCount = 50 * (timeLeft / duration);
        confetti({
          ...defaults, 
          particleCount,
          origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
        });
        confetti({
          ...defaults, 
          particleCount,
          origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
        });
      }, 250);

      return () => window.clearInterval(interval);
    }
  }, [isOpen, completed]);

  useEffect(() => {
    if (isOpen) {
      // Focus play again button when modal opens
      setTimeout(() => {
        playAgainRef.current?.focus();
      }, 100);
      
      const duration = 1000;
      const steps = 30;
      const increment = score / steps;
      let current = 0;

      const timer = setInterval(() => {
        current += increment;
        if (current >= score) {
          setDisplayScore(score);
          clearInterval(timer);
        } else {
          setDisplayScore(Math.floor(current));
        }
      }, duration / steps);

      return () => clearInterval(timer);
    }
  }, [isOpen, score]);

  if (!isOpen) return null;

  const meta = DIFFICULTY_META[difficulty];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="result-title">
      <div className="absolute inset-0 bg-indigo-900/60 backdrop-blur-md animate-fade-in" />
      
      <div className="relative bg-white rounded-[3rem] shadow-2xl shadow-indigo-500/20 max-w-md w-full overflow-hidden animate-bounce-in border-[6px] border-white ring-4 ring-indigo-100">
        <div className={`h-48 bg-gradient-to-br ${meta.color} flex items-center justify-center relative overflow-hidden`}>
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjIiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4yKSIvPjwvc3ZnPg==')] opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
          
          <div className="absolute top-4 left-4 w-12 h-12 rounded-full border-4 border-white/20 animate-spin-slow" />
          <div className="absolute bottom-4 right-4 w-8 h-8 rounded-full bg-white/20 animate-bounce" />

          {completed && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              {['🎉', '⭐', '✨', '🎊', '🍭'].map((emoji, i) => (
                <span 
                  key={i}
                  className="absolute animate-confetti text-4xl filter drop-shadow-md"
                  style={{
                    left: `${20 + i * 15}%`,
                    animationDelay: `${i * 150}ms`
                  }}
                >
                  {emoji}
                </span>
              ))}
            </div>
          )}

          <div className="text-center text-white relative z-10 transform translate-y-2">
            <div className="text-8xl mb-4 animate-bounce filter drop-shadow-lg transform hover:scale-110 transition-transform cursor-default">
              {completed ? '🎉' : '⏰'}
            </div>
            <div id="result-title" className="text-3xl font-black tracking-tight drop-shadow-md">
              {completed ? '恭喜通关！' : '时间到啦！'}
            </div>
          </div>
        </div>
        
        <div className="p-8">
          <div className="space-y-4">
            <div className="flex justify-between items-center py-3 border-b-2 border-dashed border-slate-100">
              <span className="text-slate-400 font-black text-sm uppercase tracking-wider">难度</span>
              <span className={`font-black flex items-center gap-2 bg-slate-50 px-4 py-1.5 rounded-full ${meta.textColor}`}>
                <span>{meta.icon}</span>
                {meta.name}
              </span>
            </div>
            
            <div className="flex justify-between items-center py-3 border-b-2 border-dashed border-slate-100">
              <span className="text-slate-400 font-black text-sm uppercase tracking-wider">完成对数</span>
              <span className="font-black text-slate-800 text-lg">{matchedPairs} 对</span>
            </div>
            
            <div className="flex justify-between items-center py-3 border-b-2 border-dashed border-slate-100">
              <span className="text-slate-400 font-black text-sm uppercase tracking-wider">游戏得分</span>
              <span className="font-black text-2xl text-slate-800 tabular-nums tracking-tight">{displayScore}</span>
            </div>
            
            <div className="flex justify-between items-center py-6 bg-gradient-to-r from-orange-50 via-yellow-50 to-orange-50 rounded-3xl px-6 border-2 border-orange-100 shadow-inner mt-2">
              <span className="text-orange-900/60 font-black text-sm uppercase tracking-wider">获得积分</span>
              <span className="font-black text-4xl text-orange-500 flex items-center gap-2 filter drop-shadow-sm">
                <span className="text-2xl">⭐</span>
                +{pointsEarned}
              </span>
            </div>
            
            {pointsEarned < score && (
              <p className="text-center text-xs text-orange-400 font-bold bg-orange-50 py-2 rounded-xl mt-2">
                ⚠️ 今日积分已达上限，部分积分未发放
              </p>
            )}
          </div>
          
          <div className="mt-8 flex gap-4">
            <button
              onClick={onBackToGames}
              className="group relative flex-1 py-4 px-4 rounded-2xl border-2 border-slate-200 text-slate-500 font-black hover:bg-slate-50 hover:text-slate-700 hover:border-slate-300 transition-all overflow-hidden active:scale-95"
            >
              <span className="relative z-10">返回</span>
            </button>
            <button
              ref={playAgainRef}
              onClick={onPlayAgain}
              className={`group relative flex-1 py-4 px-4 rounded-2xl bg-gradient-to-r ${meta.color} text-white font-black shadow-xl shadow-indigo-500/20 hover:shadow-2xl hover:shadow-indigo-500/30 hover:-translate-y-1 active:scale-95 transition-all overflow-hidden border-b-4 border-black/10 active:border-b-0 active:translate-y-1`}
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                <span>再来一局</span>
                <span className="group-hover:rotate-180 transition-transform duration-500">🔄</span>
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:animate-shimmer" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
