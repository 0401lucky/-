'use client';

import { Trophy, Star, Skull, Zap } from 'lucide-react';

interface ResultModalProps {
  floorsClimbed: number;
  finalPower: number;
  gameOver: boolean;
  score: number;
  pointsEarned: number;
  onPlayAgain: () => void;
  onBackToGames: () => void;
}

export default function ResultModal({
  floorsClimbed,
  finalPower,
  gameOver,
  score,
  pointsEarned,
  onPlayAgain,
  onBackToGames,
}: ResultModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-300 slide-in-from-bottom-8">
        <div className="text-center relative">
          <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-40 h-40 bg-yellow-300 rounded-full blur-3xl opacity-20 pointer-events-none" />

          <div className="relative inline-flex mb-6">
            <div className={`w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg transform rotate-3 ${
              gameOver
                ? 'bg-gradient-to-br from-red-400 to-red-600 shadow-red-200'
                : 'bg-gradient-to-br from-yellow-400 to-orange-500 shadow-orange-200'
            }`}>
              {gameOver ? (
                <Skull className="w-10 h-10 text-white drop-shadow-md" />
              ) : (
                <Trophy className="w-10 h-10 text-white drop-shadow-md" />
              )}
            </div>
            <div className="absolute -top-2 -right-2 bg-white rounded-full p-1 shadow-sm">
              <Star className="w-6 h-6 text-yellow-500 fill-yellow-500" />
            </div>
          </div>

          <h3 className="text-2xl font-black text-slate-900 mb-1">
            {gameOver ? '挑战结束!' : '成功突破!'}
          </h3>
          <p className="text-slate-500 text-sm mb-8 font-medium">
            {gameOver ? '遇到了比你更强的敌人...' : '完成了所有挑战！'}
          </p>

          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl p-4 border border-slate-200">
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1 font-bold">到达层数</div>
              <div className="text-3xl font-black text-slate-900 tabular-nums tracking-tight flex items-center justify-center gap-1">
                {floorsClimbed}
                <span className="text-base font-normal text-slate-400">层</span>
              </div>
            </div>

            <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl p-4 border border-slate-200">
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1 font-bold">最终力量</div>
              <div className="text-3xl font-black text-slate-900 tabular-nums tracking-tight flex items-center justify-center gap-1">
                <Zap className="w-5 h-5 text-yellow-500" />
                {finalPower}
              </div>
            </div>

            <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100 flex flex-col items-center justify-center">
              <div className="text-xs text-emerald-600 uppercase tracking-wider mb-1 font-bold">获得积分</div>
              <div className="text-xl font-black text-emerald-600 tabular-nums">+{pointsEarned}</div>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex flex-col items-center justify-center">
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-1 font-bold">游戏得分</div>
              <div className="text-xl font-black text-slate-700 tabular-nums">{score}</div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onBackToGames}
              className="flex-1 py-3.5 px-4 border-2 border-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-50 hover:border-slate-200 transition-colors active:scale-[0.98]"
              type="button"
            >
              返回
            </button>
            <button
              onClick={onPlayAgain}
              className="flex-1 py-3.5 px-4 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-2xl transition-all shadow-lg shadow-slate-200 hover:shadow-xl hover:-translate-y-0.5 active:scale-[0.98]"
              type="button"
            >
              再来一局
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
