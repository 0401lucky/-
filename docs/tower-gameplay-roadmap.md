# 爬塔游戏玩法改进路线图

## 问题诊断

| 问题 | 原因 |
|------|------|
| 决策无深度 | 所有信息完全公开，最优解一眼可算 |
| 每层结构雷同 | 从第1层到第100层永远 2-3 通道选一个，无节奏变化 |
| 成长维度单一 | 只有 power 一个数字，缺乏构建流派的乐趣 |
| 无风险回报权衡 | 安全选择永远最优，不存在冒险的动机 |

## 架构约束

- 后端验证靠 `seed + choices: number[]` 重放（`tower.ts` → `simulateTowerGame`）
- 所有新特性必须是确定性的（从 seed 可推导）
- 每层输入仍为一个通道索引
- `tower-engine.ts` 前后端共用，一处改两边生效
- 后端 API 和 KV 存储结构不需要改动

---

## 第一期：核心机制扩展

> 目标：打破"一眼最优"，增加风险回报和阶段感

### 1.1 迷雾通道 mystery

- 部分通道不显示具体内容，只显示 `?` 和类型暗示色（紫色卡片）
- 选中后才揭示真实内容（可能是大奖也可能是强怪）
- 迷雾概率随层数递增：1-5层 0%，6-15层 15%，16-30层 25%，31+层 35%
- 迷雾包裹的内容由 rng 正常生成，只是前端隐藏

**类型定义：**
```ts
{ type: 'mystery'; hidden: TowerLaneContent }
```

**UI 表现：**
- 紫色渐变边框 + `?` 图标 + "未知" 文字
- 选中后播放翻转揭示动画（先缩小再展开为真实卡片）

### 1.2 Boss 层（每 10 层触发）

- 第 10、20、30... 层为 Boss 层
- 固定 2 条通道：1 个 Boss 怪物 + 1 个逃跑通道（小额加法增益）
- Boss 数值约为当前 power 的 60-80%（确保有盾或足够强才能打）
- 击败 Boss 奖励：`power += value * 2`（普通怪物只 +value）
- Boss 层不受 safeChance 保护

**类型定义：**
```ts
{ type: 'boss'; value: number }
```

**Boss 数值设计：**
| 层数 | Boss 数值范围 | 逃跑增益 |
|------|-------------|---------|
| 10 | power * 0.6 ~ 0.75 | +1~2 |
| 20 | power * 0.65 ~ 0.8 | +2~4 |
| 30 | power * 0.7 ~ 0.85 | +3~5 |
| 40+ | power * 0.75 ~ 0.9 | +3~5 |

**UI 表现：**
- 暗金色边框 + 骷髅/皇冠图标 + 脉冲光效
- Boss 层标题栏变红 + "BOSS" 标签
- 击败后全屏金光特效

### 1.3 护盾系统 shield

- 新通道类型：选择后获得一层护盾
- 护盾效果：遇到打不过的怪物时消耗护盾存活（power 不变，不死亡）
- 护盾不叠加（最多持有 1 层）
- 已有护盾时再选护盾通道 → 转化为小额 power 加成（+2~5）
- 护盾出现概率：6-15层 5%，16-30层 8%，31+层 10%

**类型定义：**
```ts
{ type: 'shield'; value: number }
// value: 已有护盾时转化为的 power 加成数值
```

**玩家状态扩展：**
```ts
interface TowerPlayerState {
  power: number;
  shield: boolean;
  combo: number;    // 为第二期预留
}
```

**UI 表现：**
- 蓝色边框 + 🛡️ 图标
- GameHeader 中显示护盾图标（有/无）
- 护盾抵挡攻击时播放碎盾动画 + 飘字 "护盾抵挡!"

### 1.4 改动文件清单

| 文件 | 改动 |
|------|------|
| `src/lib/tower-engine.ts` | 扩展类型、generateFloor 支持 Boss/迷雾/护盾、simulateTowerGame 跟踪状态 |
| `src/app/games/tower/components/LaneCards.tsx` | 新增迷雾/Boss/护盾卡片样式 |
| `src/app/games/tower/components/GameHeader.tsx` | 显示护盾状态 |
| `src/app/games/tower/components/FloatingText.tsx` | 无改动 |
| `src/app/games/tower/page.tsx` | 迷雾揭示动画、Boss 层特殊 UI、护盾状态管理 |
| `src/app/games/tower/lib/constants.ts` | 新增揭示动画时长 |
| `tailwind.config.ts` | 新增翻转揭示动画 keyframe |

### 1.5 部署注意

- 需要清理所有 `tower:active:*` 和 `tower:session:*` KV 数据（旧 session 的 rng 序列不兼容）
- 无需数据库迁移（KV 存储，record 格式向前兼容）

---

## 第二期：深度与刺激感

> 目标：鼓励冒险、构建流派

### 2.1 连击系统 combo

- 连续选择怪物通道并击败，combo 计数 +1
- combo 加成：击败怪物额外获得 `combo * 10%` power（combo 3 → 额外 30%）
- 选择非怪物通道时 combo 归零
- Boss 击败也算入 combo 且 Boss 的 combo 加成翻倍

