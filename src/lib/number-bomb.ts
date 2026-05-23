import { nanoid } from 'nanoid';
import { kv } from '@/lib/d1-kv';
import { applyPointsDeltaInsideUserEconomyLock, getUserPoints } from './points';
import { getTodayDateString } from './time';
import { withKvLock, withUserEconomyLock } from './economy-lock';
import { createUserNotification } from './notifications';

export type NumberBombMultiplier = 1 | 2 | 5 | 10;
export type NumberBombBetStatus = 'pending' | 'won' | 'lost' | 'cancelled';

export interface NumberBombBet {
  id: string;
  userId: number;
  username: string;
  date: string;
  selectedNumber: number;
  multiplier: NumberBombMultiplier;
  ticketCost: number;
  status: NumberBombBetStatus;
  systemNumber?: number;
  rewardPoints?: number;
  createdAt: number;
  updatedAt: number;
  settledAt?: number;
}

export interface NumberBombState {
  date: string;
  yesterday: string;
  balance: number;
  baseTicketCost: number;
  multipliers: NumberBombMultiplier[];
  todayBet: NumberBombBet | null;
  yesterdayBet: NumberBombBet | null;
  todaySystemNumber: number | null;
  yesterdaySystemNumber: number | null;
}

export interface NumberBombSettleResult {
  date: string;
  systemNumber: number;
  processed: number;
  won: number;
  lost: number;
  skipped: number;
}

export const NUMBER_BOMB_BASE_TICKET_COST = 10;
export const NUMBER_BOMB_MULTIPLIERS: NumberBombMultiplier[] = [1, 2, 5, 10];

const CHINA_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const NUMBER_BOMB_DAY_TTL_SECONDS = 90 * 24 * 60 * 60;

const DRAW_KEY = (date: string) => `number-bomb:draw:${date}`;
const USER_BET_KEY = (date: string, userId: number) => `number-bomb:bet:${date}:user:${userId}`;
const DAY_BETS_KEY = (date: string) => `number-bomb:bets:${date}`;
const USER_RECORDS_KEY = (userId: number) => `number-bomb:user:records:${userId}`;
const SETTLEMENT_KEY = (date: string) => `number-bomb:settlement:${date}`;
const SETTLE_LOCK_KEY = (date: string) => `number-bomb:settle-lock:${date}`;

