'use client';

import type { LinkGameDifficulty } from '@/lib/types/game';
import { LINKGAME_DIFFICULTY_CONFIG, DIFFICULTY_META } from '../lib/constants';

interface DifficultySelectProps {
  onSelect: (difficulty: LinkGameDifficulty) => void;
  disabled?: boolean;
}

const DIFFICULTIES: LinkGameDifficulty[] = ['easy', 'normal', 'hard'];

export function DifficultySelect({ onSelect, disabled }: DifficultySelectProps) {
  return (
    <div className="w-full max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-slate-900 text-center mb-8">
        选择难度
      </h2>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {DIFFICULTIES.map((difficulty) => {
          const meta = DIFFICULTY_META[difficulty];
          const config = LINKGAME_DIFFICULTY_CONFIG[difficulty];
          
          return (
            <button
              key={difficulty}
              onClick={() => onSelect(difficulty)}
              disabled={disabled}
              className={`
                group relative overflow-hidden rounded-2xl p-6
                bg-gradient-to-br from-white to-slate-50 border-2 border-slate-100
                hover:border-transparent hover:shadow-2xl hover:shadow-slate-200/50
                hover:-translate-y-1 active:scale-95 transition-all duration-300
                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0
                animate-slide-up
              `}
              style={{
                animationDelay: `${DIFFICULTIES.indexOf(difficulty) * 100}ms`,
                animationFillMode: 'backwards'
              }}
            >
              <div 
                className={`
                  absolute inset-0 opacity-0 group-hover:opacity-100
                  bg-gradient-to-br ${meta.color}
                  transition-opacity duration-300
                `}
              />
              
              <div className="relative z-10">
                <div className="text-5xl mb-4 transform group-hover:animate-float transition-transform duration-300">
                  {meta.icon}
                </div>
                
                <h3 className="text-xl font-bold text-slate-900 group-hover:text-white transition-colors mb-2">
                  {meta.name}
                </h3>
                
                <p className="text-slate-500 group-hover:text-white/80 transition-colors text-sm mb-4">
                  {meta.description}
                </p>
                
                <div className="pt-4 border-t border-slate-100 group-hover:border-white/20 transition-colors space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400 group-hover:text-white/60 transition-colors">
                      网格尺寸
                    </span>
                    <span className="font-semibold text-slate-700 group-hover:text-white transition-colors">
                      {config.rows} × {config.cols}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400 group-hover:text-white/60 transition-colors">
                      消除得分
                    </span>
                    <span className="font-semibold text-slate-700 group-hover:text-white transition-colors">
                      {config.baseScore}分/对
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400 group-hover:text-white/60 transition-colors">
                      时间限制
                    </span>
                    <span className="font-semibold text-slate-700 group-hover:text-white transition-colors">
                      {Math.floor(config.timeLimit)}秒
                    </span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      
      <p className="text-center text-slate-400 text-sm mt-8">
        💡 提示：连接相同的两个水果，路径转折不能超过两次！
      </p>
    </div>
  );
}
