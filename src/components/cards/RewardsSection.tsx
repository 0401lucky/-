import React, { useState } from 'react';
import { Trophy, Check, Gift, Loader2 } from 'lucide-react';
import { CARDS } from '@/lib/cards/config';
import { COLLECTION_REWARDS } from '@/lib/cards/constants';
import type { Rarity } from '@/lib/cards/types';

interface RewardsSectionProps {
  inventory: string[];
  claimedRewards: string[];
  onClaim: (type: string) => Promise<void>;
}

const RARITY_LABELS: Record<string, string> = {
  legendary_rare: '传说稀有',
  legendary: '传说',
  epic: '史诗',
  rare: '稀有',
  common: '普通',
  full_set: '全套收集',
};

const RARITY_COLORS: Record<string, string> = {
  legendary_rare: 'text-rose-600 bg-rose-50 border-rose-200',
  legendary: 'text-amber-600 bg-amber-50 border-amber-200',
  epic: 'text-purple-600 bg-purple-50 border-purple-200',
  rare: 'text-blue-600 bg-blue-50 border-blue-200',
  common: 'text-slate-600 bg-slate-50 border-slate-200',
  full_set: 'text-orange-600 bg-orange-50 border-orange-200',
};

export function RewardsSection({ inventory, claimedRewards, onClaim }: RewardsSectionProps) {
  const [claiming, setClaiming] = useState<string | null>(null);

  const getProgress = (type: string) => {
    if (type === 'full_set') {
      const owned = new Set(inventory).size;
      const total = CARDS.length;
      return { owned, total, percent: Math.min(100, Math.round((owned / total) * 100)) };
    }
    
    const rarityCards = CARDS.filter(c => c.rarity === type);
    const owned = rarityCards.filter(c => inventory.includes(c.id)).length;
    const total = rarityCards.length;
    return { owned, total, percent: Math.min(100, Math.round((owned / total) * 100)) };
  };

  const handleClaim = async (type: string) => {
    if (claiming) return;
    setClaiming(type);
    try {
      await onClaim(type);
    } catch (error) {
      console.error('Failed to claim reward', error);
    } finally {
      setClaiming(null);
    }
  };

  const rewardTypes = ['common', 'rare', 'epic', 'legendary', 'legendary_rare', 'full_set'];

  return (
    <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-slate-100 space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-yellow-100 rounded-full text-yellow-600">
          <Trophy className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">图鉴奖励</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rewardTypes.map((type) => {
          const { owned, total, percent } = getProgress(type);
          const isClaimed = claimedRewards.includes(type);
          const canClaim = percent === 100 && !isClaimed;
          const points = COLLECTION_REWARDS[type as Rarity | 'full_set'];
          const styles = RARITY_COLORS[type] || RARITY_COLORS.common;

          return (
            <div 
              key={type}
              className={`
                relative p-4 rounded-2xl border transition-all duration-300
                ${percent === 100 ? 'bg-white shadow-md border-orange-100' : 'bg-slate-50 border-slate-100'}
                ${canClaim ? 'ring-2 ring-orange-400 ring-offset-2' : ''}
              `}
            >
              <div className="flex justify-between items-start mb-3">
                <div className="space-y-1">
                  <div className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full w-fit ${styles}`}>
                    {RARITY_LABELS[type]}
                  </div>
                  <div className="text-2xl font-black text-slate-700">
                    {points} <span className="text-sm font-medium text-slate-400">积分</span>
                  </div>
                </div>
                {isClaimed ? (
                  <div className="flex items-center gap-1 text-green-500 font-bold text-sm bg-green-50 px-2 py-1 rounded-lg">
                    <Check className="w-4 h-4" />
                    已领取
                  </div>
                ) : (
                  <button
                    onClick={() => handleClaim(type)}
                    disabled={!canClaim || !!claiming}
                    className={`
                      flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-bold transition-all
                      ${canClaim 
                        ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-lg shadow-orange-500/30 hover:shadow-orange-500/40 hover:-translate-y-0.5 active:scale-95' 
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'}
                    `}
                  >
                    {claiming === type ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Gift className="w-4 h-4" />
                        领取
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium text-slate-500">
                  <span>收集进度</span>
                  <span>{owned} / {total}</span>
                </div>
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-1000 ${percent === 100 ? 'bg-green-500' : 'bg-orange-400'}`}
                    style={{ width: `${percent}%` }}
                  ></div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
