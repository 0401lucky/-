
import type { LinkGameDifficulty } from '@/lib/types/game';
import { LINKGAME_DIFFICULTY_CONFIG } from '@/lib/linkgame';

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
    description: '8x8 经典二维，沿用原困难规模',
    icon: '🌱',
    color: 'from-emerald-300 to-teal-400',
    textColor: 'text-emerald-600',
    borderColor: 'border-emerald-200',
  },
  normal: {
    name: '普通',
    description: '8x10 二维进阶，节奏更紧凑',
    icon: '🍬',
    color: 'from-pink-400 to-rose-400',
    textColor: 'text-pink-600',
    borderColor: 'border-pink-200',
  },
  hard: {
    name: '困难',
    description: '五层栈式牌桌，越到底层越难',
    icon: '⚡',
    color: 'from-violet-400 to-fuchsia-500',
    textColor: 'text-violet-600',
    borderColor: 'border-violet-200',
  },
};

export { LINKGAME_DIFFICULTY_CONFIG };
