# 福利站集卡系统 (Card Collection System)

## Context

### Original Request
为福利站设计并实现一套集卡系统，包含卡牌抽取、碎片系统、集齐奖励、卡牌仓库等功能，集成到现有的签到、抽奖、商店系统中。

### Interview Summary
**Key Discussions**:
- 卡牌等级：按动物稀有度分配5个等级（传说稀有/传说/史诗/稀有/普通）
- 获取途径：每日签到送1次抽卡 + 900积分兑换1次抽卡
- 碎片系统：重复卡转碎片，碎片可兑换指定卡牌
- 保底机制：硬保底（10/50/100/200抽）
- 集齐奖励：分批小奖励 + 全套大奖励
- 卡牌所有权：每张卡只能拥有1张，重复直接转碎片

**Research Findings**:
- 现有技术栈：Next.js 16 + React 19 + TypeScript + Vercel KV + Vitest
- 可复用模块：lottery（抽奖逻辑）、checkin（签到）、store（商店）、points（积分）
- 原子操作模式：使用 Lua 脚本确保数据一致性（参考 lottery.ts）

### Metis Review
**Identified Gaps** (addressed):
- 卡牌所有权模型：确认为单张所有（重复转碎片）
- 保底计数器类型：确认为全局计数器
- 仓库显示方式：确认未拥有卡显示剪影
- 并发安全：计划使用 Lua 脚本实现原子操作

---

## Work Objectives

### Core Objective
为福利站实现一套完整的集卡系统，让用户通过签到和积分兑换获得卡牌，收集卡牌获得奖励。

### Concrete Deliverables
- `src/lib/cards.ts` - 卡牌核心逻辑（抽卡、碎片、保底）
- `src/app/api/cards/` - 卡牌相关 API 路由
- `src/app/cards/` - 卡牌仓库页面
- `src/components/cards/` - 卡牌相关组件
- 集成到现有 checkin 和 store 系统

### Definition of Done
- [ ] 用户可以通过签到获得1次抽卡机会
- [ ] 用户可以用900积分兑换1次抽卡
- [ ] 抽卡按概率出卡，保底机制正常工作
- [ ] 重复卡自动转化为碎片
- [ ] 碎片可以兑换指定卡牌
- [ ] 集齐奖励正确发放
- [ ] 仓库页面正常显示所有功能
- [ ] 所有核心功能有测试覆盖

### Must Have
- 原子操作确保数据一致性
- 保底机制防止玩家永远抽不到高稀有度卡
- 碎片系统让重复卡有价值
- 集齐奖励激励玩家收集

### Must NOT Have (Guardrails)
- 不添加卡牌交易/赠送/市场功能
- 不添加卡牌进化/融合/合成机制
- 不添加实时多人/PvP功能
- 不添加3D动画效果（MVP使用静态图片）
- 不添加抽卡"礼包"或"连抽"（单抽即可）
- 不修改现有 lottery/store/points 核心逻辑（仅集成）

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: YES (Vitest 已配置)
- **User wants tests**: TDD
- **Framework**: Vitest

### TDD Workflow
每个 TODO 遵循 RED-GREEN-REFACTOR：
1. **RED**: 先写失败的测试
2. **GREEN**: 实现最小代码让测试通过
3. **REFACTOR**: 重构保持测试通过

---

## Data Model

### 卡牌配置 (cards:config)
```typescript
interface CardConfig {
  id: string           // 如 "panda", "whale"
  name: string         // 显示名称
  rarity: 'legendary_rare' | 'legendary' | 'epic' | 'rare' | 'common'
  image: string        // 图片路径
  backImage: string    // 卡背路径
}
```

### 用户卡牌数据 (cards:user:{userId})
```typescript
interface UserCardData {
  inventory: string[]      // 拥有的卡牌ID列表
  fragments: number        // 碎片数量
  pityCounter: number      // 保底计数器
  drawsAvailable: number   // 可用抽卡次数
  collectionRewards: string[] // 已领取的集齐奖励
}
```

### 概率配置
| 等级 | 概率 | 卡牌数量 |
|------|------|----------|
| 传说稀有 | 0.5% | 2张 |
| 传说 | 2% | 3张 |
| 史诗 | 7% | 5张 |
| 稀有 | 25% | 5张 |
| 普通 | 65.5% | 5张 |

### 保底机制（全局计数器）
| 抽数 | 保底内容 |
|------|----------|
| 10抽 | 稀有或以上 |
| 50抽 | 史诗或以上 |
| 100抽 | 传说或以上 |
| 200抽 | 传说稀有 |

