// src/lib/lua-scripts.ts
// Lua 脚本集中管理模块

/**
 * 积分相关脚本
 */
export const POINTS_SCRIPTS = {
  /**
   * 扣除积分（原子性检查余额并扣除）
   * KEYS: [pointsKey]
   * ARGV: [amount]
   * 返回: [success(0/1), balance]
   */
  deductPoints: `
    local current = tonumber(redis.call('GET', KEYS[1]) or '0')
    local amount = tonumber(ARGV[1])
    if current < amount then
      return {0, current}
    end
    local newBalance = redis.call('DECRBY', KEYS[1], amount)
    return {1, newBalance}
  `,

  /**
   * 游戏积分发放（带每日上限）
   * KEYS: [pointsKey, dailyEarnedKey]
   * ARGV: [score, dailyLimit, ttl]
   * 返回: [grant, newBalance, newDailyEarned, limitReached]
   */
  addGamePointsWithLimit: `
    local pointsKey = KEYS[1]
    local dailyEarnedKey = KEYS[2]
    local score = tonumber(ARGV[1])
    local dailyLimit = tonumber(ARGV[2])
    local ttl = tonumber(ARGV[3])

    local dailyEarned = tonumber(redis.call('GET', dailyEarnedKey) or '0')
    local remaining = dailyLimit - dailyEarned
    if remaining < 0 then remaining = 0 end
    local grant = score
    if grant > remaining then grant = remaining end

    local newBalance = 0
    local newDailyEarned = dailyEarned

    if grant > 0 then
      newBalance = redis.call('INCRBY', pointsKey, grant)
      newDailyEarned = redis.call('INCRBY', dailyEarnedKey, grant)
      redis.call('EXPIRE', dailyEarnedKey, ttl)
    else
      newBalance = tonumber(redis.call('GET', pointsKey) or '0')
    end

    local limitReached = 0
    if newDailyEarned >= dailyLimit then limitReached = 1 end

    return {grant, newBalance, newDailyEarned, limitReached}
  `,

  /**
   * 调整积分（可正可负，负数时确保不会扣成负数）
   * KEYS: [pointsKey, logKey]
   * ARGV: [delta, logId, source, description, now, maxLogs]
   * 返回: [success(0/1), balance]
   */
  applyPointsDelta: `
    local pointsKey = KEYS[1]
    local logKey = KEYS[2]
    local delta = tonumber(ARGV[1])
    local logId = ARGV[2]
    local source = ARGV[3]
    local description = ARGV[4]
    local now = tonumber(ARGV[5])
    local maxLogs = tonumber(ARGV[6])

    local current = tonumber(redis.call('GET', pointsKey) or '0')
    if delta < 0 and current < (-delta) then
      return {0, current}
    end

    local newBalance = redis.call('INCRBY', pointsKey, delta)

    local log = {id = logId, amount = delta, source = source, description = description, balance = newBalance, createdAt = now}
    redis.call('LPUSH', logKey, cjson.encode(log))
    redis.call('LTRIM', logKey, 0, maxLogs - 1)

    return {1, newBalance}
  `,
} as const;

/**
 * 抽奖相关脚本
 */
export const LOTTERY_SCRIPTS = {
  /**
   * 原子性预占直充额度
   * KEYS: [key]
   * ARGV: [cents, limitCents, ttl]
   * 返回: [success(0/1), newTotal]
   */
  reserveDailyDirectQuota: `
    local key = KEYS[1]
    local cents = tonumber(ARGV[1])
    local limit = tonumber(ARGV[2])
    local ttl = tonumber(ARGV[3])

    local newTotal = redis.call('INCRBY', key, cents)

    if redis.call('TTL', key) == -1 then
      redis.call('EXPIRE', key, ttl)
    end

    if newTotal > limit then
      redis.call('DECRBY', key, cents)
      return {0, newTotal - cents}
    end

    return {1, newTotal}
  `,

  /**
   * 原子性随机选取并标记兑换码
   * KEYS: [allCodesKey, usedCodesKey]
   * ARGV: [maxAttempts]
   * 返回: [success(0/1), code, status]
   */
  selectAndMarkCode: `
    local allKey = KEYS[1]
    local usedKey = KEYS[2]
    local maxAttempts = tonumber(ARGV[1]) or 100

    local total = redis.call('SCARD', allKey)
    if total == 0 then
      return {0, '', 'empty'}
    end

    local usedCount = redis.call('SCARD', usedKey)
    if usedCount >= total then
      return {0, '', 'exhausted'}
    end

    for i = 1, maxAttempts do
      local code = redis.call('SRANDMEMBER', allKey)
      if code and redis.call('SISMEMBER', usedKey, code) == 0 then
        local added = redis.call('SADD', usedKey, code)
        if added == 1 then
          return {1, code, 'ok'}
        end
      end
    end

    local available = redis.call('SDIFF', allKey, usedKey)
    if #available == 0 then
      return {0, '', 'exhausted'}
    end

    local idx = math.random(1, #available)
    local code = available[idx]
    local added = redis.call('SADD', usedKey, code)
    if added == 1 then
      return {1, code, 'ok'}
    end

    return {0, '', 'conflict'}
  `,
} as const;

/**
 * 兑换码领取相关脚本
 */
export const CLAIM_SCRIPTS = {
  /**
   * 原子性领取兑换码
   * KEYS: [projectKey, codesKey, claimKey, recordsKey, userClaimedKey]
   * ARGV: [now, recordId, projectId, userId, username]
   * 返回: [success(0/1), code, message]
   */
  claimCode: `
    local projectKey = KEYS[1]
    local codesKey = KEYS[2]
    local claimKey = KEYS[3]
    local recordsKey = KEYS[4]
    local userClaimedKey = KEYS[5]

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
    redis.call('SADD', userClaimedKey, projectId)

    return {1, code, '领取成功'}
  `,
} as const;
