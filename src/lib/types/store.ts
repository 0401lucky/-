// src/lib/types/store.ts

/** 积分来源类型 */
export type PointsSource =
  | 'game_play'      // 游戏游玩
  | 'game_win'       // 游戏胜利
  | 'daily_login'    // 每日登录
  | 'checkin_bonus'  // 签到奖励
  | 'exchange'       // 商店兑换（扣除）
  | 'admin_adjust'   // 管理员调整

/** 积分流水记录 */
export interface PointsLog {
  id: string
  amount: number        // 正数增加，负数扣除
  source: PointsSource
  description: string
  balance: number       // 变动后余额
  createdAt: number     // 时间戳
}

/** 商店商品类型 */
export type StoreItemType =
  | 'lottery_spin'    // 抽奖次数
  | 'quota_direct'    // 直充额度

/** 商店商品 */
export interface StoreItem {
  id: string
  name: string
  description: string
  type: StoreItemType
  pointsCost: number    // 积分价格
  value: number         // 获得数值（次数或美元）
  dailyLimit?: number   // 每日限购（可选）
  totalStock?: number   // 总库存（可选）
  sortOrder: number     // 排序权重
  enabled: boolean      // 是否上架
  createdAt: number
  updatedAt: number
}

/** 兑换记录 */
export interface ExchangeLog {
  id: string
  userId: number
  itemId: string
  itemName: string
  pointsCost: number
  value: number
  type: StoreItemType
  createdAt: number
}
