'use client';

import type { ReactNode } from 'react';
import { Clock3, Gauge, Lightbulb, Shuffle, Trophy, Zap } from 'lucide-react';

interface GameHeaderProps {
  timeRemaining: number;
  score: number;
  combo: number;
  hintsRemaining: number;
  shufflesRemaining: number;
  matchedPairs: number;
  totalPairs: number;
  onHint: () => void;
  onShuffle: () => void;
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function GameHeader({
  timeRemaining,
  score,
  combo,
  hintsRemaining,
  shufflesRemaining,
  matchedPairs,
  totalPairs,
  onHint,
  onShuffle,
}: GameHeaderProps) {
  return (
    <>
      <div className="link-status-grid">
        <LinkStat icon={<Clock3 className="h-4 w-4" />} label="剩余" value={formatTime(timeRemaining)} urgent={timeRemaining < 30} />
        <LinkStat icon={<Trophy className="h-4 w-4" />} label="得分" value={String(score)} />
        <LinkStat icon={<Zap className="h-4 w-4" />} label="连击" value={`${combo}x`} />
        <LinkStat icon={<Gauge className="h-4 w-4" />} label="进度" value={`${matchedPairs}/${totalPairs}`} />
      </div>

      <div className="link-action-grid">
        <button
          onClick={onHint}
          disabled={hintsRemaining <= 0}
          className="link-action-btn border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
          type="button"
          title="提示"
        >
          <Lightbulb className="h-4 w-4" />
          {hintsRemaining}
        </button>
        <button
          onClick={onShuffle}
          disabled={shufflesRemaining <= 0}
          className="link-action-btn border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
          type="button"
          title="重排"
        >
          <Shuffle className="h-4 w-4" />
          {shufflesRemaining}
        </button>
      </div>
    </>
  );
}

function LinkStat({
  icon,
  label,
  value,
  urgent = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  urgent?: boolean;
}) {
  return (
    <div className={`link-stat-card ${urgent ? 'border-rose-200 bg-rose-50 text-rose-700' : ''}`}>
      <div className="flex items-center gap-2 text-xs font-black text-slate-500">
        {icon}
        {label}
      </div>
      <div className={`mt-2 text-xl font-black tabular-nums ${urgent ? 'text-rose-600' : 'text-slate-950'}`}>
        {value}
      </div>
    </div>
  );
}
