# 福利站接入 new-api Turnstile 登录：PRD 与实施计划

> 文档状态：已实施，待生产部署与真实浏览器验证
> 编写日期：2026-08-09；实施更新：2026-08-11
> 适用仓库：福利站 `D:\code\模型计算\兑换码分发`
> 依赖仓库：new-api fork `D:\code\Claude code program\new-api`
> new-api 基线：`537caf4e931876ce994b83325d1253291d0eb836`

## 1. 结论

new-api 开启 Cloudflare Turnstile 后，密码登录协议变为：

```http
POST /api/user/login?turnstile=<一次性令牌>
Content-Type: application/json

{
  "username": "...",
  "password": "..."
}
```

福利站当前前端、Go 登录处理器和 new-api Go client 都只传用户名与密码，
没有生成或转发 `turnstile`，因此 new-api 必然返回：

```json
{
  "success": false,
  "message": "Turnstile token 为空"
}
```

推荐方案是：**在福利站登录页渲染 Turnstile，由浏览器生成 token，福利站
Go API 接收后仅做短暂透传，再以 query 参数 `turnstile` 转发给 new-api。**

不需要、也不允许把 Turnstile Secret Key 提供给福利站前端、提交到仓库，
或发送给实施 agent。Secret Key 继续只保存在 new-api 服务端。

## 2. 完成标准

以下条件全部满足才算完成：

1. new-api 未开启 Turnstile 时，福利站现有账号密码登录不受影响。
2. new-api 开启 Turnstile 时，福利站登录页展示人机验证，验证完成前不能提交。
3. 福利站调用 new-api 时严格使用
   `/api/user/login?turnstile=<URL 编码后的 token>`。
4. token 为空、过期、重复使用或校验失败时，不创建福利站会话、不写入用户同步
   数据，并提示用户重新验证。
5. Turnstile 类失败不计入密码错误次数，不会误触发账号登录锁定。
6. 登录失败、token 过期及组件报错后会重置组件，不能复用一次性 token。
7. token 不进入日志、Redis、数据库、Cookie、localStorage 或监控标签。
8. 福利站生产域名已加入对应 Cloudflare Turnstile Widget 的 Hostnames。
9. 自动化测试、构建、真实浏览器登录冒烟全部通过。
10. 回滚后能恢复到改造前版本，且无需关闭或泄露 Turnstile Secret Key。

## 3. 已核实的现状与证据

### 3.1 福利站当前链路

```text
[福利站登录页]
  POST /api/auth/login
  body: username + password
          │
          ▼
[福利站 Go auth handler]
  只解析 username + password
          │
          ▼
[福利站 new-api client]
  POST NEW_API_URL/api/user/login
  body: username + password
          │
          ▼
[new-api Turnstile middleware]
  查不到 query.turnstile
  返回 “Turnstile token 为空”
```

已核实文件：

- `src/app/login/page.tsx`：`POST /api/auth/login`，body 仅有
  `username`、`password`。
- `backend/internal/httpserver/auth_handlers.go`：登录 payload 仅有上述两字段；
  上游所有 `success:false` 当前都会记录为登录失败。
- `backend/internal/platform/newapi/login.go`：请求 `/api/user/login` 时没有
  `turnstile` query 参数。
- `gateway/Caddyfile`：`/api/auth/login` 已精确切到 Go，不是路由未命中问题。

### 3.2 new-api fork 的实际协议

已核实文件：

- `router/api-router.go`：`POST /api/user/login` 挂载
  `middleware.TurnstileCheck()`。
- `middleware/turnstile-check.go`：只读取 `c.Query("turnstile")`；token 不在
  JSON body，也不使用 `cf-turnstile-response` 作为接口字段名。
- `web/src/features/auth/api.ts`：new-api 自带前端按
  `/api/user/login?turnstile=${token}` 调用。
- `controller/misc.go`：公开 `GET /api/status` 返回
  `turnstile_check` 和 `turnstile_site_key`，不返回 Secret Key。

### 3.3 Cloudflare 约束

