# Deploy Secret Hygiene Audit

本文记录部署产物敏感信息卫生审计。
目标是防止真实 Cookie、Token、Secret、Authorization、私钥或访问密钥被写进部署模板、Zeabur 文档或生产切流证据模板。

## 运行方式

```bash
node scripts/audit-deploy-secret-hygiene.mjs
```

脚本只扫描文本文件，不读取系统密钥，不连接外部服务，也不会修改文件。

## 审计范围

当前扫描：

- `deploy/zeabur.env.example`
- `deploy/zeabur-services.example.json`
- `deploy/production-cutover-evidence.example.json`
- `docs/zeabur-env-audit.md`
- `docs/zeabur-service-plan.md`
- `docs/production-cutover-evidence.md`
- `docs/production-cutover-readiness.md`
- `docs/production-cutover-preflight.md`
- `docs/zeabur-deployment-runbook.md`

脚本允许 `replace-with-*`、`your-*.example.com`、`${POSTGRES_CONNECTION_STRING}` 等占位符。
脚本会拦截像真实值的 Bearer token、Cookie session、JWT、`sk-*` key、AWS access key、private key block 和长 secret 赋值。
脚本也会检查 `.gitignore` 和 `.dockerignore` 是否忽略真实 `deploy/zeabur.env` 与 `deploy/production-cutover-evidence.json`。
脚本还会用 `git ls-files` 确认这两个真实文件没有已经被 Git 跟踪。

## Review 命令

```bash
node --check scripts/audit-deploy-secret-hygiene.mjs
node scripts/audit-deploy-secret-hygiene.mjs
node scripts/audit-zeabur-env-example.mjs
node scripts/audit-production-cutover-evidence.mjs
node scripts/audit-zeabur-service-plan.mjs
```
