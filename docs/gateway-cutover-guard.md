# Gateway Cutover Guard

本文记录当前 Gateway 禁切守卫。
目标是把迁移文档中“还不能切 Gateway”的高风险路径固化为脚本，避免后续重构时误开通配或误切未完成路径。
已允许切流路径的完整白名单由 `docs/gateway-allowed-cutovers.md` 和 `scripts/audit-gateway-allowed-cutovers.mjs` 单独维护。

## 运行方式

```bash
node scripts/audit-gateway-cutover-guard.mjs
```

脚本只读取 `gateway/Caddyfile` 中的活跃规则，忽略空行和注释行。

## 当前允许的既有切流

脚本允许当前已审的精确切流继续存在，包括：

- `/api/points`
- `/api/rankings/eco`
- `/api/games/profile`
- 环保行动 8 条精确路径
- 记忆游戏 5 条精确路径
- 消消乐 4 条精确路径
- 打地鼠 5 条精确路径
- 扫雷 5 条精确路径
- 连连看 4 条精确路径
- Roguelite 5 条精确路径
- `/api/store`
- `/api/store/exchange`
- `/api/store/admin`
- `/api/projects`
- `/api/raffle`
- `/api/raffle/*`
- `/api/admin/raffle`
- `/api/admin/raffle/*`

## 当前禁止打开

以下路径仍不能在 Gateway 打开：

- `/api/farm*`
- `/api/profile*`
- `/api/notifications*`
- `/api/store/topup`
- `/api/store/withdraw`
- `/api/cards*`
- `/api/admin/cards*`
- `/api/games/overview`
- `/api/games/*`
- `/api/projects/*`
- `/api/admin/*`

## 禁切原因

- 农场：Go 内部路由和自动冒烟已完成，但仍缺真实导入数据后的登录态直连 API 和页面级冒烟。
- 个人资料：需要真实资料/成就导入验证和页面冒烟，避免资料或成就佩戴写入分叉。
- 通知：需要真实 D1 导出导入和真实样本账号复跑。
- 钱包充值/提现：需要 Zeabur/new-api 配置后再做认证只读余额冒烟。
- 卡牌前台/后台：需要真实导入数据或生产等价样本账号最终页面复核。
- `/api/games/overview`：Go 内部已完成，但当前无前端直接调用。
- `/api/games/*`：普通游戏已用精确路径切流，仍禁止通配。
- `/api/projects/*`：当前只切公开项目列表，不切详情或后台项目。
- `/api/admin/*`：当前只允许已审的 raffle 后台精确规则，不切完整后台通配。

## Review 命令

```bash
node --check scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
docker compose config --quiet
```
