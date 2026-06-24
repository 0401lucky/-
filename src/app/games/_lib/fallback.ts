'use client';

export const GAME_FALLBACK_ADMIN_EMPTY_MESSAGE = '请立刻告诉管理员，管理员账户没钱了';

export type ClientGameFallbackKey =
  | '2048'
  | 'memory'
  | 'match3'
  | 'linkgame'
  | 'minesweeper'
  | 'roguelite'
  | 'whack-mole';

export interface GameFallbackPayload {
  game: ClientGameFallbackKey;
  sessionId: string;
  [key: string]: unknown;
}

export interface GameFallbackData<TRecord> {
  record: TRecord;
  pointsEarned: number;
  fallback: true;
}

interface GameFallbackResponse<TRecord> {
  success?: boolean;
  data?: GameFallbackData<TRecord>;
  message?: string;
  adminInsufficient?: boolean;
}

function notifyAdminInsufficient(message?: string) {
  if (typeof window !== 'undefined') {
    window.alert(message || GAME_FALLBACK_ADMIN_EMPTY_MESSAGE);
  }
}

export async function requestGameFallback<TRecord>(
  payload: GameFallbackPayload,
): Promise<GameFallbackData<TRecord> | null> {
  const res = await fetch('/api/games/fallback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null) as GameFallbackResponse<TRecord> | null;
  if (data?.adminInsufficient) {
    notifyAdminInsufficient(data.message);
    return null;
  }

  if (!res.ok || !data?.success || !data.data) {
    throw new Error(data?.message || '兜底结算失败');
  }

  return data.data;
}
