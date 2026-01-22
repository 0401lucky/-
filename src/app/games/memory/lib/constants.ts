// src/app/games/memory/lib/constants.ts

import type { MemoryDifficulty, MemoryDifficultyConfig } from '@/lib/types/game';

// 难度配置（与后端同步）
export const DIFFICULTY_CONFIG: Record<MemoryDifficulty, MemoryDifficultyConfig> = {
  easy: {
    rows: 4,
    cols: 4,
    pairs: 8,
    baseScore: 80,
    penaltyPerMove: 1,
    minScore: 20,
    timeLimit: 180,
  },
  normal: {
    rows: 4,
    cols: 6,
    pairs: 12,
    baseScore: 150,
    penaltyPerMove: 2,
    minScore: 40,
    timeLimit: 180,
  },
  hard: {
    rows: 6,
    cols: 6,
    pairs: 18,
    baseScore: 250,
    penaltyPerMove: 2,
    minScore: 60,
    timeLimit: 180,
  },
};

// 难度元数据
export const DIFFICULTY_META = {
  easy: {
    name: '简单',
    icon: '🌱',
    description: '4×4 网格，8对卡片',
    color: 'from-green-400 to-emerald-500',
  },
  normal: {
    name: '普通',
    icon: '🎯',
    description: '4×6 网格，12对卡片',
    color: 'from-blue-400 to-indigo-500',
  },
  hard: {
    name: '困难',
    icon: '🔥',
    description: '6×6 网格，18对卡片',
    color: 'from-orange-400 to-red-500',
  },
};

// 卡片图标映射（与后端 CARD_ICONS 对应）
export const CARD_ICON_MAP: Record<string, { emoji: string; color: string }> = {
  apple: { emoji: '🍎', color: '#ef4444' },
  banana: { emoji: '🍌', color: '#eab308' },
  cherry: { emoji: '🍒', color: '#dc2626' },
  grapes: { emoji: '🍇', color: '#7c3aed' },
  strawberry: { emoji: '🍓', color: '#f43f5e' },
  watermelon: { emoji: '🍉', color: '#22c55e' },
  orange: { emoji: '🍊', color: '#f97316' },
  pear: { emoji: '🍐', color: '#a3e635' },
  peach: { emoji: '🍑', color: '#fb923c' },
  lemon: { emoji: '🍋', color: '#facc15' },
  carrot: { emoji: '🥕', color: '#ea580c' },
  corn: { emoji: '🌽', color: '#fbbf24' },
  pepper: { emoji: '🌶️', color: '#dc2626' },
  mushroom: { emoji: '🍄', color: '#a78bfa' },
  broccoli: { emoji: '🥦', color: '#22c55e' },
  cat: { emoji: '🐱', color: '#fbbf24' },
  dog: { emoji: '🐶', color: '#d97706' },
  rabbit: { emoji: '🐰', color: '#f9a8d4' },
  bear: { emoji: '🐻', color: '#92400e' },
  bird: { emoji: '🐦', color: '#3b82f6' },
  fish: { emoji: '🐟', color: '#06b6d4' },
  butterfly: { emoji: '🦋', color: '#a855f7' },
  bee: { emoji: '🐝', color: '#facc15' },
  turtle: { emoji: '🐢', color: '#10b981' },
  frog: { emoji: '🐸', color: '#22c55e' },
};