### 碎片系统
| 等级 | 转化碎片 | 兑换价格 |
|------|----------|----------|
| 普通 | 3 | 30 |
| 稀有 | 8 | 80 |
| 史诗 | 20 | 200 |
| 传说 | 50 | 500 |
| 传说稀有 | 100 | 1000 |

---

## Task Flow

```
Task 0 (数据模型) → Task 1 (抽卡核心) → Task 2 (碎片系统) → Task 3 (保底机制)
                                                              ↓
Task 4 (签到集成) ← Task 5 (商店集成) ← Task 6 (集齐奖励) ← Task 3
                                                              ↓
                                                        Task 7 (仓库页面)
                                                              ↓
                                                        Task 8 (管理功能)
```

## Parallelization

| Group | Tasks | Reason |
|-------|-------|--------|
| A | 4, 5 | 签到和商店集成相互独立 |

| Task | Depends On | Reason |
|------|------------|--------|
| 1 | 0 | 需要数据模型定义 |
| 2 | 1 | 需要抽卡逻辑 |
| 3 | 1 | 需要抽卡逻辑 |
| 4 | 3 | 需要完整抽卡系统 |
| 5 | 3 | 需要完整抽卡系统 |
| 6 | 3 | 需要完整抽卡系统 |
| 7 | 6 | 需要集齐奖励逻辑 |
| 8 | 7 | 需要仓库页面完成 |

---

## TODOs

- [x] 0. 定义卡牌数据模型和配置

  **What to do**:
  - 创建 `src/lib/cards/types.ts` 定义类型
  - 创建 `src/lib/cards/config.ts` 定义卡牌配置（20张卡牌、概率、碎片数值）
  - 创建 `src/lib/cards/constants.ts` 定义常量（保底阈值、兑换价格等）

  **Must NOT do**:
  - 不要硬编码图片路径，使用配置
  - 不要创建复杂的类继承结构

  **Parallelizable**: NO (基础任务)

  **References**:
  - `src/lib/lottery.ts:LotteryConfig` - 参考配置结构
  - `images/动物卡/` - 20张动物卡图片
  - `images/通用1/` - 5个等级的卡背图片

  **Acceptance Criteria**:
  - [ ] 测试文件: `src/lib/cards/__tests__/config.test.ts`
  - [ ] 测试: 验证20张卡牌配置完整
  - [ ] 测试: 验证概率总和为100%
  - [ ] `bun test src/lib/cards/__tests__/config.test.ts` → PASS

  **Commit**: YES
  - Message: `feat(cards): add card data model and configuration`
  - Files: `src/lib/cards/types.ts`, `src/lib/cards/config.ts`, `src/lib/cards/constants.ts`

---

- [x] 1. 实现抽卡核心逻辑

  **What to do**:
  - 创建 `src/lib/cards/draw.ts` 实现抽卡函数
  - 实现概率选择算法（参考 lottery.ts 的 weightedRandomSelect）
  - 实现 KV 存储操作（获取/更新用户卡牌数据）

  **Must NOT do**:
  - 暂不实现保底机制（Task 3）
  - 暂不实现碎片转化（Task 2）

  **Parallelizable**: NO (depends on 0)

  **References**:
  - `src/lib/lottery.ts:379-398` - weightedRandomSelect 概率选择算法
  - `src/lib/kv.ts` - KV 存储操作模式
  - `src/lib/cards/config.ts` - 卡牌配置（Task 0 产出）

  **Acceptance Criteria**:
  - [ ] 测试文件: `src/lib/cards/__tests__/draw.test.ts`
  - [ ] 测试: 抽卡返回有效卡牌
  - [ ] 测试: 概率分布符合配置（chi-square 测试）
  - [ ] `bun test src/lib/cards/__tests__/draw.test.ts` → PASS

  **Commit**: YES
  - Message: `feat(cards): implement core draw logic`
  - Files: `src/lib/cards/draw.ts`

---

- [x] 2. 实现碎片系统

  **What to do**:
  - 在 `src/lib/cards/fragments.ts` 实现碎片逻辑
  - 实现重复卡检测和碎片转化
  - 实现碎片兑换指定卡牌功能
  - 使用 Lua 脚本确保原子操作

  **Must NOT do**:
  - 不要允许碎片购买未配置的卡牌
  - 不要允许负数碎片

  **Parallelizable**: NO (depends on 1)

  **References**:
  - `src/lib/lottery.ts:472-517` - Lua 脚本原子操作模式
  - `src/lib/cards/constants.ts` - 碎片转化/兑换价格
  - `src/lib/cards/draw.ts` - 抽卡逻辑（Task 1 产出）

  **Acceptance Criteria**:
  - [ ] 测试文件: `src/lib/cards/__tests__/fragments.test.ts`
  - [ ] 测试: 重复卡正确转化为碎片
  - [ ] 测试: 碎片兑换正确扣除并添加卡牌
  - [ ] 测试: 碎片不足时兑换失败
  - [ ] `bun test src/lib/cards/__tests__/fragments.test.ts` → PASS

  **Commit**: YES
  - Message: `feat(cards): implement fragment system`
  - Files: `src/lib/cards/fragments.ts`

