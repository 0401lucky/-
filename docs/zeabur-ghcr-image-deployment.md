# Zeabur GHCR 镜像部署

当 Zeabur Git 服务无法稳定识别根目录 `Dockerfile` 时，改用 GitHub Actions 构建镜像，再在 Zeabur 里用 Custom Docker Image 部署。

## 镜像地址

GitHub Actions 会把镜像推到：

```text
ghcr.io/0401lucky/redemption-zeabur:latest
```

也可以使用精确提交标签：

```text
ghcr.io/0401lucky/redemption-zeabur:sha-提交短哈希
```

## GitHub Actions

workflow 文件：

```text
.github/workflows/build-ghcr-image.yml
```

推送前建议先运行当前 Go/Zeabur 发版汇总审计：

```bash
npm run audit:current-go-zeabur-release
npm run typecheck
```

该审计会确认 GHCR workflow、单容器 Dockerfile、Zeabur 单服务计划、PR #9 Go
补接门禁和 C1-C3 清理 readiness。它只做只读检查，不会部署或删除文件。

触发方式：

- push 到 `main` 自动构建。
- GitHub Actions 页面手动运行 `Build GHCR image`。

构建内容仍然使用根目录：

```text
Dockerfile
```

容器内部仍然同时启动：

- Caddy gateway：`8080`
- Next web：`3000`
- Go API：`8081`
- Go worker：后台进程

## Zeabur 部署方式

在 Zeabur 里不要再选 Git 自动识别服务，改选：

```text
Custom Docker Image
```

镜像填：

```text
ghcr.io/0401lucky/redemption-zeabur:latest
```

端口填：

```text
8080
```

如果 GHCR package 不是公开的，需要在 Zeabur 配置镜像仓库凭据：

- Registry：`ghcr.io`
- Username：GitHub 用户名
- Password：GitHub PAT，至少需要 `read:packages`

也可以在 GitHub 的 Packages 页面把 `redemption-zeabur` 设为 Public，这样 Zeabur 拉镜像时不需要凭据。

## app 环境变量

```env
NODE_ENV=production
NEXT_PUBLIC_BASE_URL=https://你的域名

GATEWAY_PORT=8080
WEB_PORT=3000
API_PORT=8081

SESSION_SECRET=换成至少32位随机字符串
ADMIN_USERNAMES=admin,lucky

APP_MODE=api
DATABASE_URL=Zeabur PostgreSQL 连接串
REDIS_URL=Zeabur Redis 连接串

INTERNAL_API_SECRET=换成随机字符串
RAFFLE_DELIVERY_CRON_SECRET=换成随机字符串
CRON_SECRET=换成随机字符串

FEEDBACK_MEDIA_DIR=/data/feedback-media
FEEDBACK_MEDIA_PUBLIC_URL=
```

## 持久卷

如果已经配置 S3/R2 兼容对象存储，反馈图片和卡牌图片会走对象存储。

如果暂时不配置 S3/R2，Go API 会使用本地 fallback：

```env
FEEDBACK_MEDIA_DIR=/data/feedback-media
```

这种模式下建议在 Zeabur 给 app 服务挂一个 persistent volume：

```text
Mount Path: /data
```

否则容器重建后，写入 `/data/feedback-media` 的本地反馈附件可能丢失。

可选外部服务：

```env
NEW_API_URL=
NEW_API_ADMIN_ACCESS_TOKEN=
NEW_API_ADMIN_USER_ID=该访问令牌所属管理员的数字用户ID，不是用户名
NEW_API_ADMIN_USERNAME=
NEW_API_ADMIN_PASSWORD=

R2_PUBLIC_URL=
S3_ENDPOINT=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET_FEEDBACK_IMAGES=feedback-images
S3_BUCKET_CARD_IMAGES=card-images
```

`NEW_API_ADMIN_ACCESS_TOKEN` 要填写 new-api 管理员账号在「个人设置 / 系统访问令牌」
生成的 token。不要填写渠道 API Key、模型转发 key、登录密码或 Cookie。
如果不想生成 token，可以填写 `NEW_API_ADMIN_USERNAME` 和 `NEW_API_ADMIN_PASSWORD`，
Go 会登录管理员账号拿 session cookie 后再调用管理接口。

当前 Go 后端会调用你的 new-api fork：

```http
GET /api/user/{目标用户ID}
POST /api/user/manage
Authorization: Bearer <NEW_API_ADMIN_ACCESS_TOKEN>
New-Api-User: <NEW_API_ADMIN_USER_ID>
```

如果 Zeabur 日志出现 `NEW_API_AUTH_FAILED` 或 `Unauthorized, invalid access token`，
优先检查 `NEW_API_ADMIN_ACCESS_TOKEN` 是否误填成管理员密码。正确做法是重新生成管理员系统访问令牌，并确认 `NEW_API_ADMIN_USER_ID` 是同一个管理员账号的数字 ID；或者直接配置管理员账号密码 fallback。

## 首次部署后

进入 Zeabur 的 `app` Shell 执行：

```bash
/app/migrate
```

`/app/migrate` 只负责把 PostgreSQL 表结构建好或升级到最新版本。fresh Zeabur
新部署不需要从 Cloudflare D1 导入数据。

然后检查：

```text
https://你的域名/healthz
https://你的域名/readyz
https://你的域名/games
https://你的域名/games/2048
```
