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
  /**
   * 项目奖励类型：
   * - code: 发放兑换码（默认）
   * - direct: 直充到 new-api 账户额度
   */
  rewardType?: "code" | "direct";
  /** rewardType=direct 时每人直充金额（美元） */
  directDollars?: number;
  newUserOnly?: boolean;  // 仅限未领取过福利的用户
  pinned?: boolean; // 置顶项目
  pinnedAt?: number; // 置顶时间（用于排序）
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
  /** 是否直充项目 */
  directCredit?: boolean;
  /** 直充金额（美元） */
  creditedDollars?: number;
  /** 直充状态：pending=处理中，success=成功，uncertain=不确定 */
  creditStatus?: "pending" | "success" | "uncertain";
  /** 直充结果描述（用于审计/展示） */
  creditMessage?: string;
  /** 直充确认时间（毫秒时间戳） */
  creditedAt?: number;
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
  const now = Date.now();
  const recordId = `claim_${now}_${Math.random().toString(36).slice(2, 8)}`;

  const projectKey = `projects:${projectId}`;
  const codesKey = `codes:available:${projectId}`;
  const claimKey = `claimed:${projectId}:${userId}`;
  const recordsKey = `records:${projectId}`;

  const luaScript = `
    local projectKey = KEYS[1]
    local codesKey = KEYS[2]
    local claimKey = KEYS[3]
    local recordsKey = KEYS[4]

    local now = tonumber(ARGV[1])
    local recordId = ARGV[2]
    local projectId = ARGV[3]
    local userIdRaw = ARGV[4]
    local username = ARGV[5]

    local existingJson = redis.call('GET', claimKey)
    if existingJson then
      local ok, existing = pcall(cjson.decode, existingJson)
      if ok and existing and existing.code then
        return {1, existing.code, '你已经领取过了'}
      end
      return {0, '', '领取记录异常，请联系管理员'}
    end

    local projectJson = redis.call('GET', projectKey)
    if not projectJson then
      return {0, '', '项目不存在'}
    end

    local okP, project = pcall(cjson.decode, projectJson)
    if not okP or not project then
      return {0, '', '项目数据异常，请联系管理员'}
    end

    if project.status == 'paused' then
      return {0, '', '该项目已暂停领取'}
    end

    local claimedCount = tonumber(project.claimedCount) or 0
    local maxClaims = tonumber(project.maxClaims) or 0

    if project.status == 'exhausted' or (maxClaims > 0 and claimedCount >= maxClaims) then
      return {0, '', '已达到领取上限'}
    end

    local code = redis.call('RPOP', codesKey)
    if not code then
      project.status = 'exhausted'
      redis.call('SET', projectKey, cjson.encode(project))
      return {0, '', '兑换码已领完'}
    end

    project.claimedCount = claimedCount + 1
    if maxClaims > 0 and project.claimedCount >= maxClaims then
      project.status = 'exhausted'
    end

    local userIdNum = tonumber(userIdRaw) or userIdRaw
    local record = { id = recordId, projectId = projectId, userId = userIdNum, username = username, code = code, claimedAt = now }
    local recordJson = cjson.encode(record)

    redis.call('SET', claimKey, recordJson)
    redis.call('LPUSH', recordsKey, recordJson)
    redis.call('SET', projectKey, cjson.encode(project))

    return {1, code, '领取成功'}
  `;

  const result = await kv.eval(
    luaScript,
    [projectKey, codesKey, claimKey, recordsKey],
    [now, recordId, projectId, userId, username]
  ) as [number, string, string];

  const [ok, code, message] = result;

  if (ok === 1) {
    return { success: true, code: code || undefined, message };
  }

  return { success: false, message };
}

/**
 * 直充项目：原子预占名额并创建 pending 领取记录
 */
