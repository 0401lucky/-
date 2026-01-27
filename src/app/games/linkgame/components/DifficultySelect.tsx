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
      <h2 className="text-3xl font-black text-slate-800 text-center mb-10 tracking-tight">
        选择你的挑战难度
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
                group relative overflow-hidden rounded-[2rem] p-6
                bg-white/80 backdrop-blur-md border-4 ${meta.borderColor}
                hover:border-white hover:shadow-[0_15px_40px_-10px_rgba(0,0,0,0.1)]
                hover:-translate-y-2 active:scale-95 transition-all duration-300
                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0
                animate-slide-up text-left
                shadow-lg shadow-black/5
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
                  transition-opacity duration-500
                `}
              />
              
              <div className="relative z-10">
                <div className="flex items-start justify-between mb-4">
                  <div className="text-6xl transform group-hover:scale-110 group-hover:rotate-12 transition-transform duration-300 origin-left filter drop-shadow-sm">
                    {meta.icon}
                  </div>
                  <div className={`
                    bg-white/50 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider
                    ${meta.textColor} group-hover:text-white group-hover:bg-white/20 transition-colors
                  `}>
                    {config.rows} × {config.cols}
                  </div>
                </div>
                
                <h3 className={`text-3xl font-black ${meta.textColor} group-hover:text-white transition-colors mb-2`}>
                  {meta.name}
                </h3>
                
                <p className="text-slate-500 group-hover:text-white/90 transition-colors text-sm mb-6 font-bold leading-relaxed">
                  {meta.description}
                </p>
                
                <div className="pt-4 border-t border-slate-100 group-hover:border-white/20 transition-colors space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400 group-hover:text-white/70 transition-colors font-bold">
                      消除得分
                    </span>
                    <span className="font-black text-slate-700 group-hover:text-white transition-colors bg-white/40 group-hover:bg-white/20 px-2 rounded-lg">
                      {config.baseScore}分
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400 group-hover:text-white/70 transition-colors font-bold">
                      时间限制
                    </span>
                    <span className="font-black text-slate-700 group-hover:text-white transition-colors bg-white/40 group-hover:bg-white/20 px-2 rounded-lg">
                      {Math.floor(config.timeLimit)}秒
                    </span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      
      <p className="text-center text-orange-900/40 text-sm mt-12 font-medium bg-white/30 py-2 px-4 rounded-full inline-block mx-auto backdrop-blur-sm border border-white/40">
        💡 提示：相邻，或同一行/列且中间没有阻挡的相同水果即可消除！
      </p>
    </div>
  );
}
