# Current Go/Zeabur Release Readiness

本文记录当前代码用于 Zeabur GHCR 测试部署前的状态。

## 当前结论

当前代码可以先推到 `main` 触发 GitHub Actions 构建 GHCR 镜像，并在 Zeabur
用 Custom Docker Image 方式部署测试。

当前仍不宣称“严格生产完成”，原因是：

- 生产 readiness 仍缺真实 Cookie、远端冒烟和证据审批。
- C1-C3 旧 Next API / Cloudflare/OpenNext 物理清理已准备好，但尚未确认执行。

## 发版硬门禁

推送前必须通过：

```bash
npm run audit:current-go-zeabur-release
npm run audit:pr-9-go-reconciliation
npm run audit:c1-c3-cleanup-readiness
npm run audit:c1-c3-cleanup-runbook
node scripts/audit-migration-artifacts.mjs
npm run typecheck
```

这些命令只读，不会部署、删除文件或修改依赖。

## 当前已满足

- GHCR workflow 使用 `ghcr.io/0401lucky/redemption-zeabur`。
- 根目录 `Dockerfile` 是单容器多进程入口。
- 容器对外端口是 `8080`。
- 容器内同时启动：
  - Caddy Gateway
  - Next web
  - Go API
  - Go worker
- `/app/migrate` 已打包进镜像。
- PR #9 关键 Go 对账门禁已覆盖：
  - 2048 排行榜
  - 2048 素材
  - v3.0 公告
  - 禁止恢复旧 `requestGameFallback`
  - 禁止恢复旧后台用户迁移按钮
- C1-C3 dry-run 已 ready：
  - 旧 Next API 删除候选 154 个
  - Cloudflare/OpenNext 文件产物 5 个
  - package Cloudflare 信号 8 个

## 当前软阻塞

这些不会阻止测试部署，但会阻止“严格生产完成”结论：

- `auth` 缺真实登录态 Cookie 与页面级证据。
- `wallet` 缺真实 new-api 小额充值/提现证据。
- `profile` 缺真实登录态冒烟证据。
- `notifications` 缺真实登录态冒烟证据。
- `farm` 缺真实登录态页面级冒烟证据。
- `cards` 缺前台与后台真实登录态冒烟证据。
- C1-C3 物理清理未确认执行。

生产证据收集步骤见：

```text
docs/production-evidence-collection-runbook.md
```

## Zeabur 部署要点

在 Zeabur 中使用：

```text
Custom Docker Image
ghcr.io/0401lucky/redemption-zeabur:latest
Port: 8080
```

首次部署后进入 app shell 执行：

```bash
/app/migrate
```

fresh Zeabur 新部署不需要从 Cloudflare D1 导入数据。

如果暂时不配置 S3/R2，建议给 app 挂 persistent volume：

```text
Mount Path: /data
```

否则本地 fallback 写入 `/data/feedback-media` 的反馈附件可能在容器重建后丢失。

## new-api 环境变量

`NEW_API_ADMIN_ACCESS_TOKEN` 必须填写 new-api 管理员账号在
「个人设置 / 系统访问令牌」生成的 access token。

不要填写：

- 管理员登录密码
- 渠道 API Key
- 模型转发 Key
- Cookie

如果不想使用 access token，可以配置：

```env
NEW_API_ADMIN_USERNAME=
NEW_API_ADMIN_PASSWORD=
```

Go 后端会登录管理员账号后再调用管理接口。

## 推送后检查

部署完成后先检查：

```text
https://你的域名/healthz
https://你的域名/readyz
https://你的域名/games
https://你的域名/games/2048
```

再用测试账号覆盖：

- 登录
- 2048 开局与结算
- 商城余额
- 福利项目列表
- 抽奖列表
- 签到
- 通知
- 农场
- 后台用户管理
