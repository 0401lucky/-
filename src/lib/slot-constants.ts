export type SlotSymbolId = 'cherry' | 'lemon' | 'grape' | 'star' | 'diamond' | 'seven';

export interface SlotSymbol {
  id: SlotSymbolId;
  emoji: string;
  name: string;
  weight: number;
}

// 默认符号与权重（总和=100）
export const SLOT_SYMBOLS: SlotSymbol[] = [
  { id: 'cherry', emoji: '🍒', name: '樱桃', weight: 30 },
  { id: 'lemon', emoji: '🍋', name: '柠檬', weight: 24 },
  { id: 'grape', emoji: '🍇', name: '葡萄', weight: 20 },
  { id: 'star', emoji: '⭐', name: '星星', weight: 16 },
  { id: 'diamond', emoji: '💎', name: '钻石', weight: 8 },
  { id: 'seven', emoji: '7️⃣', name: '幸运7', weight: 2 },
];

export const SLOT_SPIN_COOLDOWN_MS = 1500;
export const SLOT_MAX_RECORD_ENTRIES = 50;
export const SLOT_STATUS_RECORD_LIMIT = 10;

// 规则：赚积分模式的基础值（最终得分 = earnBase * 倍率）
export const SLOT_EARN_BASE = 50;

// 规则：赌积分模式下注档位（最大下注不超过 100）
export const SLOT_BET_OPTIONS = [10, 20, 50, 100] as const;

// 规则：倍率表（赌积分模式：返奖=下注*倍率；赚积分模式：得分=earnBase*倍率）
export const SLOT_PAIR_MULTIPLIERS: Record<SlotSymbolId, number> = {
  cherry: 1.0,
  lemon: 1.1,
  grape: 1.3,
  star: 1.5,
  diamond: 1.9,
  seven: 3.1,
};

export const SLOT_TRIPLE_MULTIPLIERS: Record<SlotSymbolId, number> = {
  cherry: 3,
  lemon: 4,
  grape: 6,
  star: 10,
  diamond: 20,
  seven: 60,
};

// 二连 + 💎：在二连倍率基础上额外加成
export const SLOT_PAIR_BONUS_WITH_DIAMOND = 0.7;

// 二连 + 7️⃣：在二连倍率基础上额外加成（不包含 💎💎+7️⃣ 特殊爆）
export const SLOT_PAIR_BONUS_WITH_SEVEN = 2.2;

// 特殊爆：💎💎+7️⃣（任意顺序）
export const SLOT_SPECIAL_MIX_DIAMOND_DIAMOND_SEVEN_MULTIPLIER = 20;
