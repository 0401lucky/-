
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
  textColor: string;
  borderColor: string;
}> = {
  easy: {
    name: '简单',
    description: '4x4 轻松休闲，适合新手宝宝',
    icon: '🌱',
    color: 'from-emerald-300 to-teal-400',
    textColor: 'text-emerald-600',
    borderColor: 'border-emerald-200',
  },
  normal: {
    name: '普通',
    description: '6x6 适中难度，挑战手速',
    icon: '🍬',
    color: 'from-pink-400 to-rose-400',
    textColor: 'text-pink-600',
    borderColor: 'border-pink-200',
  },
  hard: {
    name: '困难',
    description: '8x8 争分夺秒，极限挑战',
    icon: '⚡',
    color: 'from-violet-400 to-fuchsia-500',
    textColor: 'text-violet-600',
    borderColor: 'border-violet-200',
  },
};

export { LINKGAME_DIFFICULTY_CONFIG };
