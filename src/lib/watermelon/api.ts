export interface WatermelonDrop { tick: number; x: number }
export interface WatermelonSnapshot {
  version: 'watermelon-v1'; tick: number; drops: number; score: number; highest: number;
  next_id: number; cooldown_ticks: number; overflow_ticks: number; phase: 'playing' | 'over';
  bodies: { id: number; level: number; age_ticks: number; touched: boolean; nodes: [number, number, number, number][] }[];
}
export interface WatermelonLimits { max_segment_ticks: number; max_drops: number; max_bodies: number }
export interface WatermelonCheckpointResp {
  engine_version: 'watermelon-v1'; tick_rate: 120; limits: WatermelonLimits;
  base_tick: number; base_moves: number; state: WatermelonSnapshot; expires_at: string;
}
export interface WatermelonActiveSession extends WatermelonCheckpointResp { session_id: string; seed: string }
export interface WatermelonSegment { session_id: string; base_tick: number; base_moves: number; to_tick: number; drops: WatermelonDrop[] }
export interface WatermelonRecord {
  id: string; userId: number; sessionId: string; gameType: 'watermelon'; score: number;
  pointsEarned: number; highestTile: number; moves: number; won: boolean; gameOver: boolean;
  duration: number; createdAt: number;
}
export interface GameSubmitResp { record: WatermelonRecord; pointsEarned: number }
export interface WatermelonStatus {
  userId: number; balance: number; dailyStats: { gamesPlayed: number; pointsEarned: number };
  dailyLimit: number; dailyRemaining: number; pointsLimitReached: boolean; cooldownRemaining: number;
  rewardDivisor: number; maxRoundPoints: number; records: WatermelonRecord[];
  active_session: WatermelonActiveSession | null;
}
export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) { super(message); }
}
export async function watermelonAPI<T>(action: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/games/watermelon/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal,
  });
  const payload = await response.json().catch(() => null) as { success?: boolean; data?: T; message?: string } | null;
  if (!response.ok || !payload?.success) {
    throw new ApiError(response.status, payload?.message || '暂时无法连接游戏服务，仍可自由练习。', payload?.data);
  }
  return payload.data as T;
}