---

- [x] 3. 实现保底机制

  **What to do**:
  - 在 `src/lib/cards/pity.ts` 实现保底逻辑
  - 实现全局保底计数器（10/50/100/200）
  - 保底触发后重置计数器
  - 集成到抽卡流程中

  **Must NOT do**:
  - 不要实现分层计数器（已确认使用全局）
  - 不要跳过保底检查

  **Parallelizable**: NO (depends on 1)

  **References**:
  - `src/lib/cards/draw.ts` - 抽卡逻辑
  - `src/lib/cards/constants.ts` - 保底阈值配置

  **Acceptance Criteria**:
  - [ ] 测试文件: `src/lib/cards/__tests__/pity.test.ts`
  - [ ] 测试: 第10抽保底稀有或以上
  - [ ] 测试: 第50抽保底史诗或以上
  - [ ] 测试: 第100抽保底传说或以上
  - [ ] 测试: 第200抽保底传说稀有
  - [ ] 测试: 保底触发后计数器重置
  - [ ] `bun test src/lib/cards/__tests__/pity.test.ts` → PASS

  **Commit**: YES
  - Message: `feat(cards): implement pity system`
  - Files: `src/lib/cards/pity.ts`

---

- [x] 4. 集成签到系统

  **What to do**:
  - 修改签到逻辑，签到成功后增加1次抽卡机会
  - 创建 `src/app/api/cards/draw/route.ts` 抽卡 API
  - 确保签到和抽卡机会增加是原子操作

  **Must NOT do**:
  - 不要修改签到的其他奖励逻辑
  - 不要破坏现有签到功能

  **Parallelizable**: YES (with 5)

  **References**:
  - `src/lib/kv.ts:587-597` - hasCheckedInToday, setCheckedInToday
  - `src/app/api/checkin/route.ts` - 现有签到 API
  - `src/lib/cards/draw.ts` - 抽卡逻辑

  **Acceptance Criteria**:
  - [ ] 测试文件: `src/lib/cards/__tests__/checkin-integration.test.ts`
  - [ ] 测试: 签到后抽卡次数+1
  - [ ] 测试: 重复签到不增加抽卡次数
  - [ ] `bun test src/lib/cards/__tests__/checkin-integration.test.ts` → PASS
  - [ ] 手动验证: 签到页面正常工作

  **Commit**: YES
  - Message: `feat(cards): integrate with checkin system`
  - Files: `src/app/api/cards/draw/route.ts`, checkin 相关修改

---

- [x] 5. 集成商店系统

  **What to do**:
  - 添加"卡牌抽取x1"商店商品（900积分）
  - 创建 `src/app/api/cards/purchase/route.ts` 购买抽卡 API
  - 确保积分扣除和抽卡机会增加是原子操作

  **Must NOT do**:
  - 不要修改商店的其他商品逻辑
  - 不要允许积分不足时购买

  **Parallelizable**: YES (with 4)

  **References**:
  - `src/lib/store.ts` - 商店逻辑
  - `src/lib/points.ts:179-227` - deductPoints 原子操作
  - `src/lib/cards/constants.ts` - 兑换价格（900积分）

  **Acceptance Criteria**:
  - [ ] 测试文件: `src/lib/cards/__tests__/store-integration.test.ts`
  - [ ] 测试: 900积分购买1次抽卡
  - [ ] 测试: 积分不足时购买失败
  - [ ] 测试: 购买后积分正确扣除
  - [ ] `bun test src/lib/cards/__tests__/store-integration.test.ts` → PASS

  **Commit**: YES
  - Message: `feat(cards): integrate with store system`
  - Files: `src/app/api/cards/purchase/route.ts`, store 相关修改

---

