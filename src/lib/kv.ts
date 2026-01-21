import { kv } from "@vercel/kv";

// 项目接口
export interface Project {
  id: string;
  name: string;
  description: string;
  maxClaims: number;
  claimedCount: number;
  codesCount: number;
  status: "active" | "paused" | "exhausted";
  createdAt: number;
  createdBy: string;
  newUserOnly?: boolean;  // 仅限未领取过福利的用户
}

// 用户接口
export interface User {
  id: number;
  username: string;
  firstSeen: number;
}

// 领取记录
export interface ClaimRecord {
  id: string;
  projectId: string;
  userId: number;
  username: string;
  code: string;
  claimedAt: number;
}

// 项目操作
export async function createProject(project: Project): Promise<void> {
  await kv.set(`projects:${project.id}`, project);
  await kv.lpush("project:list", project.id);
}

export async function getProject(projectId: string): Promise<Project | null> {
  return await kv.get<Project>(`projects:${projectId}`);
}

export async function updateProject(projectId: string, updates: Partial<Project>): Promise<void> {
  const project = await getProject(projectId);
  if (project) {
    await kv.set(`projects:${projectId}`, { ...project, ...updates });
  }
}

export async function getAllProjects(): Promise<Project[]> {
  const projectIds = await kv.lrange<string>("project:list", 0, -1);
  const projects: Project[] = [];
  
  for (const id of projectIds) {
    const project = await getProject(id);
    if (project) {
      projects.push(project);
    }
  }
  
  return projects;
}

export async function deleteProject(projectId: string): Promise<void> {
  await kv.del(`projects:${projectId}`);
  await kv.del(`codes:available:${projectId}`);
  await kv.lrem("project:list", 0, projectId);
}

// 兑换码操作
export async function addCodesToProject(projectId: string, codes: string[]): Promise<number> {
  if (codes.length === 0) return 0;
  
  const added = await kv.lpush(`codes:available:${projectId}`, ...codes);
  const project = await getProject(projectId);
  
  if (project) {
    await updateProject(projectId, {
      codesCount: project.codesCount + codes.length,
    });
  }
  
  return added;
}

export async function getAvailableCodesCount(projectId: string): Promise<number> {
  return await kv.llen(`codes:available:${projectId}`);
}

export async function claimCode(projectId: string, userId: number, username: string): Promise<{ success: boolean; code?: string; message: string }> {
  // 检查是否已领取
  const existingClaim = await kv.get<ClaimRecord>(`claimed:${projectId}:${userId}`);
  if (existingClaim) {
    return {
      success: true,
      code: existingClaim.code,
      message: "你已经领取过了",
    };
  }

  // 获取项目
  const project = await getProject(projectId);
  if (!project) {
    return { success: false, message: "项目不存在" };
  }

  if (project.status === "paused") {
    return { success: false, message: "该项目已暂停领取" };
  }

  if (project.status === "exhausted" || project.claimedCount >= project.maxClaims) {
    return { success: false, message: "已达到领取上限" };
  }

  // 取出一个兑换码
  const code = await kv.rpop<string>(`codes:available:${projectId}`);
  if (!code) {
    await updateProject(projectId, { status: "exhausted" });
    return { success: false, message: "兑换码已领完" };
  }

  // 记录领取
  const record: ClaimRecord = {
    id: `claim_${Date.now()}`,
    projectId,
    userId,
    username,
    code,
    claimedAt: Date.now(),
  };

  await kv.set(`claimed:${projectId}:${userId}`, record);
  await kv.lpush(`records:${projectId}`, record);

  // 更新项目统计
  const newClaimedCount = project.claimedCount + 1;
  await updateProject(projectId, {
    claimedCount: newClaimedCount,
    status: newClaimedCount >= project.maxClaims ? "exhausted" : project.status,
  });

  return {
    success: true,
    code,
    message: "领取成功",
  };
}

export async function getClaimRecord(projectId: string, userId: number): Promise<ClaimRecord | null> {
  return await kv.get<ClaimRecord>(`claimed:${projectId}:${userId}`);
}

export async function getProjectRecords(projectId: string, start = 0, end = 49): Promise<ClaimRecord[]> {
  return await kv.lrange<ClaimRecord>(`records:${projectId}`, start, end);
}

