'use client';

import { Trophy, Star, Skull, Zap, Flame, Shield, Swords } from 'lucide-react';
import { formatPower, DIFFICULTY_LABELS } from '@/lib/tower-engine';
import type { TowerDifficulty } from '@/lib/tower-engine';

interface ResultModalProps {
  floorsClimbed: number;
  finalPower: number;
  gameOver: boolean;
  score: number;
  pointsEarned: number;
  bossesDefeated?: number;
  maxCombo?: number;
  basePoints?: number;
  bossPoints?: number;
  comboPoints?: number;
  perfectPoints?: number;
  difficulty?: TowerDifficulty;
  difficultyMultiplier?: number;
  onPlayAgain: () => void;
  onBackToGames: () => void;
}

export default function ResultModal({
  floorsClimbed,
  finalPower,
  gameOver,
  score,
  pointsEarned,
  bossesDefeated = 0,
  maxCombo = 0,
  basePoints,
  bossPoints = 0,
  comboPoints = 0,
  perfectPoints = 0,
  difficulty,
  difficultyMultiplier,
  onPlayAgain,
  onBackToGames,
}: ResultModalProps) {
  const hasBreakdown = basePoints !== undefined;
  const showDiffMult = difficultyMultiplier && difficultyMultiplier > 1;


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-fade-in" />

      {/* 弹窗主体 */}
      <div className="relative bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl p-8 max-w-sm w-full border border-white/50 animate-pop-in overflow-hidden">
        {/* 装饰背景 */}
        <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 opacity-10" />
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-pink-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob" />
        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-indigo-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000" />

        {/* 标题部分 */}
        <div className="relative text-center mb-8">
          <div className="inline-block p-4 rounded-full bg-gradient-to-br from-indigo-100 to-white shadow-inner mb-4 animate-float">
            {gameOver ? (
              <Skull className="w-12 h-12 text-slate-400" />
            ) : (
              <Trophy className="w-12 h-12 text-yellow-500 drop-shadow-sm" />
            )}
          </div>
          <h2 className="text-3xl font-black text-slate-800 mb-1 tracking-tight">
            {!gameOver ? (
              <span className="bg-gradient-to-r from-indigo-600 to-pink-600 bg-clip-text text-transparent">
                挑战成功!
              </span>
            ) : (
              <span className="text-slate-700">游戏结束</span>
            )}
          </h2>
          <p className="text-slate-500 font-medium">
            {!gameOver ? '你已经登顶成功！' : '下次继续加油！'}
          </p>
        </div>

        {/* 成绩卡片 */}
        <div className="relative grid grid-cols-2 gap-3 mb-8">
          <div className="bg-white/50 rounded-2xl p-4 border border-white/60 shadow-sm flex flex-col items-center justify-center">
            <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">Score</div>
            <div className="text-2xl font-black text-indigo-600 tabular-nums">
              {score.toLocaleString()}
            </div>
          </div>

          <div className="bg-white/50 rounded-2xl p-4 border border-white/60 shadow-sm flex flex-col items-center justify-center">
            <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">Floors</div>
            <div className="text-2xl font-black text-slate-700 tabular-nums">
              {floorsClimbed} <span className="text-sm font-normal text-slate-400">/ 50</span>
            </div>
          </div>

          <div className="col-span-2 bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl p-4 border border-amber-100 shadow-sm flex items-center justify-between px-6">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              <span className="text-sm font-bold text-amber-700">最终战力</span>
            </div>
            <div className="text-xl font-black text-amber-600 tabular-nums">
              {formatPower(finalPower)}
            </div>
          </div>
        </div>

        {/* 详细得分列表（仅胜利显示） */}
        {!gameOver && hasBreakdown && (
          <div className="bg-slate-50/80 rounded-xl p-4 mb-8 text-sm space-y-2 border border-slate-100">
            <div className="flex justify-between text-slate-600">
              <span>基础分</span>
              <span className="font-bold">{basePoints}</span>
            </div>
            {(bossPoints > 0) && (
              <div className="flex justify-between text-emerald-600">
                <span>Boss 击杀奖励</span>
                <span className="font-bold">+{bossPoints}</span>
              </div>
            )}
            {(comboPoints > 0) && (
              <div className="flex justify-between text-purple-600">
                <span>连击加成</span>
                <span className="font-bold">+{comboPoints}</span>
              </div>
            )}
            {showDiffMult && (
              <div className="flex justify-between text-orange-600">
                <span>难度倍率</span>
                <span className="font-bold">x{difficultyMultiplier}</span>
              </div>
            )}
            <div className="pt-2 border-t border-slate-200 flex justify-between font-black text-slate-800 text-base">
              <span>总分</span>
              <span>{score}</span>
            </div>
          </div>
        )}

        {/* 按钮组 */}
        <div className="relative space-y-3">
          <button
            onClick={onPlayAgain}
            className="w-full py-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold text-lg shadow-lg shadow-indigo-200 hover:shadow-indigo-300 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 group"
          >
            <div className="group-hover:rotate-180 transition-transform duration-500">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
            </div>
            {!gameOver ? '再玩一次' : '重新开始'}
          </button>

          <div onClick={onBackToGames} className="block cursor-pointer">
            <button className="w-full py-4 rounded-xl bg-white text-slate-600 font-bold border-2 border-slate-100 hover:border-slate-200 hover:bg-slate-50 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
              返回游戏列表
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