- [x] 6. 实现集齐奖励系统

  **What to do**:
  - 创建 `src/lib/cards/rewards.ts` 实现奖励逻辑
  - 实现按等级集齐奖励（普通400/稀有650/史诗1200/传说1800/传说稀有3500）
  - 实现全套大奖励（10000积分）
  - 创建 `src/app/api/cards/claim-reward/route.ts` 领取奖励 API

  **Must NOT do**:
  - 不要允许重复领取同一奖励
  - 不要在未集齐时发放奖励

  **Parallelizable**: NO (depends on 3)

  **References**:
  - `src/lib/points.ts:addPoints` - 积分添加
  - `src/lib/cards/config.ts` - 卡牌配置
  - `src/lib/cards/constants.ts` - 奖励积分配置

  **Acceptance Criteria**:
  - [ ] 测试文件: `src/lib/cards/__tests__/rewards.test.ts`
  - [ ] 测试: 集齐普通卡获得400积分
  - [ ] 测试: 集齐全套获得10000积分
  - [ ] 测试: 重复领取失败
  - [ ] `bun test src/lib/cards/__tests__/rewards.test.ts` → PASS

  **Commit**: YES
  - Message: `feat(cards): implement collection rewards`
  - Files: `src/lib/cards/rewards.ts`, `src/app/api/cards/claim-reward/route.ts`

---

- [ ] 7. 实现卡牌仓库页面

  **What to do**:
  - 创建 `src/app/cards/page.tsx` 仓库主页面
  - 创建 `src/components/cards/CardGrid.tsx` 卡牌网格组件
  - 创建 `src/components/cards/CardDetail.tsx` 卡牌详情组件
  - 实现筛选/排序功能
  - 显示收集进度和碎片数量
  - 未拥有卡牌显示剪影

  **Must NOT do**:
  - 不要添加3D动画效果
  - 不要添加卡牌交易功能

  **Parallelizable**: NO (depends on 6)

  **References**:
  - `src/app/lottery/page.tsx` - 页面结构参考
  - `src/components/` - 现有组件风格
  - `images/动物卡/` - 卡牌图片
  - `images/通用1/` - 卡背图片

  **Acceptance Criteria**:
  - [ ] 手动验证: 页面正确显示所有卡牌
  - [ ] 手动验证: 已拥有卡牌显示彩色，未拥有显示剪影
  - [ ] 手动验证: 筛选/排序功能正常
  - [ ] 手动验证: 收集进度正确显示
  - [ ] 手动验证: 碎片数量正确显示

  **Commit**: YES
  - Message: `feat(cards): implement card inventory page`
  - Files: `src/app/cards/page.tsx`, `src/components/cards/*`

---

- [ ] 8. 实现管理功能

  **What to do**:
  - 创建 `src/app/admin/cards/page.tsx` 管理页面
  - 实现查看所有用户卡牌数据
  - 实现重置用户进度功能（测试/支持用）
  - 实现调整奖励积分配置功能

  **Must NOT do**:
  - 不要允许非管理员访问
  - 不要删除用户数据（只能重置）

  **Parallelizable**: NO (depends on 7)

  **References**:
  - `src/app/admin/` - 现有管理页面结构
  - `src/lib/cards/` - 卡牌相关逻辑

  **Acceptance Criteria**:
  - [ ] 手动验证: 管理页面正确显示
  - [ ] 手动验证: 可以查看用户卡牌数据
  - [ ] 手动验证: 可以重置用户进度
  - [ ] 手动验证: 非管理员无法访问

  **Commit**: YES
  - Message: `feat(cards): implement admin management page`
  - Files: `src/app/admin/cards/page.tsx`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 0 | `feat(cards): add card data model and configuration` | types.ts, config.ts, constants.ts | bun test |
| 1 | `feat(cards): implement core draw logic` | draw.ts | bun test |
| 2 | `feat(cards): implement fragment system` | fragments.ts | bun test |
| 3 | `feat(cards): implement pity system` | pity.ts | bun test |
| 4 | `feat(cards): integrate with checkin system` | API routes | bun test |
| 5 | `feat(cards): integrate with store system` | API routes | bun test |
| 6 | `feat(cards): implement collection rewards` | rewards.ts | bun test |
| 7 | `feat(cards): implement card inventory page` | page.tsx, components | manual |
| 8 | `feat(cards): implement admin management page` | admin page | manual |

---

## Success Criteria

### Verification Commands
```bash
bun test src/lib/cards/  # Expected: All tests pass
bun run build            # Expected: Build succeeds
bun run dev              # Expected: Dev server starts
```

### Final Checklist
- [ ] 所有 "Must Have" 功能已实现
- [ ] 所有 "Must NOT Have" 约束已遵守
- [ ] 所有测试通过
- [ ] 签到集成正常工作
- [ ] 商店集成正常工作
- [ ] 仓库页面功能完整
- [ ] 管理功能可用