- token 有效期约 300 秒。
- token 只能成功验证一次。
- token 过期、失败或已经提交后必须重新获取。
- `remoteip` 是 Siteverify 的可选参数。
- Site Key 是公开值；Secret Key 只能留在服务端。

## 4. 产品需求

### 4.1 用户故事

作为福利站用户，我希望在 new-api 开启人机验证后，仍能直接在福利站完成验证和
账号登录，而不需要先去 new-api 登录，也不需要复制 Cookie 或 token。

### 4.2 正常流程

1. 用户打开福利站登录页。
2. 页面从福利站同源配置接口获取 Turnstile 开关和 Site Key。
3. 若未开启，页面保持现有登录流程。
4. 若已开启，页面加载 Cloudflare Turnstile Widget。
5. Widget 回调产生一次性 token。
6. 用户提交用户名、密码和 token 到福利站 `/api/auth/login`。
7. 福利站 Go API 校验 token 非空且长度合理，然后将其 URL 安全编码后转发给
   new-api。
8. new-api 使用自己的 Secret Key 调用 Cloudflare Siteverify。
9. new-api 登录成功后，福利站继续创建自身会话、同步本地用户并跳转。

### 4.3 异常流程

- 配置加载失败：显示“人机验证配置暂时不可用”，在 Turnstile 已知开启时禁止
  盲目提交。
- Widget 加载失败：提供“重新加载验证”操作，不发送登录请求。
- token 为空：福利站直接返回明确的 400，不调用 new-api。
- token 过期、重复或校验失败：不累计密码错误次数，清空 token 并重置 Widget。
- 用户名或密码错误：沿用现有失败次数和锁定策略，同时重置 Widget 获取新 token。
- new-api 超时或 5xx：显示服务暂时不可用，不累计密码错误次数。
- new-api 要求 2FA：本期不得错误创建福利站会话；见“范围与待决策项”。

### 4.4 交互要求

- Turnstile 放在密码框与“立即登录”按钮之间。
- 开启验证时，在 token 生成前禁用登录按钮。
- 验证中、验证成功、验证失败均有可读状态。
- 保持当前登录页布局和移动端适配，不引入整页跳转。
- 不展示技术错误“Turnstile token 为空”；统一为用户可理解的提示，例如：
  “请先完成人机验证”或“人机验证已失效，请重新验证”。

## 5. 范围

### 5.1 本期必须完成

- 福利站同源 Turnstile 公共配置读取。
- 福利站登录页 Turnstile Widget。
- `/api/auth/login` 接收 token。
- new-api client 以 query 参数转发 token。
- Turnstile 与凭证错误分类。
- token 生命周期、日志安全和失败重置。
- 单元、集成、冒烟和浏览器验证。
- 环境示例与部署文档更新。

### 5.2 本期不做

- 不关闭 new-api 全局 Turnstile。
- 不在福利站保存或使用 Turnstile Secret Key。
- 不使用打码平台、浏览器自动解题或伪造 token。
- 不让浏览器直接跨域登录 new-api。
- 不用管理员 access token 代替用户登录。
- 不在 URL、日志、数据库或缓存中长期保存 token。
- 不为本需求重构无关认证、钱包或 Gateway 路由。

### 5.3 可选安全加固

以下事项可以另开 PR，不应阻塞最小兼容修复，除非真实冒烟证明必须处理：

- new-api Siteverify 校验 `hostname` 和 `action`。
- new-api 对登录错误返回稳定的机器可读 `code`。
- new-api 调整代理 IP 处理或省略可选 `remoteip`。
- 完整支持 new-api 新认证响应中的 2FA 和 refresh cookie。

## 6. 推荐技术设计

### 6.1 总体架构

```text
浏览器（福利站域名）
  │ 1. GET /api/auth/turnstile-config
  │ 2. Cloudflare Widget 生成一次性 token
  │ 3. POST /api/auth/login { username, password, turnstileToken }
  ▼
福利站 Go API
  │ 4. 不保存、不验证 Secret，仅做输入校验和透传
  │ 5. POST NEW_API_URL/api/user/login?turnstile=<encoded token>
  ▼
new-api
  │ 6. 使用自身 Secret Key 调用 Cloudflare Siteverify
  │ 7. 验证通过后执行密码登录
  ▼
福利站 Go API
  │ 8. 创建福利站 Session、同步用户
  ▼
浏览器进入福利站
```

