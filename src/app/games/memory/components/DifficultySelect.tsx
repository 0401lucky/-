// src/app/games/memory/components/DifficultySelect.tsx

'use client';

import { Loader2, Play } from 'lucide-react';
import type { MemoryDifficulty } from '@/lib/types/game';
import { DIFFICULTY_CONFIG, DIFFICULTY_META } from '../lib/constants';

interface DifficultySelectProps {
  selectedDifficulty: MemoryDifficulty;
  onSelect: (difficulty: MemoryDifficulty) => void;
  disabled?: boolean;
  loading?: boolean;
  cooldownRemaining?: number;
}

const DIFFICULTIES: MemoryDifficulty[] = ['easy', 'normal', 'hard'];

export function DifficultySelect({
  selectedDifficulty,
  onSelect,
  disabled,
  loading = false,
  cooldownRemaining = 0,
}: DifficultySelectProps) {
  return (
    <div className="memory-difficulty-wrap">
      <div className="memory-difficulty-grid">
        {DIFFICULTIES.map((difficulty, index) => {
          const meta = DIFFICULTY_META[difficulty];
          const config = DIFFICULTY_CONFIG[difficulty];
          const selected = selectedDifficulty === difficulty;
          
          return (
            <button
              key={difficulty}
              onClick={() => onSelect(difficulty)}
              disabled={disabled}
              className={`memory-difficulty-card group ${selected ? 'is-selected' : ''}`}
              data-difficulty={difficulty}
              style={{ animationDelay: `${index * 100}ms` }}
              type="button"
            >
              <div className={`memory-difficulty-glow bg-gradient-to-br ${meta.color}`} />
              
              <div className="relative z-10 flex h-full flex-col">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="memory-difficulty-icon">{meta.icon}</div>
                  <div className="memory-size-pill">{config.rows} × {config.cols}</div>
                </div>
                
                <h3 className="mb-2 text-3xl font-black text-slate-900 transition-colors group-hover:text-white">
                  {meta.name}
                </h3>
                
                <div className={`memory-selected-start ${selected ? 'is-visible' : ''}`}>
                  {loading && selected ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {selected ? (cooldownRemaining > 0 ? `冷却 ${cooldownRemaining}s` : '再点开始') : '轻触选择'}
                </div>
                
                <div className="mt-auto space-y-2 border-t border-slate-100 pt-4 transition-colors group-hover:border-white/20">
                  <div className="flex justify-between text-sm">
                    <span className="font-bold text-slate-400 transition-colors group-hover:text-white/70">得分范围</span>
                    <span className="rounded-lg bg-white/50 px-2 font-black text-slate-700 transition-colors group-hover:bg-white/20 group-hover:text-white">
                      {config.minScore} - {config.baseScore}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="font-bold text-slate-400 transition-colors group-hover:text-white/70">时间限制</span>
                    <span className="rounded-lg bg-white/50 px-2 font-black text-slate-700 transition-colors group-hover:bg-white/20 group-hover:text-white">
                      {Math.floor(config.timeLimit / 60)}分钟
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
