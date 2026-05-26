export const MEMORY_POINT_REWARD_DIVISOR = 9;

/**
 * 计算记忆卡片福利积分：每 9 分兑换 1 积分，向下取整。
 */
export function calculateMemoryPointReward(score: number): number {
  return Math.max(0, Math.floor(score / MEMORY_POINT_REWARD_DIVISOR));
}
