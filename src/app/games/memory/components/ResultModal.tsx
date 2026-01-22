// src/app/games/memory/components/ResultModal.tsx

'use client';

import { DIFFICULTY_META } from '../lib/constants';
import type { MemoryDifficulty } from '@/lib/types/game';

interface ResultModalProps {
  isOpen: boolean;
  difficulty: MemoryDifficulty;
  moves: number;
  completed: boolean;
  score: number;
  pointsEarned: number;
  duration: number;
  onPlayAgain: () => void;
  onBackToGames: () => void;
}

export function ResultModal({
  isOpen,
  difficulty,
  moves,
  completed,
  score,
  pointsEarned,
  duration,
  onPlayAgain,
  onBackToGames,
}: ResultModalProps) {
  if (!isOpen) return null;

  const meta = DIFFICULTY_META[difficulty];
  const durationSeconds = Math.floor(duration / 1000);
  const mins = Math.floor(durationSeconds / 60);
  const secs = durationSeconds % 60;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      
      {/* 弹窗内容 */}
      <div className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-300">
        {/* 顶部装饰 */}
        <div className={`h-32 bg-gradient-to-br ${meta.color} flex items-center justify-center`}>
          <div className="text-center text-white">
            <div className="text-6xl mb-2">
              {completed ? '🎉' : '⏰'}
            </div>
            <div className="text-xl font-bold">
              {completed ? '恭喜完成！' : '时间到！'}
            </div>
          </div>
        </div>
        
        {/* 结果详情 */}
        <div className="p-6">
          <div className="space-y-4">
            {/* 难度 */}
            <div className="flex justify-between items-center py-3 border-b border-slate-100">
              <span className="text-slate-500">难度</span>
              <span className="font-semibold text-slate-900 flex items-center gap-2">
                <span>{meta.icon}</span>
                {meta.name}
              </span>
            </div>
            
            {/* 步数 */}
            <div className="flex justify-between items-center py-3 border-b border-slate-100">
              <span className="text-slate-500">总步数</span>
              <span className="font-semibold text-slate-900">{moves} 步</span>
            </div>
            
            {/* 用时 */}
            <div className="flex justify-between items-center py-3 border-b border-slate-100">
              <span className="text-slate-500">用时</span>
              <span className="font-semibold text-slate-900">
                {mins > 0 ? `${mins}分` : ''}{secs}秒
              </span>
            </div>
            
            {/* 游戏得分 */}
            <div className="flex justify-between items-center py-3 border-b border-slate-100">
              <span className="text-slate-500">游戏得分</span>
              <span className="font-bold text-xl text-slate-900">{score}</span>
            </div>
            
            {/* 获得积分 */}
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
          
          {/* 按钮 */}
          <div className="mt-6 flex gap-3">
            <button
              onClick={onBackToGames}
              className="flex-1 py-3 px-4 rounded-xl border-2 border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-colors"
            >
              返回
            </button>
            <button
              onClick={onPlayAgain}
              className={`flex-1 py-3 px-4 rounded-xl bg-gradient-to-r ${meta.color} text-white font-semibold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all`}
            >
              再来一局
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
