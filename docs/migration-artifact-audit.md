# 迁移产物索引审计

本文记录迁移文档和门禁脚本的静态一致性检查。
它用于确认关键迁移产物没有缺文件，也确认 Zeabur 总预检仍引用核心总门禁。

## 运行方式

```bash
node scripts/audit-migration-artifacts.mjs
```

## 检查范围

脚本会检查：

- Zeabur / Docker 基础文件。
- 总预检、Gateway 禁切、生产 readiness、env 审计、运行手册、运行时冒烟等核心脚本和文档。
- 积分/排行榜、商城、环保、项目、抽奖、游戏汇总、6 个普通游戏、钱包、profile、notifications、farm、cards、admin cards、feedback 的独立审计、冒烟或预检文档。
- `scripts/preflight-zeabur-go-api.mjs` 是否引用核心总门禁。
- `docs/go-zeabur-refactor-plan.md` 是否记录关键部署收口小块，包括最终预检漂移审计、证据包审批一致性、证据包输入路径一致性、生产切流 guard 失败路径自动化、最终预检显式 D1 导出输入、D1 example 输入拦截文档化、guard 覆盖漂移审计、readiness 显式传递证据输入和 readiness 证据路径一致性自动 guard。

## 不做的事

该脚本只做静态文件和引用检查：

- 不启动 Docker。
- 不访问 Gateway。
- 不写 PostgreSQL。
- 不执行业务 smoke。
- 不修改 Gateway 切流规则。

业务行为仍由各独立 smoke 脚本和 `scripts/preflight-zeabur-go-api.mjs` 验证。

## Review 命令

```bash
node --check scripts/audit-migration-artifacts.mjs
node scripts/audit-migration-artifacts.mjs
node scripts/preflight-zeabur-go-api.mjs
```
