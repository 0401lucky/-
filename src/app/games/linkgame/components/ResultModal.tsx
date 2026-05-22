'use client';

import { ArrowLeft, Clock3, Play, Trophy } from 'lucide-react';
import { DIFFICULTY_META } from '../lib/constants';
import { calculateLinkGamePointReward } from '@/lib/linkgame';
import type { LinkGameDifficulty } from '@/lib/types/game';

interface ResultModalProps {
  isOpen: boolean;
  difficulty: LinkGameDifficulty;
  score: number;
  pointsEarned: number;
  completed: boolean;
  matchedPairs: number;
  moves: number;
  duration: number;
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
  moves,
  duration,
  onPlayAgain,
  onBackToGames,
}: ResultModalProps) {
  if (!isOpen) return null;

  const meta = DIFFICULTY_META[difficulty];
  const won = completed;
  const expectedReward = calculateLinkGamePointReward(score);

  return (
    <div className="link-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="linkgame-settlement-title">
      <div className={`link-result-modal ${won ? 'won' : 'lost'}`}>
        <div className="flex flex-col items-center text-center">
          <div className={`link-result-icon ${won ? 'won' : 'lost'}`}>
            {won ? <Trophy className="h-9 w-9" /> : <Clock3 className="h-9 w-9" />}
          </div>
          <div className="mt-5 text-xs font-black uppercase tracking-wider text-emerald-700/80">
            本局结算
          </div>
          <h2 id="linkgame-settlement-title" className="mt-1 text-2xl font-black text-slate-950">
            {won ? '胜利结算完成' : '失败结算完成'}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            本局得分 {score}，按得分 1% 结算，获得 {pointsEarned} 福利积分。
          </p>
        </div>

        <div className="mt-5 rounded-2xl border border-emerald-100 bg-white px-5 py-3 text-center text-sm font-black text-emerald-700 shadow-sm">
          最终福利积分 = {score} × 1% = {expectedReward}
          {pointsEarned !== expectedReward ? `，实际到账 ${pointsEarned}` : ''}
        </div>

        <div className="link-result-stats">
          <LinkResultStat label="难度" value={meta.name} />
          <LinkResultStat label="用时" value={formatDuration(duration)} />
          <LinkResultStat label="完成对数" value={`${matchedPairs} 对`} />
          <LinkResultStat label="操作" value={`${moves} 次`} />
          <LinkResultStat label="得分" value={String(score)} />
          <LinkResultStat label="奖励" value={`${pointsEarned}`} />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            onClick={onBackToGames}
            className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-white px-5 py-3 text-sm font-black text-emerald-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-emerald-50"
            type="button"
          >
            <ArrowLeft className="h-4 w-4" />
            返回游戏中心
          </button>
          <button
            onClick={onPlayAgain}
            className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-200 transition-all hover:-translate-y-0.5 hover:bg-emerald-500"
            type="button"
          >
            <Play className="h-4 w-4" />
            继续选择难度
          </button>
        </div>
      </div>
    </div>
  );
}

function LinkResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="link-result-stat">
      <div className="text-xs font-black text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-black text-slate-950">{value}</div>
    </div>
  );
}

function formatDuration(duration: number): string {
  const safe = Math.max(0, Math.ceil(duration / 1000));
  const min = Math.floor(safe / 60);
  const sec = safe % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
