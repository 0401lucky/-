# 兑换码分发系统

一个基于 Next.js 的兑换码分发网站，支持通过 new-api 用户体系登录，可部署到 Vercel。

## 功能特性

- **项目管理**: 创建多个兑换码项目，每个项目独立管理
- **用户认证**: 集成 new-api 用户登录系统
- **领取限制**: 每个用户在每个项目只能领取一次
- **批量导入**: 支持从 .txt 文件批量导入兑换码
- **状态控制**: 支持暂停/恢复项目领取
- **分发记录**: 查看详细的兑换码分发记录

## 技术栈

- **框架**: Next.js 16 (App Router)
- **样式**: Tailwind CSS
- **数据库**: Vercel KV (Redis)
- **部署**: Vercel

## 部署到 Vercel

### 1. 推送代码到 GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-repo-url>
git push -u origin main
```

### 2. 在 Vercel 导入项目

1. 访问 [vercel.com](https://vercel.com)
2. 点击 "Import Project"
3. 选择你的 GitHub 仓库

### 3. 配置 Vercel KV

1. 在 Vercel 项目设置中，进入 "Storage"
2. 点击 "Create" -> "KV"
3. 创建一个新的 KV 数据库
4. 连接到你的项目

### 4. 配置环境变量

在 Vercel 项目设置的 "Environment Variables" 中添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `NEW_API_URL` | `https://your-new-api-domain.com` | new-api 服务地址 |
| `ADMIN_USERNAMES` | `lucky` | 管理员用户名列表，逗号分隔 |
| `SESSION_SECRET` | `random-long-secret` | Session 签名密钥（生产环境必填，建议 ≥32 位随机字符串） |
| `NEW_API_ADMIN_USERNAME` | `admin` | new-api 管理员账号（用于商店直充/同步用户等管理员能力） |
| `NEW_API_ADMIN_PASSWORD` | `password` | new-api 管理员密码 |

> KV 相关的环境变量 (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) 会在连接 KV 数据库后自动配置。

### 5. 部署

点击 "Deploy"，等待部署完成即可。

## 本地开发

### 安装依赖

```bash
npm install
```

### 配置环境变量

复制 `.env.local` 文件并填写配置：

```env
NEW_API_URL=https://your-new-api-domain.com
ADMIN_USERNAMES=lucky
SESSION_SECRET=change-me-to-a-long-random-string

# 可选：用于商店直充/用户同步等管理员能力
NEW_API_ADMIN_USERNAME=your-admin-username
NEW_API_ADMIN_PASSWORD=your-admin-password

# 本地开发需要 Vercel KV 配置
# 可以从 Vercel 项目设置中复制
KV_REST_API_URL=your-kv-url
KV_REST_API_TOKEN=your-kv-token
```

### 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000

### 代码检查

```bash
npm run lint
```

> Next.js 16 已移除 `next lint` 子命令，本项目使用 ESLint CLI（`eslint .`）进行检查。

## 使用说明

### 管理员操作

1. 使用管理员账号登录
2. 点击右上角 "管理后台"
3. 创建新项目：
   - 输入项目名称（如 "5刀福利"）
   - 设置限领人数
   - 上传兑换码 .txt 文件（每行一个兑换码）
4. 管理项目：
   - 暂停/恢复领取
   - 追加兑换码
   - 查看分发记录

### 用户操作

1. 访问首页查看可领取的项目
2. 点击项目进入详情页
3. 登录后点击 "立即领取" 获取兑换码
4. 复制兑换码使用

## 项目结构

```
src/
├── app/
│   ├── page.tsx              # 首页 - 项目列表
│   ├── login/page.tsx        # 登录页
│   ├── project/[id]/page.tsx # 项目详情 - 领取页
│   ├── admin/
│   │   ├── page.tsx          # 管理后台
│   │   └── project/[id]/     # 项目详情 - 分发记录
│   └── api/
│       ├── auth/             # 认证 API
│       ├── projects/         # 项目 API
│       └── admin/            # 管理 API
├── lib/
│   ├── auth.ts               # 认证工具
│   ├── kv.ts                 # Vercel KV 操作
│   ├── new-api.ts            # new-api 客户端
│   └── utils.ts              # 工具函数
└── components/               # UI 组件
```

## License

MIT
