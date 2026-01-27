
import type { LinkGameDifficulty } from '@/lib/types/game';
import { LINKGAME_DIFFICULTY_CONFIG } from '@/lib/linkgame';

export const FRUIT_EMOJIS: Record<string, string> = {
  'apple': '🍎',
  'orange': '🍊',
  'lemon': '🍋',
  'grape': '🍇',
  'strawberry': '🍓',
  'cherry': '🍒',
  'kiwi': '🥝',
  'peach': '🍑',
};

export const DIFFICULTY_META: Record<LinkGameDifficulty, {
  name: string;
  description: string;
  icon: string;
  color: string;
}> = {
  easy: {
    name: '简单',
    description: '4x4 网格，时间充裕，适合新手',
    icon: '🌱',
    color: 'from-green-400 to-emerald-500',
  },
  normal: {
    name: '普通',
    description: '6x6 网格，适中难度，挑战手速',
    icon: '🔥',
    color: 'from-orange-400 to-red-500',
  },
  hard: {
    name: '困难',
    description: '8x8 网格，争分夺秒，极限挑战',
    icon: '⚡',
    color: 'from-purple-500 to-indigo-600',
  },
};

export { LINKGAME_DIFFICULTY_CONFIG };
