// src/app/games/memory/components/Card.tsx

'use client';

import { memo } from 'react';
import { CARD_ICON_MAP } from '../lib/constants';

interface CardProps {
  index: number;
  iconId: string;
  isFlipped: boolean;
  isMatched: boolean;
  isLoading?: boolean;
  onClick: (index: number) => void;
  disabled: boolean;
}

export const Card = memo(function Card({
  index,
  iconId,
  isFlipped,
  isMatched,
  isLoading = false,
  onClick,
  disabled,
}: CardProps) {
  const isRevealed = iconId !== '__hidden__';
  const iconData = isRevealed
    ? (CARD_ICON_MAP[iconId] || { emoji: '❓', color: '#6b7280' })
    : { emoji: '❔', color: '#6b7280' };

  const handleClick = () => {
    if (!disabled && !isFlipped && !isMatched) {
      onClick(index);
    }
  };

  return (
    <div
      className={`
        relative aspect-square cursor-pointer perspective-1000
        ${disabled || isFlipped || isMatched ? 'pointer-events-none' : ''}
      `}
      onClick={handleClick}
    >
      <div
        className={`
          relative w-full h-full transition-transform duration-300 transform-style-3d
          ${isFlipped || isMatched || isRevealed ? 'rotate-y-180' : ''}
        `}
        style={{
          transformStyle: 'preserve-3d',
          transform: isFlipped || isMatched || isRevealed ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* 卡片背面 */}
        <div
          className={`
            absolute inset-0 rounded-xl backface-hidden
            bg-gradient-to-br from-indigo-500 to-purple-600
            flex items-center justify-center
            shadow-lg border-2 border-white/20
            hover:shadow-xl hover:scale-105 transition-all duration-200
            ${!disabled && !isFlipped && !isMatched && !isLoading ? 'hover:from-indigo-400 hover:to-purple-500' : ''}
          `}
          style={{ backfaceVisibility: 'hidden' }}
        >
          <span className="text-3xl sm:text-4xl">🃏</span>
        </div>

        {/* 卡片正面 */}
        <div
          className={`
            absolute inset-0 rounded-xl backface-hidden
            bg-white flex items-center justify-center
            shadow-lg border-2
            ${isMatched ? 'border-green-400 bg-green-50' : 'border-slate-200'}
          `}
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          <span 
            className={`
              text-4xl sm:text-5xl
            ${isMatched ? 'scale-110' : ''}
            transition-transform duration-300
          `}
          style={{ opacity: isLoading ? 0.65 : 1 }}
        >
          {iconData.emoji}
        </span>
        </div>
      </div>
    </div>
  );
});