**示例：**
```
combo 0 → 击败怪物(value=5) → power += 5, combo = 1
combo 1 → 击败怪物(value=8) → power += 8 + floor(8*0.1) = 8+0 = 8, combo = 2
combo 2 → 击败怪物(value=10) → power += 10 + floor(10*0.2) = 10+2 = 12, combo = 3
combo 3 → 选加法增益 → combo 归零
```

**UI 表现：**
- GameHeader 显示 combo 计数 + 火焰图标
- combo >= 3 时卡片区域边缘出现火焰特效
- 飘字显示 combo 加成 "COMBO x3 +2"

### 2.2 商店层（每 5 层一次选择，不与 Boss 层重叠）

- 第 5、15、25、35... 层为商店层
- 提供 3 个通道，每个是一个永久被动增益，选一个：
  - **吸血**：击败怪物额外获得 20% power
  - **鹰眼**：所有迷雾通道变透明（可看到隐藏内容）
  - **连击大师**：combo 加成从 10% 提升到 20%
  - **幸运**：增益数值 +30%（加法和乘法都受影响）
  - **坚壁**：护盾可叠加到 2 层
- 每次商店从池子中随机抽 3 个不重复的
- 已获得的增益不再出现

**类型定义：**
```ts
{ type: 'shop'; buff: BuffType }
type BuffType = 'lifesteal' | 'eagle_eye' | 'combo_master' | 'lucky' | 'fortify';
```

**玩家状态扩展：**
```ts
interface TowerPlayerState {
  power: number;
  shield: number;       // 0/1/2 (有 fortify 后最多 2)
  combo: number;
  buffs: BuffType[];    // 已获得的永久增益
}
```

### 2.3 陷阱通道 trap

- 看起来像增益但实际减少力量
- 有两种：`power -= value`（减法陷阱）、`power = ceil(power / value)`（除法陷阱）
- 16 层以下不出现，高层概率逐渐增加
- 陷阱不会把 power 降到 0 以下（最低 1）

**类型定义：**
```ts
{ type: 'trap'; subtype: 'sub' | 'div'; value: number }
```

### 2.4 改动文件清单

| 文件 | 改动 |
|------|------|
| `src/lib/tower-engine.ts` | combo 逻辑、商店层生成、陷阱类型、buff 效果计算 |
| `src/app/games/tower/components/LaneCards.tsx` | 商店卡片、陷阱卡片样式 |
| `src/app/games/tower/components/GameHeader.tsx` | combo 计数、buff 图标栏 |
| `src/app/games/tower/page.tsx` | 商店层 UI、combo 飘字、陷阱动画 |

---

## 第三期：主题层与深度定制

> 目标：增加重复可玩性和表现力

### 3.1 主题楼层

- **赌博层**：所有通道都是迷雾通道（高风险高回报）
- **宝藏层**：击败 Boss 后出现，全部是高价值增益通道
- **地狱层**：全部是强怪，但通过后获得大量 power
- **混沌层**：通道数量增加到 4-5 个，但多数是陷阱

### 3.2 诅咒/祝福系统

- Boss 击败后获得一个随机祝福（持续 5 层）：
  - 烈焰之力：攻击力 +50%
  - 黄金之触：所有增益翻倍
  - 洞察之眼：所有迷雾揭示
- 踩到特殊陷阱可能获得诅咒（持续 3 层）：
  - 虚弱：攻击力 -25%
  - 迷惑：随机交换两个通道的显示位置

### 3.3 难度模式选择

- 开局选择难度：普通 / 困难 / 地狱
- 困难：怪物数值 +30%，迷雾概率 +15%，积分 x1.5
- 地狱：怪物数值 +60%，无保底安全路，积分 x2.5

### 3.4 成就系统

- 记录里程碑：首次到达 20/50/100 层、首次击败 Boss、combo 达到 10 等
- 成就解锁装饰性头衔（显示在排行榜）

### 3.5 改动文件清单

| 文件 | 改动 |
|------|------|
| `src/lib/tower-engine.ts` | 主题层生成、诅咒/祝福、难度系数 |
| `src/lib/tower.ts` | 难度模式记录、成就检测 |
| `src/app/api/games/tower/start/route.ts` | 接收难度参数 |
| 前端组件 | 难度选择 UI、成就弹窗、主题层特效 |
| 新增 | 成就定义文件、成就 KV 存储逻辑 |

---

## 积分体系调整建议

当前积分公式（`floorToPoints`）只按层数计算。随着玩法丰富，建议扩展为：

```
基础分 = floorToPoints(floorsClimbed)        // 不变
Boss 加分 = bossesDefeated * 30              // 每击败一个 Boss +30
combo 加分 = maxCombo * 5                    // 最高 combo * 5
完美加分 = 全程无护盾通关额外 +50            // 鼓励硬核玩法
```

总分 = min(基础分 + Boss加分 + combo加分 + 完美加分, 500)

此调整建议在第二期实施，第一期保持现有积分公式不变。
