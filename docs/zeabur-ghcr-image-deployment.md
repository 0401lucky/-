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

可选外部服务：

```env
NEW_API_URL=
NEW_API_ADMIN_ACCESS_TOKEN=
NEW_API_ADMIN_USER_ID=

R2_PUBLIC_URL=
S3_ENDPOINT=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET_FEEDBACK_IMAGES=feedback-images
S3_BUCKET_CARD_IMAGES=card-images
```

## 首次部署后

进入 Zeabur 的 `app` Shell 执行：

```bash
/app/migrate
```

然后检查：

```text
https://你的域名/healthz
https://你的域名/readyz
https://你的域名/games
https://你的域名/games/2048
```