export async function reserveDirectClaim(
  projectId: string,
  userId: number,
  username: string
): Promise<{ success: boolean; message: string; record?: ClaimRecord }> {
  const now = Date.now();
  const recordId = `claim_${now}_${Math.random().toString(36).slice(2, 8)}`;

  const projectKey = `projects:${projectId}`;
  const claimKey = `claimed:${projectId}:${userId}`;

  const luaScript = `
    local projectKey = KEYS[1]
    local claimKey = KEYS[2]

    local now = tonumber(ARGV[1])
    local recordId = ARGV[2]
    local projectId = ARGV[3]
    local userIdRaw = ARGV[4]
    local username = ARGV[5]

    local existingJson = redis.call('GET', claimKey)
    if existingJson then
      local okE, existing = pcall(cjson.decode, existingJson)
      if okE and existing and existing.creditStatus == 'pending' then
        return {2, existingJson, '领取处理中，请稍后刷新'}
      end
      return {2, existingJson, '你已经领取过了'}
    end

    local projectJson = redis.call('GET', projectKey)
    if not projectJson then
      return {0, '', '项目不存在'}
    end

    local okP, project = pcall(cjson.decode, projectJson)
    if not okP or not project then
      return {0, '', '项目数据异常，请联系管理员'}
    end

    if project.status == 'paused' then
      return {0, '', '该项目已暂停领取'}
    end

    local dollars = tonumber(project.directDollars) or 0
    if dollars <= 0 then
      return {0, '', '项目直充金额配置异常，请联系管理员'}
    end

    local claimedCount = tonumber(project.claimedCount) or 0
    local maxClaims = tonumber(project.maxClaims) or 0

    if project.status == 'exhausted' or (maxClaims > 0 and claimedCount >= maxClaims) then
      return {0, '', '已达到领取上限'}
    end

    project.claimedCount = claimedCount + 1
    if maxClaims > 0 and project.claimedCount >= maxClaims then
      project.status = 'exhausted'
    end

    local userIdNum = tonumber(userIdRaw) or userIdRaw
    local record = { id = recordId, projectId = projectId, userId = userIdNum, username = username, code = '', claimedAt = now, directCredit = true, creditedDollars = dollars, creditStatus = 'pending' }
    local recordJson = cjson.encode(record)

    redis.call('SET', claimKey, recordJson)
    redis.call('SET', projectKey, cjson.encode(project))

    return {1, recordJson, 'ok'}
  `;

  const result = await kv.eval(
    luaScript,
    [projectKey, claimKey],
    [now, recordId, projectId, userId, username]
  ) as [number, string, string];

  const [ok, recordJson, message] = result;
  if (ok === 1 || ok === 2) {
    try {
      const record = JSON.parse(recordJson) as ClaimRecord;
      return { success: true, message, record };
    } catch {
      return { success: true, message };
    }
  }
  return { success: false, message };
}

/**
 * 直充项目：更新领取记录状态并写入项目记录列表（幂等）
 */
export async function finalizeDirectClaim(
  projectId: string,
  userId: number,
  status: "success" | "uncertain",
  creditMessage: string
): Promise<{ success: boolean; message: string; record?: ClaimRecord }> {
  const now = Date.now();

  const claimKey = `claimed:${projectId}:${userId}`;
  const recordsKey = `records:${projectId}`;

  const luaScript = `
    local claimKey = KEYS[1]
    local recordsKey = KEYS[2]

    local status = ARGV[1]
    local creditMessage = ARGV[2]
    local creditedAt = tonumber(ARGV[3])

    local existingJson = redis.call('GET', claimKey)
    if not existingJson then
      return {0, '', '领取记录不存在'}
    end

    local okR, record = pcall(cjson.decode, existingJson)
    if not okR or not record then
      return {0, '', '领取记录异常，请联系管理员'}
    end

    if record.creditStatus == 'success' or record.creditStatus == 'uncertain' then
      return {2, existingJson, 'ok'}
    end

    record.creditStatus = status
    record.creditMessage = creditMessage
    record.creditedAt = creditedAt

    local recordJson = cjson.encode(record)
    redis.call('SET', claimKey, recordJson)
    redis.call('LPUSH', recordsKey, recordJson)

    return {1, recordJson, 'ok'}
  `;

  const result = await kv.eval(
    luaScript,
    [claimKey, recordsKey],
    [status, creditMessage, now]
  ) as [number, string, string];

  const [ok, recordJson, message] = result;
  if (ok === 1 || ok === 2) {
    try {
      const record = JSON.parse(recordJson) as ClaimRecord;
      return { success: true, message, record };
    } catch {
      return { success: true, message };
    }
  }

  return { success: false, message };
}

/**
 * 直充项目：直充失败时回滚名额占位（仅对 pending 生效）
 */