### 6.2 公共配置来源

推荐新增福利站同源接口：

```http
GET /api/auth/turnstile-config
```

建议响应：

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "siteKey": "公开的 Site Key"
  }
}
```

实现方式建议由 Go 服务端请求 `${NEW_API_URL}/api/status`，只提取：

- `data.turnstile_check`
- `data.turnstile_site_key`

建议设置 30～60 秒内存缓存和短超时，避免每次页面打开都把 new-api 状态接口变成
强依赖。该接口不得返回 new-api 的其他系统配置，更不得返回 Secret Key。

选择服务端同源代理而不是浏览器直连 new-api 的原因：

- 不依赖 new-api 跨域 CORS。
- 不在前端重复配置 new-api 基址。
- Turnstile 开关变更可以动态生效。
- 对外响应面更小。

允许的简化备选是通过福利站公开构建变量配置 Site Key，但必须同时解决“new-api
关闭验证时如何自动回退”和各部署环境构建期配置一致性问题。除非工期要求极短，优先
使用同源配置接口。

### 6.3 登录请求契约

福利站浏览器到 Go 的建议请求：

```json
{
  "username": "lucky",
  "password": "********",
  "turnstileToken": "一次性 token；未开启时可为空"
}
```

命名可以选择 `turnstile`，但前后端必须统一。推荐在福利站内部使用语义明确的
`turnstileToken`，只在 new-api client 边界映射为 query `turnstile`。

输入规则：

- trim 后判断空值，但不要修改非空 token 内容。
- 设置合理长度上限，至少覆盖 Cloudflare 当前最大 2048 字符；建议上限 4096，超出
  直接 400。
- 未开启 Turnstile 时允许为空；开启时为空直接 400。
- 不输出 token 到错误信息或日志。

### 6.4 new-api client 变更

将登录函数扩展为接收 token，例如：

```go
Login(ctx, baseURL, username, password, turnstileToken, httpClient)
```

使用 `net/url` 构建查询参数，禁止字符串直接拼接：

```go
loginURL, err := url.Parse(baseURL + "/api/user/login")
query := loginURL.Query()
query.Set("turnstile", turnstileToken)
loginURL.RawQuery = query.Encode()
```

上游 body 继续只发送：

```json
{
  "username": "...",
  "password": "..."
}
```

注意：token 位于上游 URL query。任何 HTTP client、反向代理、APM 或错误包装都不得
记录完整 URL。福利站现有请求日志只记录 `request.URL.Path`，需要保持这一性质。

### 6.5 错误分类与锁定策略

当前福利站会把 new-api 所有 `success:false` 都记录为密码失败，这是本次必须修复的
安全与可用性问题。

建议 new-api client 返回结构化失败类型，而不是让 handler 直接猜测：

```text
verification_required   人机验证缺失
verification_failed     人机验证无效、过期或重复
invalid_credentials     用户名或密码错误
two_factor_required     需要 2FA
upstream_unavailable    超时、5xx、非法响应
other_auth_failure      其他明确认证失败
```

最优做法是在 new-api fork 同步增加稳定 `code`，福利站按 `code` 判断。

如果本期只改福利站，可以暂时按当前 fork 的稳定消息精确映射：

- `Turnstile token 为空`
- `Turnstile 校验失败，请刷新重试！`

消息映射必须集中在 new-api client 包中，并保留未知错误的安全回退；不要在 handler
散落字符串判断。

只有 `invalid_credentials` 可以调用 `recordLoginFailure`。以下情况均不得累计：

- Turnstile 缺失或失败。
- 上游超时、网络错误、5xx、非法 JSON。
- 配置缺失。
- 2FA 要求。
- 其他无法确认是密码错误的错误。

建议 API 状态：

- 400：福利站缺 token、token 格式无效。
- 401：明确用户名或密码错误。
- 409 或专用业务响应：需要 2FA，但本期未支持。
- 429：福利站现有速率限制或密码失败锁定。
- 502/503：new-api 或配置不可用。

### 6.6 前端组件与 token 生命周期

可以实现轻量 Turnstile 组件，也可以参考 new-api fork 的组件结构，但不要跨仓库复制
受保护品牌或无关 UI。

组件行为：

- 脚本：`https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`
- 使用 `window.turnstile.render` 显式渲染。
- success callback：保存 token。
- expired callback：清空 token，标记需重新验证。
- error callback：清空 token，显示失败状态。
- 组件卸载时调用 `turnstile.remove(widgetId)`。
- 登录尝试完成后，无论是密码错误还是验证失败，都重置 Widget；token 已经提交就视为
  已消费，不得复用。

建议不要将 token 写入 localStorage、sessionStorage 或全局状态持久化；只保存在登录页
组件内存状态。

### 6.7 Hostname 配置

同一个 new-api Turnstile Site Key 要在福利站页面渲染，Cloudflare Widget 的
Hostnames 必须包含：

- new-api 的实际登录域名。
- 福利站的实际生产域名。
- 需要真实验证的预览域名；不要无边界加入通配域名。

Cloudflare 控制台只填写主机名，不含 `https://`、端口或路径。