function getChinaDateFromDateString(date: string): Date {
  const [year, month, day] = date.split('-').map((part) => Number(part));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error('日期格式不合法');
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function formatChinaDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getPreviousDateString(date: string = getTodayDateString()): string {
  const chinaDate = getChinaDateFromDateString(date);
  chinaDate.setUTCDate(chinaDate.getUTCDate() - 1);
  return formatChinaDate(chinaDate);
}

export function getNextDateString(date: string = getTodayDateString()): string {
  const chinaDate = getChinaDateFromDateString(date);
  chinaDate.setUTCDate(chinaDate.getUTCDate() + 1);
  return formatChinaDate(chinaDate);
}

function getDateStringFromTimestamp(timestamp: number): string {
  const chinaTime = new Date(timestamp + CHINA_TZ_OFFSET_MS);
  return formatChinaDate(chinaTime);
}

function assertValidNumber(value: unknown): number {
  const selected = Number(value);
  if (!Number.isInteger(selected) || selected < 0 || selected > 9) {
    throw new Error('请选择 0 到 9 之间的数字');
  }
  return selected;
}

function assertValidMultiplier(value: unknown): NumberBombMultiplier {
  const multiplier = Number(value);
  if (!NUMBER_BOMB_MULTIPLIERS.includes(multiplier as NumberBombMultiplier)) {
    throw new Error('倍率不合法');
  }
  return multiplier as NumberBombMultiplier;
}

function calculateTicketCost(multiplier: NumberBombMultiplier): number {
  return NUMBER_BOMB_BASE_TICKET_COST * multiplier;
}

function generateSystemNumber(): number {
  return Math.floor(Math.random() * 10);
}

async function persistBet(bet: NumberBombBet): Promise<void> {
  await Promise.all([
    kv.set(USER_BET_KEY(bet.date, bet.userId), bet, { ex: NUMBER_BOMB_DAY_TTL_SECONDS }),
    kv.lpush(USER_RECORDS_KEY(bet.userId), bet),
    kv.ltrim(USER_RECORDS_KEY(bet.userId), 0, 49),
    kv.expire(USER_RECORDS_KEY(bet.userId), NUMBER_BOMB_DAY_TTL_SECONDS),
  ]);
}

async function getBet(date: string, userId: number): Promise<NumberBombBet | null> {
  return kv.get<NumberBombBet>(USER_BET_KEY(date, userId));
}

async function getSystemNumber(date: string): Promise<number | null> {
  const value = await kv.get<number>(DRAW_KEY(date));
  if (value === null || value === undefined) {
    return null;
  }
  return Number.isInteger(value) && value >= 0 && value <= 9 ? value : null;
}

async function ensureSystemNumber(date: string): Promise<number> {
  const existing = await getSystemNumber(date);
  if (existing !== null) {
    return existing;
  }
  const next = generateSystemNumber();
  await kv.set(DRAW_KEY(date), next, { ex: NUMBER_BOMB_DAY_TTL_SECONDS });
  return next;
}

export async function previewNumberBombSystemNumber(date: string = getNextDateString()): Promise<{
  date: string;
  systemNumber: number;
}> {
  return {
    date,
    systemNumber: await ensureSystemNumber(date),
  };
}

export async function getNumberBombState(userId: number): Promise<NumberBombState> {
  const date = getTodayDateString();
  const yesterday = getPreviousDateString(date);
  const [balance, todayBet, yesterdayBet, todaySystemNumber, yesterdaySystemNumber] = await Promise.all([
    getUserPoints(userId),
    getBet(date, userId),
    getBet(yesterday, userId),
    getSystemNumber(date),
    getSystemNumber(yesterday),
  ]);

  return {
    date,
    yesterday,
    balance,
    baseTicketCost: NUMBER_BOMB_BASE_TICKET_COST,
    multipliers: NUMBER_BOMB_MULTIPLIERS,
    todayBet,
    yesterdayBet,
    todaySystemNumber,
    yesterdaySystemNumber,
  };
}

export async function placeNumberBombBet(
  user: { id: number; username: string },
  input: { selectedNumber: unknown; multiplier: unknown },
): Promise<{ success: boolean; message: string; bet?: NumberBombBet; balance?: number }> {
  const selectedNumber = assertValidNumber(input.selectedNumber);
  const multiplier = assertValidMultiplier(input.multiplier);
  const ticketCost = calculateTicketCost(multiplier);
  const date = getTodayDateString();

  return withUserEconomyLock(user.id, async () => {
    const currentBet = await getBet(date, user.id);
    if (currentBet && currentBet.status === 'cancelled') {
      return { success: false, message: '今日投注已取消，明日再来' };
    }
    if (currentBet && currentBet.status !== 'pending') {
      return { success: false, message: '今日投注已结算，明日再来' };
    }

    const previousCost = currentBet?.ticketCost ?? 0;
    const delta = previousCost - ticketCost;
    if (delta !== 0) {
      const source = delta > 0 ? 'number_bomb_refund' : 'number_bomb_bet';
      const result = await applyPointsDeltaInsideUserEconomyLock(
        user.id,
        delta,
        source,
        delta > 0 ? `数字炸弹：修改投注退还 ${delta} 积分` : `数字炸弹：投注门票 ${ticketCost} 积分`,
      );
      if (!result.success) {
        return { success: false, message: result.message || '积分不足', balance: result.balance };
      }
    }

    const now = Date.now();
    const bet: NumberBombBet = {
      id: currentBet?.id ?? `number_bomb_${now}_${nanoid(8)}`,
      userId: user.id,
      username: user.username,
      date,
      selectedNumber,
      multiplier,
      ticketCost,
      status: 'pending',
      createdAt: currentBet?.createdAt ?? now,
      updatedAt: now,
    };

    await Promise.all([
      persistBet(bet),
      kv.sadd(DAY_BETS_KEY(date), String(user.id)),
      kv.expire(DAY_BETS_KEY(date), NUMBER_BOMB_DAY_TTL_SECONDS),
    ]);

    return {
      success: true,
      message: currentBet ? '投注已修改' : '投注成功',
      bet,
      balance: await getUserPoints(user.id),
    };
  });
}

export async function cancelNumberBombBet(
  userId: number,
): Promise<{ success: boolean; message: string; bet?: NumberBombBet; balance?: number }> {
  const date = getTodayDateString();
  return withUserEconomyLock(userId, async () => {
    const currentBet = await getBet(date, userId);
    if (!currentBet) {
      return { success: false, message: '今日还没有投注' };
    }
    if (currentBet.status !== 'pending') {
      return { success: false, message: '当前投注不能取消' };
    }

    const result = await applyPointsDeltaInsideUserEconomyLock(
      userId,
      currentBet.ticketCost,
      'number_bomb_refund',
      `数字炸弹：取消投注退还 ${currentBet.ticketCost} 积分`,
    );
    if (!result.success) {
      return { success: false, message: result.message || '退还失败', balance: result.balance };
    }

    const nextBet: NumberBombBet = {
      ...currentBet,
      status: 'cancelled',
      updatedAt: Date.now(),
    };
    await persistBet(nextBet);

    return {
      success: true,
      message: '投注已取消，门票已退还',
      bet: nextBet,
      balance: result.balance,
    };
  });
}

async function settleSingleBet(date: string, userId: number, systemNumber: number): Promise<'won' | 'lost' | 'skipped'> {
  return withUserEconomyLock(userId, async () => {
    const bet = await getBet(date, userId);
    if (!bet || bet.status !== 'pending') {
      return 'skipped';
    }

    const won = bet.selectedNumber !== systemNumber;
    const rewardPoints = won ? bet.ticketCost * 2 : 0;
    let balance = await getUserPoints(userId);

    if (won) {
      const result = await applyPointsDeltaInsideUserEconomyLock(
        userId,
        rewardPoints,
        'number_bomb_reward',
        `数字炸弹：猜中安全数字，奖励 ${rewardPoints} 积分`,
      );
      if (!result.success) {
        throw new Error(result.message || '数字炸弹奖励发放失败');
      }
      balance = result.balance;
    }

    const settled: NumberBombBet = {
      ...bet,
      status: won ? 'won' : 'lost',
      systemNumber,
      rewardPoints,
      updatedAt: Date.now(),
      settledAt: Date.now(),
    };
    await persistBet(settled);

    void createUserNotification({
      userId,
      type: 'reward',
      title: '数字炸弹开奖通知',
      content: won
        ? `系统数字是 ${systemNumber}，你选择 ${bet.selectedNumber}，获得 ${rewardPoints} 积分，当前余额 ${balance}。`
        : `系统数字是 ${systemNumber}，你选择 ${bet.selectedNumber}，本次未获得奖励。`,
      data: {
        game: 'number_bomb',
        date,
        betId: bet.id,
        selectedNumber: bet.selectedNumber,
        systemNumber,
        rewardPoints,
      },
    }).catch((error) => {
      console.error('Create number bomb notification failed:', error);
    });

    return won ? 'won' : 'lost';
  });
}

export async function settleNumberBombDate(date: string = getPreviousDateString()): Promise<NumberBombSettleResult> {
  return withKvLock(SETTLE_LOCK_KEY(date), async () => {
    const existing = await kv.get<NumberBombSettleResult>(SETTLEMENT_KEY(date));
    if (existing) {
      return existing;
    }

    const systemNumber = await ensureSystemNumber(date);
    const userIds = await kv.smembers<string>(DAY_BETS_KEY(date));
    let won = 0;
    let lost = 0;
    let skipped = 0;

    for (const rawUserId of userIds) {
      const userId = Number(rawUserId);
      if (!Number.isInteger(userId)) {
        skipped += 1;
        continue;
      }
      const result = await settleSingleBet(date, userId, systemNumber);
      if (result === 'won') won += 1;
      else if (result === 'lost') lost += 1;
      else skipped += 1;
    }

    const settlement: NumberBombSettleResult = {
      date,
      systemNumber,
      processed: won + lost,
      won,
      lost,
      skipped,
    };
    await kv.set(SETTLEMENT_KEY(date), settlement, { ex: NUMBER_BOMB_DAY_TTL_SECONDS });
    return settlement;
  }, { timeoutMessage: '数字炸弹结算任务正在执行中' });
}

export function normalizeNumberBombBetDate(timestamp: number): string {
  return getDateStringFromTimestamp(timestamp);
}
