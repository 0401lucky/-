'use client';

import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (isOpen && completed) {
      const duration = 3000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 60 };

      const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

      const interval: any = setInterval(function() {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
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

      return () => clearInterval(interval);
    }
  }, [isOpen, completed]);

  useEffect(() => {
    if (isOpen) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-300" />
      
      <div className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-bounce-in">
        <div className={`h-32 bg-gradient-to-br ${meta.color} flex items-center justify-center relative overflow-hidden`}>
          <div className="absolute inset-0 bg-white/10 animate-pulse" />
          
          {completed && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              {['🎉', '⭐', '✨', '🎊'].map((emoji, i) => (
                <span 
                  key={i}
                  className="absolute animate-confetti text-2xl"
                  style={{
                    left: `${20 + i * 20}%`,
                    animationDelay: `${i * 150}ms`
                  }}
                >
                  {emoji}
                </span>
              ))}
            </div>
          )}

          <div className="text-center text-white relative z-10">
            <div className="text-6xl mb-2 animate-bounce">
              {completed ? '🎉' : '⏰'}
            </div>
            <div className="text-xl font-bold">
              {completed ? '恭喜通关！' : '时间到！'}
            </div>
          </div>
        </div>
        
        <div className="p-6">
          <div className="space-y-4">
            <div className="flex justify-between items-center py-3 border-b border-slate-100">
              <span className="text-slate-500">难度</span>
              <span className="font-semibold text-slate-900 flex items-center gap-2">
                <span>{meta.icon}</span>
                {meta.name}
              </span>
            </div>
            
            <div className="flex justify-between items-center py-3 border-b border-slate-100">
              <span className="text-slate-500">完成对数</span>
              <span className="font-semibold text-slate-900">{matchedPairs} 对</span>
            </div>
            
            <div className="flex justify-between items-center py-3 border-b border-slate-100">
              <span className="text-slate-500">游戏得分</span>
              <span className="font-bold text-xl text-slate-900 tabular-nums">{displayScore}</span>
            </div>
            
            <div className="flex justify-between items-center py-4 bg-gradient-to-r from-yellow-50 to-orange-50 -mx-6 px-6">
              <span className="text-slate-700 font-medium">获得积分</span>
              <span className="font-bold text-2xl text-orange-500 flex items-center gap-1">
                <span>⭐</span>
                +{pointsEarned}
              </span>
            </div>
            
            {pointsEarned < score && (
              <p className="text-center text-sm text-slate-400">
                今日积分已达上限，部分积分未发放
              </p>
            )}
          </div>
          
          <div className="mt-6 flex gap-3">
            <button
              onClick={onBackToGames}
              className="group relative flex-1 py-3 px-4 rounded-xl border-2 border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-colors overflow-hidden"
            >
              <span className="relative z-10">返回</span>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-slate-100/50 to-transparent -translate-x-full group-hover:animate-shimmer" />
            </button>
            <button
              onClick={onPlayAgain}
              className={`group relative flex-1 py-3 px-4 rounded-xl bg-gradient-to-r ${meta.color} text-white font-semibold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all overflow-hidden`}
            >
              <span className="relative z-10">再来一局</span>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:animate-shimmer" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
