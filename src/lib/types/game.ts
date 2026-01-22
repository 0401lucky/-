// src/lib/types/game.ts

/** 游戏类型 */
export type GameType = 'pachinko' | 'memory';

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

/** 记忆游戏会话 */
export interface MemoryGameSession {
  id: string;
  userId: number;
  gameType: 'memory';
  difficulty: MemoryDifficulty;
  seed: string;            // 随机种子
  cardLayout: string[];    // 卡片布局（iconId数组，服务端生成）
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

/** 游戏会话 */
export interface GameSession {
  id: string;
  userId: number;
  gameType: GameType;
  seed: string;              // 随机种子
  startedAt: number;         // 开始时间戳
  expiresAt: number;         // 过期时间戳（5分钟后）
  status: GameSessionStatus;
}

/** 弹珠发射参数 */
export interface BallLaunch {
  angle: number;             // 发射角度 (-30 ~ +30)
  power: number;             // 发射力度 (0.5 ~ 1.0)
  slotScore: number;         // 落入槽位分数
  duration: number;          // 该弹珠从发射到落槽的时间(ms)
}

/** 游戏结果提交 */
export interface GameResultSubmit {
  sessionId: string;
  score: number;             // 总得分
  duration: number;          // 总游戏时长(ms)
  balls: BallLaunch[];       // 每颗弹珠的详细数据
}

/** 游戏记录 */
export interface GameRecord {
  id: string;
  userId: number;
  sessionId: string;
  gameType: GameType;
  score: number;             // 游戏得分
  pointsEarned: number;      // 实际获得积分（可能因上限被截断）
  duration: number;          // 游戏时长
  balls: number[];           // 每颗弹珠得分 [20, 40, 10, 80, 20]
  createdAt: number;
}

/** 每日统计 */
export interface DailyGameStats {
  userId: number;
  date: string;              // YYYY-MM-DD
  gamesPlayed: number;       // 今日游戏局数
  totalScore: number;        // 今日总得分
  pointsEarned: number;      // 今日已获积分
  lastGameAt: number;        // 最后一局时间戳
}
