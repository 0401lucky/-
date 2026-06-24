# Game Cutover Suite

本文记录普通游戏精确切流的一键复核脚本。
它用于本地 Docker Compose 或 Zeabur 部署前，把 6 个普通游戏的独立审计与直连 Go API 冒烟连续跑完。

## 运行方式

```bash
node scripts/smoke-game-cutovers-go-api.mjs
```

脚本会依次执行：

- Gateway 禁切守卫：`scripts/audit-gateway-cutover-guard.mjs`
- 记忆游戏：`audit-memory-cutover` + `smoke-memory-go-api`
- 消消乐：`audit-match3-cutover` + `smoke-match3-go-api`
- 打地鼠：`audit-whack-mole-cutover` + `smoke-whack-mole-go-api`
- 扫雷：`audit-minesweeper-cutover` + `smoke-minesweeper-go-api`
- 连连看：`audit-linkgame-cutover` + `smoke-linkgame-go-api`
- Roguelite：`audit-roguelite-cutover` + `smoke-roguelite-go-api`

## 覆盖范围

套件覆盖：

- 前端实际 API 路径审计。
- Go 精确路由审计。
- PostgreSQL runtime schema 审计。
- Gateway 精确规则和禁通配检查。
- Docker 直连 Go API 结算冒烟。
- 测试用户、积分、流水、会话、冷却和游戏记录清理检查。

## 前置条件

- Docker Compose 服务已启动。
- `api` 容器可访问 `127.0.0.1:8080`。
- `postgres` 容器使用本地默认 `app/app` 数据库。

## Review 命令

```bash
node --check scripts/smoke-game-cutovers-go-api.mjs
node scripts/smoke-game-cutovers-go-api.mjs
```
