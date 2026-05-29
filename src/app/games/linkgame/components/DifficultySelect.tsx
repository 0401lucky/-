'use client';

import { Loader2, Play } from 'lucide-react';
import type { LinkGameDifficulty } from '@/lib/types/game';
import { LINKGAME_DIFFICULTY_CONFIG, DIFFICULTY_META } from '../lib/constants';

interface DifficultySelectProps {
  onSelect: (difficulty: LinkGameDifficulty) => void;
  selectedDifficulty: LinkGameDifficulty;
  disabled?: boolean;
  loading?: boolean;
  cooldownRemaining?: number;
}

const DIFFICULTIES: LinkGameDifficulty[] = ['easy', 'normal', 'hard'];

export function DifficultySelect({
  onSelect,
  selectedDifficulty,
  disabled,
  loading = false,
  cooldownRemaining = 0,
}: DifficultySelectProps) {
  return (
    <div className="link-difficulty-wrap">
      <h3 className="text-center text-3xl font-black tracking-tight text-slate-800">
        选择你的挑战难度
      </h3>

      <div className="link-difficulty-grid">
        {DIFFICULTIES.map((difficulty) => {
          const meta = DIFFICULTY_META[difficulty];
          const config = LINKGAME_DIFFICULTY_CONFIG[difficulty];
          const selected = selectedDifficulty === difficulty;
          const sizeLabel = config.mode === 'stack3d'
            ? `${config.rows} × ${config.cols} × ${config.depth ?? 1}`
            : `${config.rows} × ${config.cols}`;
          
          return (
            <button
              key={difficulty}
              onClick={() => onSelect(difficulty)}
              disabled={disabled}
              className={`link-difficulty-card group ${meta.borderColor} ${selected ? 'is-selected' : ''}`}
              style={{
                animationDelay: `${DIFFICULTIES.indexOf(difficulty) * 100}ms`,
                animationFillMode: 'backwards'
              }}
              type="button"
            >
              <div 
                className={`link-difficulty-glow bg-gradient-to-br ${meta.color}`}
              />
              
              <div className="relative z-10">
                <div className="flex items-start justify-between mb-4">
                  <div className="link-difficulty-icon">
                    {meta.icon}
                  </div>
                  <div className={`link-size-pill ${meta.textColor}`}>
                    {sizeLabel}
                  </div>
                </div>
                
                <h3 className={`text-3xl font-black ${meta.textColor} group-hover:text-white transition-colors mb-2`}>
                  {meta.name}
                </h3>
                
                <p className="text-slate-500 group-hover:text-white/90 transition-colors text-sm mb-6 font-bold leading-relaxed">
                  {meta.description}
                </p>

                <div className={`link-selected-start mb-5 ${selected ? 'is-visible' : ''}`}>
                  {loading && selected ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {selected ? (cooldownRemaining > 0 ? `冷却 ${cooldownRemaining}s` : '再点开始') : '轻触选择'}
                </div>
                
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
    </div>
  );
}
