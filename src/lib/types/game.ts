// src/lib/types/game.ts

/** 游戏类型 */
export type GameType = 'memory' | 'match3' | 'linkgame' | 'farm' | 'whack_mole' | 'roguelite' | 'minesweeper';

/** 连连看难度 */
export type LinkGameDifficulty = 'easy' | 'normal' | 'hard';

/** 连连看棋盘模式 */
export type LinkGameBoardMode = 'classic2d' | 'stack3d';

/** 连连看结算结果 */
export type LinkGameSettlementOutcome = 'completed' | 'deadlock' | 'timeout';

/** 连连看胜败归类，用于胜率统计 */
export type LinkGameSettlementResult = 'win' | 'loss';

/** 连连看三维层配置 */
export interface LinkGameLayerConfig {
  z: number;
  rowStart: number;
  colStart: number;
  rows: number;
  cols: number;
  cells?: Array<{
    row: number;
    col: number;
  }>;
}

/** 连连看难度配置 */
export interface LinkGameDifficultyConfig {
  rows: number;
  cols: number;
  pairs: number;
  baseScore: number;
  timeLimit: number;
  mode?: LinkGameBoardMode;
  depth?: number;
  layers?: LinkGameLayerConfig[];
}

/** 连连看坐标 */
export interface LinkGamePosition {
  row: number;
  col: number;
  z?: number;
}

/** 连连看匹配操作 */
export interface LinkGameMatchMove {
  type: 'match';
  pos1: LinkGamePosition;
  pos2: LinkGamePosition;
  pos3?: LinkGamePosition;
  matched: boolean;
  isTriple?: boolean;
  timestamp: number;
}

/** 连连看操作记录 */
export type LinkGameMove = LinkGameMatchMove;

/** 兼容旧格式的操作记录（用于服务端向后兼容） */
export interface LinkGameLegacyMove {
  pos1: LinkGamePosition;
  pos2: LinkGamePosition;
  matched: boolean;
  timestamp: number;
}

/** 连连看游戏会话 */
export interface LinkGameSession {
  id: string;
  userId: number;
  gameType: 'linkgame';
  difficulty: LinkGameDifficulty;
  seed: string;
  tileLayout: (string | null)[];    // 瓦片布局，三维无效格和已消除格为 null
  startedAt: number;
  expiresAt: number;
  status: GameSessionStatus;
}

/** 连连看游戏结果提交 */
export interface LinkGameResultSubmit {
  sessionId: string;
  moves: LinkGameMove[];
  completed: boolean;
  outcome?: LinkGameSettlementOutcome;
  duration: number;
}

/** 连连看游戏记录 */
export interface LinkGameRecord {
  id: string;
  userId: number;
  sessionId: string;
  gameType: 'linkgame';
  difficulty: LinkGameDifficulty;
  moves: number;
  completed: boolean;
  outcome?: LinkGameSettlementOutcome;
  settlementResult?: LinkGameSettlementResult;
  score: number;
  pointsEarned: number;
  duration: number;
  createdAt: number;
}

/** 记忆游戏难度 */
export type MemoryDifficulty = 'easy' | 'normal' | 'hard';

/** 记忆游戏难度配置 */
export interface MemoryDifficultyConfig {
  rows: number;
  cols: number;
  pairs: number;
  baseScore: number;       // 基础分
  penaltyPerMove: number;  // 每多一步扣多少分
  minScore: number;        // 最低分
  timeLimit: number;       // 时间限制（秒）
}

/** 记忆游戏卡片 */
export interface MemoryCard {
  id: number;              // 卡片位置索引 0-based
  iconId: string;          // 图标ID
}

/** 记忆游戏操作记录 */
export interface MemoryMove {
  card1: number;           // 第一张卡片索引
  card2: number;           // 第二张卡片索引
  matched: boolean;        // 是否匹配成功
  timestamp: number;       // 操作时间戳
}

/** 已揭示的记忆卡片（用于断线恢复） */
export interface MemoryRevealedCard {
  index: number;
  iconId: string;
}

/** 记忆游戏翻牌响应 */
export interface MemoryFlipResult {
  cardIndex: number;
  iconId: string;
  firstCardIndex?: number;
  firstCardIconId?: string;
  matched: boolean;
  completed: boolean;
  moveCount: number;
  matchedCount: number;
  move?: MemoryMove;
}

/** 记忆游戏会话 */
export interface MemoryGameSession {
  id: string;
  userId: number;
  gameType: 'memory';
  difficulty: MemoryDifficulty;
  seed: string;            // 随机种子
  cardLayout: string[];    // 卡片布局（iconId数组，服务端生成）
  firstFlippedCard?: number | null; // 当前已翻开但尚未配对的卡片
  matchedCards?: number[]; // 已配对成功的卡片索引
  moveLog?: MemoryMove[];   // 服务端记录的真实翻牌步骤
  startedAt: number;
  expiresAt: number;
  status: GameSessionStatus;
}

/** 记忆游戏结果提交 */
export interface MemoryGameResultSubmit {
  sessionId: string;
  moves: MemoryMove[];     // 操作序列
  completed: boolean;      // 是否完成所有匹配
  duration: number;        // 客户端计算的游戏时长（ms）
}

/** 记忆游戏记录 */
export interface MemoryGameRecord {
  id: string;
  userId: number;
  sessionId: string;
  gameType: 'memory';
  difficulty: MemoryDifficulty;
  moves: number;           // 总步数
  completed: boolean;      // 是否完成
  score: number;           // 游戏得分
  pointsEarned: number;    // 实际获得积分
  duration: number;        // 游戏时长
  createdAt: number;
}

/** 游戏会话状态 */
export type GameSessionStatus = 'playing' | 'completed' | 'expired';

/** 每日统计 */
export interface DailyGameStats {
  userId: number;
  date: string;              // YYYY-MM-DD
  gamesPlayed: number;       // 今日游戏局数
  totalScore: number;        // 今日总得分
  pointsEarned: number;      // 今日已获积分
  lastGameAt: number;        // 最后一局时间戳
}
