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
  const isFaceUp = isFlipped || isMatched || isRevealed || isLoading;
  const iconData = isLoading && !isRevealed
    ? { emoji: '…', color: '#0891b2' }
    : isRevealed
    ? (CARD_ICON_MAP[iconId] || { emoji: '❓', color: '#6b7280' })
    : { emoji: '❔', color: '#6b7280' };

  const handleClick = () => {
    if (!disabled && !isFlipped && !isMatched) {
      onClick(index);
    }
  };

  return (
    <button
      type="button"
      className="memory-card"
      onClick={handleClick}
      disabled={disabled || isFlipped || isMatched}
      aria-label={`${index + 1} 号记忆卡${isMatched ? '，已配对' : isLoading ? '，正在翻开' : isFlipped || isRevealed ? `，${iconData.emoji}` : '，未翻开'}`}
    >
      <div
        className="memory-card-inner"
        style={{
          transformStyle: 'preserve-3d',
          transform: isFaceUp ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* 卡片背面 */}
        <div
          className="memory-card-back"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <span>🃏</span>
        </div>

        {/* 卡片正面 */}
        <div
          className={`memory-card-front ${isMatched ? 'is-matched' : ''} ${isLoading ? 'is-loading' : ''}`}
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          <span
            className={isMatched ? 'is-pop' : ''}
            style={{ opacity: isLoading ? 0.65 : 1 }}
          >
            {iconData.emoji}
          </span>
        </div>
      </div>
    </button>
  );
});
