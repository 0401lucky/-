import React, { useEffect, useState } from 'react';
import { X, Sparkles, Box, Calendar, Star, Repeat, Loader2 } from 'lucide-react';
import type { CardConfig, Rarity } from '@/lib/cards/types';
import { RARITY_LEVELS, EXCHANGE_PRICES } from '@/lib/cards/constants';

interface CardDetailProps {
  card: CardConfig;
  count: number;
  fragments?: number;
  firstAcquired?: number; // timestamp
  onClose: () => void;
  onExchange?: (cardId: string) => Promise<void>;
}

const RARITY_COLORS: Record<Rarity, { bg: string; text: string; border: string; glow: string }> = {
  legendary_rare: { bg: 'bg-rose-900', text: 'text-rose-100', border: 'border-rose-500', glow: 'shadow-rose-500/50' },
  legendary: { bg: 'bg-amber-500', text: 'text-amber-50', border: 'border-amber-300', glow: 'shadow-amber-500/50' },
  epic: { bg: 'bg-purple-600', text: 'text-purple-100', border: 'border-purple-400', glow: 'shadow-purple-500/50' },
  rare: { bg: 'bg-blue-500', text: 'text-blue-100', border: 'border-blue-300', glow: 'shadow-blue-500/50' },
  common: { bg: 'bg-slate-500', text: 'text-slate-100', border: 'border-slate-300', glow: 'shadow-slate-500/50' },
};

const RARITY_NAMES: Record<Rarity, string> = {
  legendary_rare: '传说稀有',
  legendary: '传说',
  epic: '史诗',
  rare: '稀有',
  common: '普通',
};

export function CardDetail({ card, count, fragments = 0, firstAcquired, onClose, onExchange }: CardDetailProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExchanging, setIsExchanging] = useState(false);
  const styles = RARITY_COLORS[card.rarity] || RARITY_COLORS.common;
  const isOwned = count > 0;
  
  const exchangePrice = EXCHANGE_PRICES[card.rarity];
  const canExchange = fragments >= exchangePrice;

  useEffect(() => {
    setIsVisible(true);
    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onClose, 300); // Wait for animation
  };

  const handleExchange = async () => {
    if (!onExchange || !canExchange || isExchanging) return;
    
    setIsExchanging(true);
    try {
      await onExchange(card.id);
      // Optional: Show success animation? 
      // For now, let the parent handle the update and maybe we just close or stay open
    } catch (error) {
      console.error('Exchange failed', error);
    } finally {
      setIsExchanging(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      
      <div 
        className={`relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden transform transition-all duration-300 ${isVisible ? 'scale-100 translate-y-0' : 'scale-95 translate-y-4'}`}
      >
        {/* Header / Background */}
        <div className={`h-32 ${styles.bg} relative overflow-hidden`}>
          <div className="absolute inset-0 bg-[url('/images/noise.svg')] opacity-20"></div>
          <div className="absolute -bottom-16 -right-16 w-64 h-64 bg-white/10 rounded-full blur-3xl"></div>
          <div className="absolute -top-8 -left-8 w-32 h-32 bg-white/20 rounded-full blur-2xl"></div>
          
          <button 
            onClick={handleClose}
            className="absolute top-4 right-4 p-2 bg-black/20 hover:bg-black/30 text-white rounded-full transition-colors z-10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Card Content */}
        <div className="relative px-6 pb-8">
          {/* Card Image Floating */}
          <div className="relative -mt-20 mb-6 flex justify-center">
            <div className={`
              relative w-48 h-64 rounded-xl shadow-xl overflow-hidden border-4 border-white transform transition-transform duration-500 hover:scale-105
              ${isOwned ? '' : 'grayscale opacity-80'}
            `}>
              <div className={`absolute inset-0 bg-gradient-to-tr ${styles.bg} opacity-20`}></div>
              <img 
                src={card.image} 
                alt={card.name} 
                className="w-full h-full object-cover"
                onError={(e) => {
                  // Fallback for missing images
                  (e.target as HTMLImageElement).src = `https://placehold.co/400x600?text=${card.name}`;
                }}
              />
              
              {!isOwned && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
                  <div className="w-16 h-16 rounded-full bg-black/50 border-2 border-white/30 flex items-center justify-center">
                    <span className="text-3xl">?</span>
                  </div>
                </div>
              )}
            </div>
            
            {/* Rarity Badge */}
            <div className={`absolute -bottom-3 px-4 py-1.5 rounded-full ${styles.bg} text-white text-xs font-bold uppercase tracking-wider shadow-lg border-2 border-white flex items-center gap-1.5`}>
              <Star className="w-3 h-3 fill-white" />
              {RARITY_NAMES[card.rarity]}
            </div>
          </div>

          <div className="text-center space-y-4">
            <h2 className="text-3xl font-black text-slate-800 tracking-tight">{card.name}</h2>
            
            {/* Stats Row */}
            <div className="flex items-center justify-center gap-4 py-4 border-y border-slate-100">
              <div className="flex flex-col items-center gap-1 px-4">
                <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">拥有数量</span>
                <div className="flex items-center gap-1.5 text-slate-700">
                  <Box className="w-4 h-4 text-orange-500" />
                  <span className="text-xl font-black">{count}</span>
                </div>
              </div>
              
              {firstAcquired && (
                <>
                  <div className="w-px h-10 bg-slate-100"></div>
                  <div className="flex flex-col items-center gap-1 px-4">
                    <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">首次获得</span>
                    <div className="flex items-center gap-1.5 text-slate-700">
                      <Calendar className="w-4 h-4 text-blue-500" />
                      <span className="text-sm font-bold">
                        {new Date(firstAcquired).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Description / Lore (Placeholder) */}
            <div className="pt-2">
              <p className="text-slate-500 leading-relaxed text-sm">
                {isOwned 
                  ? `恭喜！这是你收藏的珍稀${RARITY_NAMES[card.rarity]}卡牌。集齐更多卡牌可以兑换丰厚奖励！` 
                  : '你还没有拥有这张卡牌。快去抽卡试试运气吧！'}
              </p>
            </div>
            
            {/* Exchange Action */}
            {onExchange && (
              <div className="pt-4 flex justify-center">
                <button
                  onClick={handleExchange}
                  disabled={!canExchange || isExchanging}
                  className={`
                    w-full py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all
                    ${canExchange 
                      ? 'bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-lg shadow-orange-500/20 hover:shadow-orange-500/40 hover:-translate-y-0.5 active:scale-95' 
                      : 'bg-slate-100 text-slate-400 cursor-not-allowed'}
                  `}
                >
                  {isExchanging ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Repeat className="w-4 h-4" />
                      <span>{exchangePrice} 碎片兑换</span>
                    </>
                  )}
                </button>
              </div>
            )}
            {!canExchange && onExchange && (
              <div className="text-center text-xs text-slate-400 mt-2">
                当前碎片: <span className="text-amber-500 font-bold">{fragments}</span> / {exchangePrice}
              </div>
            )}
            
            {/* Collection Progress */}
            {isOwned && count > 1 && (
               <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 text-orange-600 rounded-lg text-xs font-bold mt-4">
                 <Sparkles className="w-3 h-3" />
                 重复获得 {count - 1} 张
               </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
