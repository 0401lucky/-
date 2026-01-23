export type SlotSymbolId = 'cherry' | 'lemon' | 'grape' | 'star' | 'diamond' | 'seven';

export interface SlotSymbol {
  id: SlotSymbolId;
  emoji: string;
  name: string;
  weight: number;
  triplePayout: number;
}

// 默认符号与权重（总和=100）
export const SLOT_SYMBOLS: SlotSymbol[] = [
  { id: 'cherry', emoji: '🍒', name: '樱桃', weight: 30, triplePayout: 20 },
  { id: 'lemon', emoji: '🍋', name: '柠檬', weight: 24, triplePayout: 40 },
  { id: 'grape', emoji: '🍇', name: '葡萄', weight: 20, triplePayout: 60 },
  { id: 'star', emoji: '⭐', name: '星星', weight: 16, triplePayout: 100 },
  { id: 'diamond', emoji: '💎', name: '钻石', weight: 8, triplePayout: 200 },
  { id: 'seven', emoji: '7️⃣', name: '幸运7', weight: 2, triplePayout: 400 },
];

export const SLOT_TWO_OF_KIND_PAYOUT = 10;
export const SLOT_SPIN_COOLDOWN_MS = 1500;
export const SLOT_MAX_RECORD_ENTRIES = 50;
export const SLOT_STATUS_RECORD_LIMIT = 10;