Site Key 和 Secret Key 必须来自同一个 Widget。当前 new-api 后台在启用开关时只检查
Site Key 非空，Secret 为空或配错会导致所有非空 token 都校验失败，因此必须用真实
token 冒烟才能证明配对正确。

### 6.8 IP 与代理信任链

当前 new-api 会把 `c.ClientIP()` 作为 `remoteip` 发给 Cloudflare。福利站作为服务端
代理后，new-api 默认可能看到福利站服务出口 IP，而不是访客 IP。

实施顺序：

1. 先完成 token 链路，并在测试环境用真实浏览器 token 冒烟。
2. 如果校验成功，不为本需求扩大代理信任面。
3. 如果确认因 IP 不一致失败，优先在 new-api 中省略可选 `remoteip`，或建立严格的
   可信代理链后再透传真实 IP。

禁止直接信任浏览器传来的 `X-Forwarded-For`。福利站已有 `clientIP()` 会在直连对端为
内网代理时从右向左解析公网 IP；若要把它继续传到 new-api，new-api 的
`TRUSTED_PROXIES` 必须精确限制为福利站/Gateway 地址或网段，并增加伪造 XFF 测试。

## 7. API 契约

### 7.1 `GET /api/auth/turnstile-config`

成功、未启用：

```json
{
  "success": true,
  "data": {
    "enabled": false,
    "siteKey": ""
  }
}
```

