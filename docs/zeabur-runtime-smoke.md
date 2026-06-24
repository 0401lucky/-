# Zeabur 运行时基础冒烟

本文记录经 Gateway 的最小运行时冒烟脚本。
它用于本地 Docker 或 Zeabur 发布后快速确认入口服务、Go API、Web 和已切流路径可用。

## 运行方式

本地默认：

```bash
node scripts/smoke-zeabur-runtime.mjs
```

指定 Zeabur 域名：

```bash
ZEABUR_RUNTIME_BASE_URL=https://your-domain.example.com node scripts/smoke-zeabur-runtime.mjs
```

发布后强制远端 HTTPS 冒烟：

```bash
ZEABUR_RUNTIME_BASE_URL=https://your-domain.example.com ZEABUR_RUNTIME_REQUIRE_REMOTE=1 node scripts/smoke-zeabur-runtime.mjs
```

Windows PowerShell：

```powershell
$env:ZEABUR_RUNTIME_BASE_URL='https://your-domain.example.com'
$env:ZEABUR_RUNTIME_REQUIRE_REMOTE='1'
node scripts/smoke-zeabur-runtime.mjs
Remove-Item Env:\ZEABUR_RUNTIME_BASE_URL
Remove-Item Env:\ZEABUR_RUNTIME_REQUIRE_REMOTE
```

## 覆盖范围

脚本会通过 Gateway 检查：

- `GET /healthz` 返回 200，且响应来自 Go API。
- `GET /readyz` 返回 200，且 PostgreSQL / Redis ready。
- `GET /` 返回 HTML 首页。
- `GET /api/projects` 返回公开项目列表。
- `GET /api/raffle` 返回公开抽奖列表。
- `GET /api/points` 未登录返回 401。
- `GET /api/store` 未登录返回 401。
- `GET /api/games/profile` 未登录返回 401。
- `GET /api/games/eco/status` 未登录返回 401。
- `GET /api/games/memory/status` 未登录返回 401。

## 不做的事

- 不需要 Cookie。
- 不写 PostgreSQL。
- 不触发游戏结算、商城兑换或环保结算。
- 不打开 Gateway 切流规则。

## 远端 strict 模式

设置 `ZEABUR_RUNTIME_REQUIRE_REMOTE=1` 后，脚本会先校验：

- `ZEABUR_RUNTIME_BASE_URL` 必须是 `https://`。
- 目标不能是 `localhost`、`127.0.0.1`、`0.0.0.0` 或 loopback 地址。

该模式用于 Zeabur 发布后复核，避免误把本地 Docker Gateway 当成线上结果。

## 与总预检的关系

`scripts/preflight-zeabur-go-api.mjs` 已经把该脚本作为默认步骤。
它只覆盖基础运行入口；业务写路径仍以各独立 smoke 脚本为准。

## Review 命令

```bash
node --check scripts/smoke-zeabur-runtime.mjs
node scripts/smoke-zeabur-runtime.mjs
ZEABUR_RUNTIME_BASE_URL=https://your-domain.example.com ZEABUR_RUNTIME_REQUIRE_REMOTE=1 node scripts/smoke-zeabur-runtime.mjs
node scripts/preflight-zeabur-go-api.mjs
```