export async function rollbackDirectClaim(
  projectId: string,
  userId: number
): Promise<{ success: boolean; message: string }> {
  const projectKey = `projects:${projectId}`;
  const claimKey = `claimed:${projectId}:${userId}`;

  const luaScript = `
    local projectKey = KEYS[1]
    local claimKey = KEYS[2]

    local existingJson = redis.call('GET', claimKey)
    if not existingJson then
      return {2, 'ok'}
    end

    local okR, record = pcall(cjson.decode, existingJson)
    if okR and record and record.creditStatus and record.creditStatus ~= 'pending' then
      return {2, 'ok'}
    end

    redis.call('DEL', claimKey)

    local projectJson = redis.call('GET', projectKey)
    if not projectJson then
      return {1, 'ok'}
    end

    local okP, project = pcall(cjson.decode, projectJson)
    if not okP or not project then
      return {1, 'ok'}
    end

    local claimedCount = tonumber(project.claimedCount) or 0
    local maxClaims = tonumber(project.maxClaims) or 0

    if claimedCount > 0 then
      project.claimedCount = claimedCount - 1
    else
      project.claimedCount = 0
    end

    -- 如果之前因为达到上限变为 exhausted，回滚后可能恢复 active（paused 不变）
    if project.status == 'exhausted' and project.status ~= 'paused' then
      if maxClaims > 0 and project.claimedCount < maxClaims then
        project.status = 'active'
      end
    end

    redis.call('SET', projectKey, cjson.encode(project))

    return {1, 'ok'}
  `;

  const result = await kv.eval(
    luaScript,
    [projectKey, claimKey],
    []
  ) as [number, string];

  const [ok, message] = result;
  return { success: ok === 1 || ok === 2, message };
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
  const existing = await kv.get<User>(`user:${userId}`);
  if (!existing) {
    await kv.set(`user:${userId}`, {
      id: userId,
      username,
      firstSeen: Date.now(),
    });
  } else if (existing.username !== username) {
    await kv.set(`user:${userId}`, {
      ...existing,
      username,
    });
  }
  // 确保用户一定在用户集合中（便于后续管理/统计）
  await kv.sadd('users:all', userId);
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

// [C3修复] 原子性占用每日免费次数 - 使用 SET NX 防止并发
// 返回 true 表示成功占用（之前没用过），false 表示已被占用
export async function tryClaimDailyFree(userId: number): Promise<boolean> {
  const today = getTodayDateString();
  const key = `${LOTTERY_DAILY_PREFIX}${userId}:${today}`;
  const ttl = getSecondsUntilMidnight();
  
  // SET key value NX EX ttl - 仅当key不存在时设置
  // Vercel KV 返回 "OK" 表示成功设置，null 表示 key 已存在
  const result = await kv.set(key, "1", { nx: true, ex: ttl });
  return result === "OK";
}

// [C3修复] 释放每日免费次数（失败补偿用）
export async function releaseDailyFree(userId: number): Promise<void> {
  const today = getTodayDateString();
  const key = `${LOTTERY_DAILY_PREFIX}${userId}:${today}`;
  await kv.del(key);
}

// 检查今日是否已抽（只读检查，不修改）
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

// [C3修复] 原子性增加额外次数
export async function addExtraSpinCount(userId: number, count: number): Promise<number> {
  // 使用 INCRBY 原子增加
  const newCount = await kv.incrby(`user:extra_spins:${userId}`, count);
  return newCount;
}

// [C3修复] 原子性消耗额外次数 - 使用 DECR 并检查结果
// 返回 { success: boolean, remaining: number }
export async function tryUseExtraSpin(userId: number): Promise<{ success: boolean; remaining: number }> {
  const key = `user:extra_spins:${userId}`;
  
  // 使用 DECR 原子减1
  const newValue = await kv.decrby(key, 1);
  
  if (newValue < 0) {
    // 减过头了，需要回滚
    await kv.incrby(key, 1);
    return { success: false, remaining: 0 };
  }
  
  return { success: true, remaining: newValue };
}

// [C3修复] 回滚额外次数（失败补偿用）
export async function rollbackExtraSpin(userId: number): Promise<void> {
  await kv.incrby(`user:extra_spins:${userId}`, 1);
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