成功、已启用：

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "siteKey": "0x..."
  }
}
```

new-api 不可用：

```json
{
  "success": false,
  "message": "人机验证配置暂时不可用"
}
```

不要回传上游完整响应。

### 7.2 `POST /api/auth/login`

请求：

```json
{
  "username": "lucky",
  "password": "password",
  "turnstileToken": "0.xxx"
}
```

验证缺失：

```json
{
  "success": false,
  "code": "TURNSTILE_REQUIRED",
  "message": "请先完成人机验证"
}
```

验证失败：

```json
{
  "success": false,
  "code": "TURNSTILE_FAILED",
  "message": "人机验证已失效，请重新验证"
}
```

凭证错误：

```json
{
  "success": false,
  "code": "INVALID_CREDENTIALS",
  "message": "用户名或密码错误"
}
```

成功响应保持现有契约，避免影响调用方。

## 8. 分阶段实施计划

### 阶段 A：先写测试和接口模型

目标：先固定协议和安全边界。

任务：

1. 为 `backend/internal/platform/newapi/login.go` 增加测试：
   - token 被放入 query `turnstile`。
   - body 仍只有用户名和密码。
   - 包含 `+`、`/`、`=`、`&`、`?` 的 token 经 URL 编码后在服务端还原一致。
   - 不传 token 时兼容 Turnstile 关闭场景。
2. 为 auth handler 增加测试：
   - 开启验证且 token 为空时返回 400，不调用上游。
   - Turnstile 失败不增加 Redis 密码失败计数。
   - 密码错误仍增加失败计数。
   - 上游超时或 5xx 不增加失败计数。
3. 给配置接口定义响应模型与测试。

交付物：失败的测试用例和明确接口模型。

### 阶段 B：实现 Go 配置接口与 token 透传

目标：打通服务端契约。

建议改动：

- `backend/internal/httpserver/server.go`
  - 注册 `GET /api/auth/turnstile-config`。
- `backend/internal/httpserver/auth_handlers.go`
  - 解析 `turnstileToken`。
  - 缺 token 快速失败。
  - 按失败分类决定是否记录密码失败。
- `backend/internal/platform/newapi/login.go`
  - 扩展 Login 参数。
  - 使用 `net/url` 设置 query。
  - 增加结构化错误类型或失败分类。
- 新增或复用 new-api status client：
  - 只读取 `turnstile_check` 和 `turnstile_site_key`。
  - 使用短超时、有限响应体和 30～60 秒内存缓存。
  - 合并并发刷新，短暂缓存失败，并在短期上游故障时使用最近一次安全配置，
    避免公开配置接口放大故障。
- `gateway/Caddyfile`
  - 精确增加 `/api/auth/turnstile-config` 到 Go；禁止扩大到
    `/api/auth/*` 通配。

同时检查所有 `newapi.Login` 调用点。尤其是
`backend/internal/platform/newapi/client.go` 的管理员账号密码回退：new-api 全局开启
Turnstile 后，该服务端回退同样无法获得浏览器 token。生产应优先使用
`NEW_API_ADMIN_ACCESS_TOKEN + NEW_API_ADMIN_USER_ID`；不要试图缓存或自动求解用户
Turnstile token 给管理员回退使用。必要时让管理员密码回退在收到 Turnstile 错误时
明确失败，并更新部署文档。

### 阶段 C：实现登录页 Widget

目标：让用户能在福利站完成验证。

建议改动：

- 新增可测试的 Turnstile 组件，例如 `src/components/TurnstileWidget.tsx`。
- 修改 `src/app/login/page.tsx`：
  - 加载同源配置。
  - 按开关渲染 Widget。
  - 管理 token、组件 key 和加载/失败状态。
  - 提交 `turnstileToken`。
  - 每次提交结束后按规则重置。
  - 配置或组件不可用时给出清晰提示。
- 保持现有登录页样式与移动端布局。

### 阶段 D：完善自动化与冒烟脚本

目标：覆盖实际代理链路，而不只覆盖函数。

任务：

1. 更新 `backend/internal/platform/newapi/login_test.go`。
2. 更新 `backend/internal/httpserver/auth_login_integration_test.go` 的 fake new-api：
   - 校验 `turnstile` query。
   - 模拟 Turnstile 失败、密码失败和成功。
   - 断言失败计数的差异。
3. 更新 `scripts/smoke-auth-login-go-api.mjs`：
   - fake `/api/status`。
   - 检查精确 Gateway 路由。
   - 检查 token 经 Gateway → Go → fake new-api 完整透传。
4. 增加前端测试：
   - 关闭时不渲染、不加载脚本。
   - 开启时 token 前不能提交。
   - success/expired/error callback。
   - 登录失败后 reset。
   - 组件卸载清理。

### 阶段 E：部署配置与真实验证

目标：证明 Cloudflare、域名和服务代理组合真实可用。

部署前：

1. 确认生产 `NEW_API_URL` 是当前有效基址。不要直接采用仓库内历史
   `.env.*.local` 的旧值。
2. 在 Cloudflare Turnstile Widget 添加福利站生产主机名。
3. 确认 new-api 后台的 Site Key 与 Secret Key 是同一 Widget 的配对值。
4. 确认福利站生产使用管理员 access token 进行钱包管理端鉴权，避免管理员密码回退
   被 Turnstile 阻断。

真实冒烟：

1. 打开福利站登录页，确认 Widget 正常加载。
2. 正确验证 + 错误密码：显示凭证错误，Widget 重置，失败计数增加一次。
3. 正确验证 + 正确密码：成功登录，设置福利站 Session。
4. 等待 token 过期后提交：提示重新验证，不增加密码失败计数。
5. 模拟 Widget error：不发登录请求，可重新加载。
6. 检查 new-api、福利站、Gateway 和平台日志，确认没有完整 token。
7. 检查手机宽度和桌面宽度下布局。

## 9. 测试矩阵

### 9.1 后端

- Turnstile 关闭 + 无 token + 正确密码：成功。
- Turnstile 开启 + 无 token：400、无上游请求、无失败计数。
- 非空有效 token + 正确密码：成功。
- 非空 token + Cloudflare 校验失败：验证错误、无失败计数。
- 已消费 token 重试：验证错误、无失败计数。
- 有效 token + 错误密码：401、失败计数 +1。
- new-api 超时、断连、5xx、非法 JSON：502/503、无失败计数。
- 超长 token：400、无上游请求。
- 特殊字符 token：透传值完全一致。
- 成功时继续同步 `users`、`point_accounts`、`user_assets` 并设置福利站会话。
- 所有失败路径均不创建会话、不写用户同步数据。

### 9.2 前端

- 开关关闭时页面行为与改造前一致。
- 开关开启时显示 Widget。
- 配置加载中和 Widget 初始化中不可提交。
- callback 后可提交。
- expired/error 后不可提交。
- 任意已发出的登录尝试结束后不复用原 token。
- 页面卸载后 Widget 被清理。
- 脚本加载失败可以重试。
- 错误提示不会泄露 token 或 Secret。

### 9.3 安全

- 客户端伪造 `X-Forwarded-For` 不得改变受信任的真实 IP 结果。
- 日志只记录 path，不记录带 token 的 RawQuery 或完整上游 URL。
- token 不存 Redis、数据库、Cookie、localStorage。
- 配置接口只返回开关与 Site Key。
- Hostname allowlist 不使用无边界通配。
- 跨站 Origin 仍被现有来源校验拒绝。
- 速率限制仍在 Turnstile 校验之外生效，避免攻击者用无效 token 打满上游。

## 10. 建议验证命令

所有后台测试单次最长 60 秒；如全量测试超过该限制，拆包执行。

```powershell
# 福利站前端静态检查
npm run typecheck
npm run lint
npm test
npm run build

# Go 定向测试
Set-Location backend
go test ./internal/platform/newapi ./internal/httpserver -count=1 -timeout 60s

# 返回仓库根目录运行登录冒烟
Set-Location ..
node scripts/smoke-auth-login-go-api.mjs
```

若改动 Gateway：

```powershell
docker run --rm `
  -v "${PWD}\gateway\Caddyfile:/etc/caddy/Caddyfile:ro" `
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

最终必须通过真实浏览器和真实 Cloudflare Widget 做一次登录，fake new-api 冒烟不能
替代这一步。

## 11. 发布与回滚

### 11.1 发布顺序

1. 先把福利站域名加入 Turnstile Widget Hostnames。
2. 部署包含配置接口、Go 透传和前端 Widget 的福利站版本。
3. 在测试/预览环境真实冒烟。
4. 小流量发布生产并观察登录成功率、验证失败率和锁定次数。
5. 确认日志无 token 后完成发布。

### 11.2 回滚

代码回滚到上一福利站版本即可，但 new-api 仍开启 Turnstile 时，旧福利站会再次无法
登录。因此生产回滚策略应二选一：

- 优先：回滚到本功能的前一个“已验证可用”版本，而不是完全不支持 Turnstile 的
  旧版本。
- 紧急：短时关闭 new-api Turnstile，恢复登录后立即修复并重新开启。

关闭安全验证属于临时降级，需记录开始/结束时间并保留福利站限流与登录锁定。

## 12. 风险与处理

### 风险 1：Widget Hostname 不匹配

表现：组件无法生成有效 token或 Siteverify 失败。
处理：Cloudflare Widget 添加福利站主机名，并确认使用同一对 Site/Secret Key。

### 风险 2：代理 IP 不一致

表现：浏览器生成的 token 在 new-api 校验失败。
处理：先用真实冒烟确认；必要时在 new-api 省略可选 `remoteip`，或建立严格可信代理链。

### 风险 3：验证码失败误锁账号

表现：用户因组件或网络问题被福利站锁定。
处理：只有明确凭证错误才计数；增加 Redis 断言测试。

### 风险 4：token 泄露到访问日志

表现：上游完整 URL 带 query 被记录。
处理：日志只记录 path；审查 HTTP 调试、APM、错误包装和反向代理日志。

### 风险 5：管理员密码回退失效

表现：钱包等管理调用在 access token 失效后尝试密码登录，却同样被 Turnstile 拦截。
处理：生产优先配置有效的管理员系统 access token + user ID；Turnstile 错误时不要自动
反复密码登录。

### 风险 6：2FA 账号无法完成福利站登录

表现：new-api 返回 `require_2fa`，现有福利站 Login parser 期待用户资料并报上游错误。
处理：先确认福利站目标用户是否启用 2FA。若必须支持，另立需求实现 flow token 和
`/api/user/login/2fa` 的第二步交互；本 PR 不得把它当普通成功。

### 风险 7：新版 new-api Cookie 兼容

当前 new-api 成功响应以 access token/session bundle 为主，并设置
`new_api_refresh` Cookie；福利站现有 `extractSessionCookie` 只查找旧 `session=`。
福利站自身 `app_session`/`session` 登录仍可工作，但 `new_api_session` 可能为空。
实施 agent 应确认该 Cookie 是否仍有实际消费者；如果没有，不要把这个旁支扩大成本次
Turnstile 修复。如果有，再单独设计安全的新版认证凭据传递。

## 13. 待实施前确认

以下信息不需要写入代码或聊天中的密钥：

1. 当前生产有效的 `NEW_API_URL`。
2. 福利站生产主机名及需要验证的预览主机名。
3. Cloudflare Widget 中是否已加入这些 Hostnames。
4. new-api 后台 Site Key/Secret Key 是否来自同一个 Widget，只需确认“是/否”。
5. 是否存在必须通过福利站登录的 2FA 用户。
6. 生产钱包鉴权是否已使用
   `NEW_API_ADMIN_ACCESS_TOKEN + NEW_API_ADMIN_USER_ID`。

禁止向实施 agent 提供：

- Turnstile Secret Key。
- 用户或管理员密码。
- Cookie、refresh token、access token。
- 完整的一次性 Turnstile token。

## 14. 建议的任务拆分

为避免写冲突，建议下一位主 agent 按以下边界调度：

1. 子任务一：Go new-api client、错误分类及对应单元测试。
2. 子任务二：Go 配置接口、auth handler 和集成测试。
3. 子任务三：前端 Turnstile 组件、登录页和前端测试。
4. 子任务四：Gateway、冒烟脚本、环境示例和部署文档。
5. 主 agent：统一接口命名、合并结果、跑完整验证与真实浏览器冒烟。

同一文件必须由单一 agent 负责；`auth_handlers.go`、`login.go` 和
`login/page.tsx` 不应被多个 agent 同时修改。

## 15. 交付清单

- [x] 同源 Turnstile 配置接口。
- [x] 精确 Gateway 路由。
- [x] 登录请求携带 `turnstileToken`。
- [x] new-api query `turnstile` 安全透传。
- [x] Turnstile 失败与密码错误分类。
- [x] 不误增登录失败次数和用户名级限流计数。
- [x] Widget 过期、错误和提交后重置。
- [x] token 不落业务日志和持久化存储。
- [ ] Hostname 与 Site/Secret 配对确认。
- [ ] 管理员 access token 真实管理调用确认；生产变量已确认配置。
- [x] Go、前端、构建、Gateway 和静态冒烟门禁通过。
- [ ] 真实浏览器生产前验证通过。
- [ ] 回滚方案已演练或明确。
