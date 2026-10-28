# 自定义 OIDC / Casdoor 登录

在 **管理后台 → 系统设置 → 自定义 OIDC 登录** 配置身份服务。保存后的配置存入 PostgreSQL，所有 Go API 实例在下一次请求时读取新配置，无需重启；登录页会显示配置的服务名称。

OIDC 登录沿用 new-api 的用户 ID，积分、余额、领取记录和资产仍属于原来的账号。用户名或邮箱只用于定位候选账号，授权登录必须核对 new-api 保存的身份绑定。

## 服务准备

- Go API 需要 PostgreSQL、Redis，以及 `0038_oidc_login.sql` 迁移。首次部署或升级时，沿用项目的数据库迁移流程；原生运行可在 `backend` 目录使用 `go run ./cmd/migrate -dry-run` 检查迁移，再执行 `go run ./cmd/migrate`。
- Gateway 必须使用本次更新的 `gateway/Caddyfile`，将四个公开 OIDC 路径和 `/api/admin/auth/oidc` 转发到 Go API。
- 沿用福利站现有的 new-api 管理端连接：配置 `NEW_API_URL`、`NEW_API_ADMIN_ACCESS_TOKEN` 和 `NEW_API_ADMIN_USER_ID`。现有的 `NEW_API_ADMIN_USERNAME` / `NEW_API_ADMIN_PASSWORD` 方式也可使用。管理端凭据需要有读取目标用户及其绑定的权限，并受 new-api 的角色权限限制。
- 所有 API 实例使用相同的 `SESSION_SECRET`、PostgreSQL 和 Redis。客户端密钥使用从 `SESSION_SECRET` 派生的密钥加密保存；更换 `SESSION_SECRET` 后需要重新填写 OIDC 客户端密钥。

## Casdoor 应用与后台表单

在 Casdoor 创建或选择福利站使用的 OIDC 应用，并将福利站的完整回调地址加入应用的 Redirect URLs。例如：

```text
https://welfare.example.com/api/auth/oidc/callback
```

该地址必须与福利站后台填写的值完全一致。正式站点使用 HTTPS；本机开发允许 `http://localhost` 或回环 IP。

| 后台字段 | 填写方式 |
| --- | --- |
| 登录按钮名称 | 例如 `Casdoor` 或 `企业统一登录` |
| Issuer 地址 | 使用发现文档实际返回的 `issuer` 值，完整匹配，不添加查询参数 |
| 客户端 ID / 密钥 | 福利站对应的 Casdoor 应用凭据 |
| 福利站回调地址 | 当前福利站域名加 `/api/auth/oidc/callback` |
| 发现文档地址 | 默认留空，读取 Issuer 下的 `/.well-known/openid-configuration` |
| 授权范围 | 默认 `openid profile email`，必须包含 `openid` |
| 客户端认证方式 | 按发现文档的 `token_endpoint_auth_methods_supported` 选择 `client_secret_post` 或 `client_secret_basic` |

如果 Casdoor 应用使用独立证书，在发现文档地址填写应用专属地址：

```text
https://casdoor.example.com/.well-known/应用名称/openid-configuration
```

保存时会检查发现文档的 Issuer、端点、签名算法和授权码能力。客户端凭据是否正确，会在实际登录交换令牌时验证。

客户端密钥不会回显。留空保存会保留现有密钥；更换 Issuer、发现文档地址或客户端 ID 时需要重新填写密钥。关闭开关再保存即可停用 OIDC。

## 与 new-api 绑定保持一致

用户需先在 new-api 中将账号绑定到同一个 Casdoor 身份。福利站不会根据同名账号或邮箱自动创建、合并 new-api 账号。

| new-api 接入方式 | 福利站的高级设置 |
| --- | --- |
| 内置 OIDC | 选择「内置 OIDC」；绑定身份字段固定为 `sub`，核对目标用户的 `oidc_id` |
| 自定义 OAuth 提供商 | 选择「自定义 OAuth 提供商」，填写 Casdoor 提供商的数字 ID；绑定身份字段与该提供商的用户 ID 字段保持一致，默认 `sub` |

自定义提供商的绑定读取接口为 `/api/user/{userId}/oauth/bindings`，同时核对 `provider_id` 和 `provider_user_id`。new-api 版本需提供该管理接口。

用户名字段默认 `preferred_username`。Casdoor 的标准 JWT 使用该字段；如应用返回的是其他格式，可按实际 ID Token / UserInfo 将其配置为 `name` 等字段。自定义身份和用户名字段支持 `account.id` 这样的点分隔路径，身份值保留原始大小写和数字精度。

首次登录会用用户名、邮箱定位候选账号，再核对真实绑定。两边名称不同而无法定位时，页面会要求填写已绑定的 new-api 用户名，核对通过后保存稳定的 `issuer + sub → new-api 用户 ID` 关联。后续登录沿用此关联，同时重新检查 new-api 的绑定和账号状态。

已经保存在福利站的身份关联不会自动转移到其他账号。若用户在 new-api 更换了绑定账号，需要管理员核对旧关联，避免把旧账号资产与新账号混用。

## 登录验证与排查

授权采用 Authorization Code + PKCE S256。后端检查 ID Token 签名、Issuer、Audience、有效期、nonce，以及存在时的 `azp`、`at_hash`；UserInfo 的 `sub` 必须与 ID Token 一致。浏览器仅保存 HttpOnly 流程 Cookie，登录流程和待确认身份状态由 Redis 保存并一次性消费。授权码由后端交换，令牌不返回浏览器。

保存任何 OIDC 配置会使正在进行的旧登录流程失效，用户需重新发起登录。new-api 账号已禁用、删除或解绑时，会拒绝新的 OIDC 登录；现有会话继续使用原有过期和吊销机制。

| 提示或现象 | 检查项 |
| --- | --- |
| 后台配置暂时不可用 | 迁移是否已执行，PostgreSQL 是否可用，Gateway 是否转发到 Go API |
| 发现文档校验失败 | Issuer 是否与文档一致，是否需要应用专属发现地址，端点与认证方式是否正确 |
| 身份验证失败 | 客户端密钥、回调地址、签名证书、Audience 与 Casdoor 应用配置；API 机器时间是否准确 |
| 未找到可登录的绑定账号 | new-api 接入方式、提供商 ID、身份字段及目标账号是否真实绑定 |
| 登录验证已过期 | 重新发起登录，检查回调域名是否与发起登录的福利站域名相同 |

## 本地验证

```powershell
# backend 目录
go test ./internal/oidcconfig ./internal/platform/oidclogin ./internal/platform/newapi ./internal/httpserver

# 使用独立的临时 PostgreSQL 测试库与 Redis，设置 TEST_DATABASE_URL / TEST_REDIS_URL 后
go test -tags integration ./internal/httpserver -run TestOIDC -count=1 -v

# 仓库根目录
npx vitest run src/__tests__/ui/admin-management.test.tsx src/__tests__/ui/oidc-login.test.tsx src/__tests__/ui/login-turnstile-source.test.ts
```

集成测试会写入并清理 OIDC 配置，只能使用临时测试库。测试身份服务使用真实 RSA 签名和 JWKS，覆盖回调重放、浏览器状态绑定、账号确认、现有资产保留、配置变更与禁用、解绑和并发回调。
