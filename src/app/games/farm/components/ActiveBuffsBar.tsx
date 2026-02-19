// src/app/games/farm/components/ActiveBuffsBar.tsx

'use client';

import { useState, useEffect } from 'react';
import type { ActiveBuff } from '@/lib/types/farm-shop';

interface ActiveBuffsBarProps {
  activeBuffs: ActiveBuff[];
}

const EFFECT_LABELS: Record<string, { short: string; color: string }> = {
  auto_water: { short: '自动浇水', color: 'from-blue-400 to-cyan-400' },
  auto_harvest: { short: '自动收获', color: 'from-amber-400 to-orange-400' },
  pest_shield: { short: '驱虫', color: 'from-green-400 to-emerald-400' },
  weather_shield: { short: '天气保护', color: 'from-purple-400 to-violet-400' },
  yield_bonus: { short: '产量加成', color: 'from-yellow-400 to-amber-400' },
  growth_speed: { short: '加速生长', color: 'from-pink-400 to-rose-400' },
};

const EFFECT_ICONS: Record<string, string> = {
  auto_water: '🐱',
  auto_harvest: '🤖',
  pest_shield: '🛡️',
  weather_shield: '☂️',
  yield_bonus: '⭐',
  growth_speed: '⏩',
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return '已过期';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h${minutes > 0 ? `${minutes}m` : ''}`;
  if (minutes > 0) return `${minutes}m${seconds > 0 ? `${seconds}s` : ''}`;
  return `${seconds}s`;
}

function BuffChip({ buff }: { buff: ActiveBuff }) {
  const [remaining, setRemaining] = useState(buff.expiresAt - Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining(buff.expiresAt - Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [buff.expiresAt]);

  if (remaining <= 0) return null;

  const label = EFFECT_LABELS[buff.effect] ?? { short: buff.effect, color: 'from-gray-400 to-gray-500' };
  const icon = EFFECT_ICONS[buff.effect] ?? '✨';
  const isExpiring = remaining < 5 * 60 * 1000; // 5分钟内

  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r ${label.color} text-white text-xs font-medium shadow-sm whitespace-nowrap shrink-0 ${
        isExpiring ? 'animate-pulse' : ''
      }`}
    >
      <span>{icon}</span>
      <span>{label.short}</span>
      <span className={`font-mono ${isExpiring ? 'text-red-100' : 'text-white/80'}`}>
        {formatCountdown(remaining)}
      </span>
    </div>
  );
}

export default function ActiveBuffsBar({ activeBuffs }: ActiveBuffsBarProps) {
  const now = Date.now();
  const active = activeBuffs.filter(b => b.expiresAt > now);

  if (active.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {active.map((buff, i) => (
        <BuffChip key={`${buff.effect}-${buff.activatedAt}-${i}`} buff={buff} />
      ))}
    </div>
  );
}
