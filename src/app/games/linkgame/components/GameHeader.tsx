'use client';

import type { ReactNode } from 'react';
import { Clock3, Gauge, Trophy, Zap } from 'lucide-react';

interface GameHeaderProps {
  timeRemaining: number;
  score: number;
  combo: number;
  bonusLabel?: string;
  bonusValue?: string;
  matchedPairs: number;
  totalPairs: number;
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
  bonusLabel,
  bonusValue,
  matchedPairs,
  totalPairs,
}: GameHeaderProps) {
  return (
    <div className="link-status-grid">
      <LinkStat icon={<Clock3 className="h-4 w-4" />} label="剩余" value={formatTime(timeRemaining)} urgent={timeRemaining < 30} />
      <LinkStat icon={<Trophy className="h-4 w-4" />} label="得分" value={String(score)} />
      <LinkStat icon={<Zap className="h-4 w-4" />} label={bonusLabel ?? '连击'} value={bonusValue ?? `${combo}x`} />
      <LinkStat icon={<Gauge className="h-4 w-4" />} label="进度" value={`${matchedPairs}/${totalPairs}`} />
    </div>
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
