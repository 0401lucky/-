import React, { useState, useMemo, useCallback } from 'react';
import Image from 'next/image';
import { Search, Filter, ArrowUpDown, LayoutGrid, Award } from 'lucide-react';
import { CardConfig, Rarity } from '@/lib/cards/types';
import { RARITY_LEVELS } from '@/lib/cards/constants';
import { CardDetail } from './CardDetail';

interface CardGridProps {
  cards: CardConfig[];
  inventory: string[]; // List of card IDs owned by user
  fragments?: number;
  onRefresh?: () => void;
  onExchange?: (cardId: string) => Promise<void>;
}

type SortOption = 'rarity_desc' | 'rarity_asc' | 'count_desc' | 'name_asc';
type FilterRarity = Rarity | 'all' | 'owned' | 'missing';

const RARITY_LABELS: Record<Rarity, string> = {
  legendary_rare: '传说稀有',
  legendary: '传说',
  epic: '史诗',
  rare: '稀有',
  common: '普通',
};

const RARITY_COLORS: Record<Rarity, string> = {
  legendary_rare: 'from-rose-500 to-rose-600',
  legendary: 'from-amber-400 to-amber-500',
  epic: 'from-purple-500 to-purple-600',
  rare: 'from-blue-400 to-blue-500',
  common: 'from-slate-400 to-slate-500',
};

export function CardGrid({ cards, inventory, fragments = 0, onExchange }: CardGridProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<FilterRarity>('all');
  const [sortBy, setSortBy] = useState<SortOption>('rarity_desc');
  const [selectedCard, setSelectedCard] = useState<CardConfig | null>(null);

  // Process inventory to get counts
  const inventoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    inventory.forEach(id => {
      counts[id] = (counts[id] || 0) + 1;
    });
    return counts;
  }, [inventory]);

  // Filter and Sort Cards
  const displayedCards = useMemo(() => {
    let result = [...cards];

    // Filter
    if (filter !== 'all') {
      if (filter === 'owned') {
        result = result.filter(c => (inventoryCounts[c.id] || 0) > 0);
      } else if (filter === 'missing') {
        result = result.filter(c => (inventoryCounts[c.id] || 0) === 0);
      } else {
        result = result.filter(c => c.rarity === filter);
      }
    }

    // Search
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(c => c.name.toLowerCase().includes(term));
    }

    // Sort
    result.sort((a, b) => {
      const countA = inventoryCounts[a.id] || 0;
      const countB = inventoryCounts[b.id] || 0;
      const levelA = RARITY_LEVELS[a.rarity];
      const levelB = RARITY_LEVELS[b.rarity];

      switch (sortBy) {
        case 'rarity_desc':
          return levelB - levelA || countB - countA;
        case 'rarity_asc':
          return levelA - levelB || countB - countA;
        case 'count_desc':
          return countB - countA || levelB - levelA;
        case 'name_asc':
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

    return result;
  }, [cards, inventoryCounts, filter, searchTerm, sortBy]);

  // Collection Stats
  const stats = useMemo(() => {
    const total = cards.length;
    const owned = cards.filter(c => (inventoryCounts[c.id] || 0) > 0).length;
    return { total, owned, percentage: Math.round((owned / total) * 100) };
  }, [cards, inventoryCounts]);

  return (
    <div className="space-y-6">
      {/* Controls Bar */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-4 md:space-y-0 md:flex md:items-center md:justify-between gap-4">
        
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="搜索卡牌..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400 transition-all"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 scrollbar-hide">
          {/* Filter Dropdown */}
          <div className="relative group">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterRarity)}
              className="appearance-none pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-200 cursor-pointer min-w-[140px]"
            >
              <option value="all">全部卡牌</option>
              <option value="owned">已拥有</option>
              <option value="missing">未拥有</option>
              <hr />
              {Object.entries(RARITY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>

          {/* Sort Dropdown */}
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="appearance-none pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-200 cursor-pointer min-w-[140px]"
            >
              <option value="rarity_desc">稀有度 ↓</option>
              <option value="rarity_asc">稀有度 ↑</option>
              <option value="count_desc">数量 ↓</option>
              <option value="name_asc">名称</option>
            </select>
            <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="flex items-center justify-between px-2">
        <div className="flex items-center gap-2 text-slate-600 font-bold">
          <LayoutGrid className="w-5 h-5 text-orange-500" />
          <span>收集进度</span>
        </div>
        <div className="flex items-center gap-2">
           <span className="text-2xl font-black text-slate-800">{stats.owned}</span>
           <span className="text-slate-400 font-medium">/ {stats.total}</span>
           <span className="px-2 py-0.5 bg-orange-100 text-orange-600 text-xs font-bold rounded-full">{stats.percentage}%</span>
        </div>
      </div>
      <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-orange-400 to-red-500 transition-all duration-1000 ease-out"
          style={{ width: `${stats.percentage}%` }}
        ></div>
      </div>

      {/* Grid */}
      {displayedCards.length === 0 ? (
        <div className="py-20 text-center text-slate-400 bg-white rounded-3xl border border-slate-100 border-dashed">
          <Award className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p>没有找到匹配的卡牌</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {displayedCards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              count={inventoryCounts[card.id] || 0}
              onClick={() => setSelectedCard(card)}
            />
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedCard && (
        <CardDetail
          card={selectedCard}
          count={inventoryCounts[selectedCard.id] || 0}
          fragments={fragments}
          onExchange={onExchange}
          onClose={() => setSelectedCard(null)}
        />
      )}
    </div>
  );
}

// Memoized Card Item for better performance
const CardItem = React.memo(function CardItem({
  card,
  count,
  onClick
}: {
  card: CardConfig;
  count: number;
  onClick: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const isOwned = count > 0;
  const rarityColor = RARITY_COLORS[card.rarity];

  return (
    <button
      onClick={onClick}
      className={`
        group relative aspect-[3/4] rounded-xl overflow-hidden transition-all duration-300
        ${isOwned
          ? 'shadow-md hover:shadow-xl hover:-translate-y-1 cursor-pointer bg-white'
          : 'bg-slate-100 opacity-70 grayscale hover:opacity-100 hover:grayscale-0'}
      `}
    >
      {/* Loading Skeleton */}
      {!loaded && (
        <div className="absolute inset-0 bg-gradient-to-br from-slate-200 to-slate-300 animate-pulse" />
      )}

      <Image
        src={card.image}
        alt={card.name}
        fill
        sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 16vw"
        className={`object-cover transition-all duration-700 group-hover:scale-110 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />

      {/* Overlay Gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />

      {/* Content */}
      <div className="absolute inset-x-0 bottom-0 p-3 text-left">
        <div className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold text-white mb-1 bg-gradient-to-r ${rarityColor} shadow-sm`}>
          {RARITY_LABELS[card.rarity]}
        </div>
        <h3 className="text-white font-bold text-sm truncate drop-shadow-md">{card.name}</h3>

        {isOwned && (
          <div className="absolute top-2 right-2 flex items-center justify-center w-6 h-6 bg-orange-500 text-white text-xs font-bold rounded-full shadow-lg border border-white">
            {count}
          </div>
        )}
      </div>

      {/* Unowned Question Mark */}
      {!isOwned && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-4xl font-black text-white/40 drop-shadow-lg">?</span>
        </div>
      )}
    </button>
  );
});
