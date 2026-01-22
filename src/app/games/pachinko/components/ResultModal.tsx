'use client';

import { useEffect, useState } from 'react';
import type { BallLaunch } from '@/lib/types/game';

interface ResultModalProps {
  isOpen: boolean;
  score: number;
  ballResults: BallLaunch[];
  pointsEarned?: number;
  onClose: () => void;
  onPlayAgain: () => void;
}

export function ResultModal({ 
  isOpen, 
  score, 
  ballResults, 
  pointsEarned,
  onClose, 
  onPlayAgain 
}: ResultModalProps) {
  const [showContent, setShowContent] = useState(false);
  
  useEffect(() => {
    if (isOpen) {
      // 延迟显示内容，创建结算动画效果
      const timer = setTimeout(() => setShowContent(true), 500);
      return () => clearTimeout(timer);
    } else {
      setShowContent(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className={`bg-white rounded-3xl p-8 max-w-sm w-full mx-4 shadow-2xl transform transition-all duration-500 border border-slate-100 ${showContent ? 'scale-100 opacity-100 translate-y-0' : 'scale-90 opacity-0 translate-y-4'}`}>
        {/* 标题 */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4 drop-shadow-sm">🎉</div>
          <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">游戏结束</h2>
        </div>

        {/* 得分 */}
        <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border border-orange-100 rounded-2xl p-6 mb-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-yellow-400 to-orange-500 opacity-10 rounded-bl-full"></div>
          <div className="text-center relative z-10">
            <div className="text-sm font-bold text-orange-600/70 uppercase tracking-wider mb-1">总得分</div>
            <div className="text-5xl font-extrabold text-slate-900">{score}</div>
          </div>
        </div>

        {/* 获得积分 */}
        {pointsEarned !== undefined && (
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-100 rounded-2xl p-4 mb-6">
            <div className="flex items-center justify-between px-2">
              <span className="text-sm font-bold text-green-700">获得积分</span>
              <span className="text-2xl font-bold text-green-600">+{pointsEarned}</span>
            </div>
          </div>
        )}

        {/* 弹珠详情 */}
        <div className="mb-8">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 text-center">弹珠详情</div>
          <div className="flex justify-center gap-2">
            {ballResults.map((ball, i) => (
              <div 
                key={i}
                className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border transition-all hover:scale-110 shadow-sm ${
                   ball.slotScore === 80 
                     ? 'bg-red-50 border-red-200 text-red-600' 
                     : 'bg-slate-50 border-slate-200 text-slate-500'
                }`}
              >
                {ball.slotScore}
              </div>
            ))}
          </div>
        </div>

        {/* 按钮 */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl transition-all active:scale-95"
          >
            返回
          </button>
          <button
            onClick={onPlayAgain}
            className="flex-1 py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-xl active:scale-95 flex items-center justify-center gap-2"
          >
            <span>🔄</span> 再来一局
          </button>
        </div>
      </div>
    </div>
  );
}