// 检查用户是否领取过任何福利（包括兑换码和抽奖）
export async function hasUserClaimedAny(userId: number): Promise<boolean> {
  // 检查所有项目的领取记录
  const projects = await getAllProjects();
  for (const project of projects) {
    const record = await getClaimRecord(project.id, userId);
    if (record) return true;
  }
  // 检查抽奖记录
  const lotteryRecords = await kv.lrange(`lottery:user:records:${userId}`, 0, 0);
  if (lotteryRecords && lotteryRecords.length > 0) return true;
  return false;
}

// 记录用户（首次登录时调用）
export async function recordUser(userId: number, username: string): Promise<void> {
  const existing = await kv.get(`user:${userId}`);
  if (!existing) {
    await kv.set(`user:${userId}`, { 
      id: userId, 
      username, 
      firstSeen: Date.now() 
    });
    await kv.sadd('users:all', userId);
  }
}

// 获取所有用户
export async function getAllUsers(): Promise<User[]> {
  const userIds = await kv.smembers('users:all') as number[];
  const users: User[] = [];
  for (const id of userIds) {
    const user = await kv.get<User>(`user:${id}`);
    if (user) users.push(user);
  }
  return users;
}

// 获取用户的所有领取记录
export async function getUserAllClaims(userId: number): Promise<ClaimRecord[]> {
  const projects = await getAllProjects();
  const records: ClaimRecord[] = [];
  for (const project of projects) {
    const record = await getClaimRecord(project.id, userId);
    if (record) records.push(record);
  }
  return records;
}

// 获取用户的抽奖记录数
export async function getUserLotteryCount(userId: number): Promise<number> {
  return await kv.llen(`lottery:user:records:${userId}`);
}

const LOTTERY_DAILY_PREFIX = "lottery:daily:";

// 获取今天日期字符串 (YYYY-MM-DD) - 使用中国时区
function getTodayDateString(): string {
  const now = new Date();
  // 转换为中国时区 (UTC+8)
  const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = chinaTime.getUTCFullYear();
  const month = String(chinaTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(chinaTime.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 获取距离中国时区次日0点的秒数
function getSecondsUntilMidnight(): number {
  const now = new Date();
  // 计算中国时区的午夜
  const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const tomorrow = new Date(chinaTime);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  // 转回 UTC 计算差值
  const tomorrowUTC = new Date(tomorrow.getTime() - 8 * 60 * 60 * 1000);
  return Math.ceil((tomorrowUTC.getTime() - now.getTime()) / 1000);
}

// 设置今日已抽
export async function setDailyLimit(userId: number): Promise<void> {
  const today = getTodayDateString();
  const key = `${LOTTERY_DAILY_PREFIX}${userId}:${today}`;
  const ttl = getSecondsUntilMidnight();
  await kv.set(key, true, { ex: ttl });
}

// 检查今日是否已抽
export async function checkDailyLimit(userId: number): Promise<boolean> {
  const today = getTodayDateString();
  const key = `${LOTTERY_DAILY_PREFIX}${userId}:${today}`;
  const result = await kv.get(key);
  return result !== null;
}

// 额外抽奖次数管理
export async function getExtraSpinCount(userId: number): Promise<number> {
  const count = await kv.get<number>(`user:extra_spins:${userId}`);
  return count || 0;
}

export async function addExtraSpinCount(userId: number, count: number): Promise<void> {
  const current = await getExtraSpinCount(userId);
  await kv.set(`user:extra_spins:${userId}`, current + count);
}

export async function useExtraSpinCount(userId: number): Promise<boolean> {
  const current = await getExtraSpinCount(userId);
  if (current > 0) {
    await kv.set(`user:extra_spins:${userId}`, current - 1);
    return true;
  }
  return false;
}

// 签到状态管理 - 使用中国时区
export async function hasCheckedInToday(userId: number): Promise<boolean> {
  const dateStr = getTodayDateString();
  const result = await kv.get(`user:checkin:${userId}:${dateStr}`);
  return !!result;
}

export async function setCheckedInToday(userId: number): Promise<void> {
  const dateStr = getTodayDateString();
  const ttl = getSecondsUntilMidnight();
  await kv.set(`user:checkin:${userId}:${dateStr}`, true, { ex: ttl });
}
