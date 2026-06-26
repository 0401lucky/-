# Zeabur 环境变量样例审计

本文记录 Zeabur 环境变量样例的机器审计入口。
它只检查 `deploy/zeabur.env.example` 是否覆盖当前部署所需的关键变量，不读取真实生产密钥。

## 运行方式

```bash
node scripts/audit-zeabur-env-example.mjs
```

如果要检查另一个样例文件：

```bash
ZEABUR_ENV_EXAMPLE=./deploy/zeabur.env.example node scripts/audit-zeabur-env-example.mjs
```

Windows PowerShell：

```powershell
$env:ZEABUR_ENV_EXAMPLE='./deploy/zeabur.env.example'
node scripts/audit-zeabur-env-example.mjs
Remove-Item Env:\ZEABUR_ENV_EXAMPLE
```

## 检查范围

脚本会检查以下变量是否存在且非空：

- 单容器端口：`GATEWAY_PORT`、`WEB_PORT`、`API_PORT`
- Web：`NODE_ENV`、`NEXT_PUBLIC_BASE_URL`
- 共享认证：`SESSION_SECRET`、`ADMIN_USERNAMES`
- Go 运行时：`APP_MODE`、`DATABASE_URL`、`REDIS_URL`、`INTERNAL_API_SECRET`
- new-api：`NEW_API_URL`、`NEW_API_ADMIN_ACCESS_TOKEN`、`NEW_API_ADMIN_USER_ID`、`NEW_API_ADMIN_USERNAME`、`NEW_API_ADMIN_PASSWORD`
- Worker/Cron：`RAFFLE_DELIVERY_CRON_SECRET`、`CRON_SECRET`
- 对象存储：`R2_PUBLIC_URL`、`S3_ENDPOINT`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_BUCKET_FEEDBACK_IMAGES`、`S3_BUCKET_CARD_IMAGES`

`GATEWAY_PORT` 默认是 `8080`。
`WEB_PORT` 默认是 `3000`。
`API_PORT` 默认是 `8081`。
Gateway 的 `API_UPSTREAM` 和 `WEB_UPSTREAM` 由 `scripts/start-zeabur.sh` 在容器内注入，不需要写入 Zeabur 环境变量。

对于密钥类变量，样例文件必须使用占位值。
这能避免真实密钥被误写入仓库。

## 与总预检的关系

`scripts/preflight-zeabur-go-api.mjs` 已经把该审计作为第一步。
部署前跑总预检时会自动覆盖这项检查。

## Review 命令

```bash
node --check scripts/audit-zeabur-env-example.mjs
node scripts/audit-zeabur-env-example.mjs
node scripts/preflight-zeabur-go-api.mjs
```

## 真实环境变量审计

真实 Zeabur 环境变量准备好后，使用运行时 env 审计：

```bash
ZEABUR_ENV_FILE=./deploy/zeabur.env node scripts/audit-zeabur-runtime-env.mjs
```

也可以直接从当前 shell 环境读取：

```bash
node scripts/audit-zeabur-runtime-env.mjs
```

运行时审计会检查：

- 关键变量是否缺失或为空。
- new-api 管理凭证是否至少配置一套：`NEW_API_ADMIN_ACCESS_TOKEN + NEW_API_ADMIN_USER_ID` 或 `NEW_API_ADMIN_USERNAME + NEW_API_ADMIN_PASSWORD`。
- `ZEABUR_ENV_FILE` 指向的文件是否真实存在。
- 是否仍残留 `replace-with-`、`your-`、`${...}` 或 `example.com` 占位值。
- 生产 URL 是否使用 HTTPS。
- `NODE_ENV` 是否为 `production`。
- 密钥类变量长度是否达到最低要求。
- 默认禁止 `localhost`、`127.0.0.1`、`redis:6379`、`postgres:5432` 这类本地地址。

本地调试确实需要允许本地地址时，可显式设置：

```bash
ZEABUR_ENV_ALLOW_LOCAL=1 node scripts/audit-zeabur-runtime-env.mjs
```

脚本只输出缺失项和规则名，不输出真实密钥值。
