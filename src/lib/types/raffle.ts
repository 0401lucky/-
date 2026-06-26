/**
 * 多人抽奖功能类型定义
 */

/**
 * 奖品配置
 */
export interface RafflePrize {
  id: string;                     // 奖品ID（nanoid）
  name: string;                   // 奖品名称（如"一等奖 1000积分"）
  points: number;                 // 奖励积分
  dollars?: number;               // 历史字段：旧版直充金额，读取时按同数值兜底为积分
  quantity: number;               // 中奖名额
}

/**
 * 奖品配置输入
 */
export interface RafflePrizeInput {
  name: string;
  points?: number;
  dollars?: number;               // 兼容历史表单/旧数据
  quantity: number;
}

/**
 * 抽奖活动状态
 */
export type RaffleStatus = 'draft' | 'active' | 'ended' | 'cancelled';

/**
 * 活动模式
 */
export type RaffleMode = 'draw' | 'red_packet';

/**
 * 开奖触发类型
 */
export type RaffleTriggerType = 'threshold' | 'manual' | 'scheduled';

/**
 * 中奖者奖励状态
 */
export type RewardStatus = 'pending' | 'delivered' | 'failed';

/**
 * 中奖记录
 */
export interface RaffleWinner {
  entryId: string;                // 参与记录ID
  userId: number;                 // 用户ID
  username: string;               // 用户名
  prizeId: string;                // 奖品ID
  prizeName: string;              // 奖品名称
  points: number;                 // 中奖积分
  dollars?: number;               // 历史字段：旧版直充金额
  rewardStatus: RewardStatus;     // 奖励发放状态
  rewardMessage?: string;         // 发放结果描述
  rewardAttemptedAt?: number;     // 最近一次发放尝试时间
  rewardAttempts?: number;        // 发放尝试次数
  deliveredAt?: number;           // 发放时间
}

/**
 * 抽奖活动
 */
export interface Raffle {
  id: string;                     // nanoid 唯一标识
  mode?: RaffleMode;              // 活动模式，历史数据缺省为普通抽奖
  title: string;                  // 活动标题
  description: string;            // 活动描述
  coverImage?: string;            // 封面图URL（可选）

  // 奖品配置（支持多奖品）
  prizes: RafflePrize[];          // 奖品列表（一等奖、二等奖...）

  // 开奖条件
  triggerType: RaffleTriggerType; // 人数阈值自动 / 手动开奖
  threshold: number;              // 人数阈值（triggerType='threshold' 时生效）
  scheduledDrawAt?: number;       // 定时开奖时间（中国时间输入转换后的毫秒时间戳）

  // 状态
  status: RaffleStatus;
  participantsCount: number;      // 当前参与人数
  winnersCount: number;           // 中奖人数

  // 开奖结果
  drawnAt?: number;               // 开奖时间
  winners?: RaffleWinner[];       // 中奖者列表

  // 抢红包配置（mode='red_packet' 时生效）
  redPacketTotalPoints?: number;   // 红包总积分
  redPacketTotalSlots?: number;    // 可参与人数
  redPacketRemainingPoints?: number; // 剩余积分
  redPacketRemainingSlots?: number;  // 剩余名额
  redPacketPackets?: number[];     // 已打乱的待领取红包队列，用户端不返回

  // 元数据
  createdBy: number;              // 创建者用户ID
  createdAt: number;              // 创建时间
  updatedAt: number;              // 更新时间
}

/**
 * 参与记录
 */
export interface RaffleEntry {
  id: string;                     // 记录ID
  raffleId: string;               // 活动ID
  userId: number;                 // 用户ID
  username: string;               // 用户名
  entryNumber: number;            // 抽奖号码（用于展示）
  createdAt: number;              // 参与时间
}

/**
 * 创建活动请求参数
 */
export interface CreateRaffleInput {
  mode?: RaffleMode;
  title: string;
  description: string;
  coverImage?: string;
  prizes?: RafflePrizeInput[];
  triggerType?: RaffleTriggerType;
  threshold?: number;
  scheduledDrawAt?: number;
  redPacketTotalPoints?: number;
  redPacketTotalSlots?: number;
}

/**
 * 更新活动请求参数
 */
export interface UpdateRaffleInput {
  mode?: RaffleMode;
  title?: string;
  description?: string;
  coverImage?: string;
  prizes?: RafflePrizeInput[];
  triggerType?: RaffleTriggerType;
  threshold?: number;
  scheduledDrawAt?: number;
  redPacketTotalPoints?: number;
  redPacketTotalSlots?: number;
}

/**
 * 参与抽奖结果
 */
export interface JoinRaffleResult {
  success: boolean;
  message: string;
  entry?: RaffleEntry;
  reward?: RaffleWinner;
  shouldDraw?: boolean;           // 是否触发自动开奖
}

/**
 * 开奖结果
 */
export interface DrawRaffleResult {
  success: boolean;
  message: string;
  winners?: RaffleWinner[];
  deliveryResults?: {
    userId: number;
    username: string;
    prizeName: string;
    success: boolean;
    message: string;
  }[];
}

/**
 * 活动列表项（用于列表展示，不含完整参与者数据）
 */
export interface RaffleListItem {
  id: string;
  mode?: RaffleMode;
  title: string;
  description: string;
  coverImage?: string;
  prizes: RafflePrize[];
  triggerType: RaffleTriggerType;
  threshold: number;
  scheduledDrawAt?: number;
  status: RaffleStatus;
  participantsCount: number;
  winnersCount: number;
  drawnAt?: number;
  redPacketTotalPoints?: number;
  redPacketTotalSlots?: number;
  redPacketRemainingPoints?: number;
  redPacketRemainingSlots?: number;
  createdAt: number;
}

/**
 * 用户参与状态
 */
export interface UserRaffleStatus {
  hasJoined: boolean;
  entry?: RaffleEntry;
  isWinner: boolean;
  prize?: RaffleWinner;
}
