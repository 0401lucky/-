# Gateway Allowed Cutovers

本文记录 Gateway 已允许切到 Go API 的精确路径清单。
它和 `Gateway Cutover Guard` 互补：禁切守卫负责拦截高风险路径，允许清单审计负责确认当前所有 `api:8080` 转发都在白名单内。

## 运行方式

```bash
node scripts/audit-gateway-allowed-cutovers.mjs
```

脚本只读取 `gateway/Caddyfile`，不会修改 Gateway、数据库或业务数据。

## 审计规则

- 只允许 `handle`，不允许 `handle_path`。
- 所有转发到 `api:8080` 或 `{$API_UPSTREAM:api:8080}` 的规则必须有明确路径。
- 实际转发到 Go API 上游的路径必须和允许清单完全一致。
- 最后的 `handle { reverse_proxy {$WEB_UPSTREAM:web:3000} }` 只作为 Web 兜底，不计入 Go API 切流清单。

Gateway 默认使用 `API_UPSTREAM=api:8080` 和 `WEB_UPSTREAM=web:3000`。
Zeabur 内网服务名不同的时候，只覆盖变量值，不能借机扩大 Gateway 切流范围。

## 当前允许清单

- `/healthz`
- `/readyz`
- `/api/auth/login`
- `/api/auth/me`
- `/api/auth/logout`
- `/api/checkin`
- `/api/checkin/makeup`
- `/api/points`
- `/api/rankings/eco`
- `/api/games/profile`
- `/api/profile/overview`
- `/api/profile/settings`
- `/api/profile/achievements/equip`
- `/api/notifications`
- `/api/notifications/unread-count`
- `/api/notifications/read`
- `/api/notifications/delete`
- `/api/notifications/claim`
- `/api/announcements`
- `/api/admin/announcements`
- `/api/admin/announcements/*`
- `/api/farm/status`
- `/api/farm/plant`
- `/api/farm/water`
- `/api/farm/water-all`
- `/api/farm/harvest`
- `/api/farm/harvest-all`
- `/api/farm/remove`
- `/api/farm/buy-land`
- `/api/farm/shop/buy`
- `/api/farm/seeds/buy`
- `/api/farm/shop/use`
- `/api/farm/pet/adopt`
- `/api/farm/pet/feed`
- `/api/farm/pet/wash`
- `/api/farm/pet/drink`
- `/api/farm/pet/play`
- `/api/farm/pet/dispatch`
- `/api/farm/steal/list`
- `/api/farm/steal/do`
- `/api/games/eco/status`
- `/api/games/eco/collect`
- `/api/games/eco/buy`
- `/api/games/eco/claim-prize`
- `/api/games/eco/sell`
- `/api/games/eco/merchant-sell`
- `/api/games/eco/black-market-sell`
- `/api/games/eco/steal`
- `/api/games/memory/status`
- `/api/games/memory/start`
- `/api/games/memory/flip`
- `/api/games/memory/submit`
- `/api/games/memory/cancel`
- `/api/games/match3/status`
- `/api/games/match3/start`
- `/api/games/match3/submit`
- `/api/games/match3/cancel`
- `/api/games/whack-mole/status`
- `/api/games/whack-mole/sync`
- `/api/games/whack-mole/start`
- `/api/games/whack-mole/submit`
- `/api/games/whack-mole/cancel`
- `/api/games/minesweeper/status`
- `/api/games/minesweeper/start`
- `/api/games/minesweeper/step`
- `/api/games/minesweeper/submit`
- `/api/games/minesweeper/cancel`
- `/api/games/linkgame/status`
- `/api/games/linkgame/start`
- `/api/games/linkgame/submit`
- `/api/games/linkgame/cancel`
- `/api/games/roguelite/status`
- `/api/games/roguelite/start`
- `/api/games/roguelite/step`
- `/api/games/roguelite/submit`
- `/api/games/roguelite/cancel`
- `/api/store`
- `/api/store/exchange`
- `/api/store/admin`
- `/api/cards/inventory`
- `/api/cards/rules`
- `/api/cards/draw`
- `/api/cards/exchange`
- `/api/cards/claim-reward`
- `/api/admin/cards/users`
- `/api/admin/cards/user/*`
- `/api/admin/cards/reset`
- `/api/admin/cards/albums`
- `/api/admin/cards/rules`
- `/api/feedback`
- `/api/feedback/*`
- `/api/admin/raffle`
- `/api/admin/raffle/*`
- `/api/projects`
- `/api/raffle`
- `/api/raffle/*`

## Review 命令

```bash
node --check scripts/audit-gateway-allowed-cutovers.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
node scripts/audit-gateway-cutover-guard.mjs
docker compose config --quiet
```
