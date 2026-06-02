# 企业级知识库系统

基于 NestJS + React 的企业级知识库管理系统，支持文档上传、智能问答、记忆管理等功能。

## 功能特性

- 文档上传（PDF、Excel、图片）
- **有道云笔记同步**（Cookie 连接，全量/定时入库）
- 智能文档解析与分块
- 基于知识库的 RAG 问答
- 双层记忆架构（Redis 短期 + PostgreSQL 长期）
- 会话历史管理
- 流式响应支持
- **LangSmith** 追踪 RAG 检索与 LLM 调用

## 技术栈

### 后端
- NestJS + TypeScript
- PostgreSQL + pgvector
- Redis
- Prisma ORM
- OpenAI API

### 前端
- React + TypeScript
- Ant Design
- Axios
- React Markdown

## 快速开始

### 1. 安装依赖

```bash
# 后端
cd backend
npm install

# 前端
cd frontend
npm install
```

### 2. 启动数据库和 Redis

```bash
docker-compose up -d
```

### 3. 数据库迁移

```bash
cd backend
npx prisma migrate dev
npx prisma generate
```

### 4. 配置环境变量

```bash
cd backend
copy .env.example .env   # Windows
# cp .env.example .env   # Linux/macOS
```

编辑 `backend/.env`，至少配置 `DATABASE_URL`、`DASHSCOPE_API_KEY`。  
有道同步还需 `ENCRYPTION_KEY`（自行生成的随机串，见 `.env.example` 内说明，**不是**从有道网站查询）。

### LangSmith 可观测性（可选）

在 [smith.langchain.com](https://smith.langchain.com/) 创建 API Key 后，于 `backend/.env` 配置：

```env
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_pt_xxx
LANGSMITH_PROJECT=knowledge-base
```

启动后端后发起一次对话，在 LangSmith 项目中可看到：

- `knowledge-hybrid-search`：ES + 向量 + RRF + Rerank 检索
- `knowledge-chat`：通义千问 `streamText` 流式生成

未配置 API Key 时自动关闭追踪，不影响业务。

### 有道云笔记同步

1. 执行迁移后启动后端，前端点击 **有道云笔记**
2. 浏览器登录 [note.youdao.com](https://note.youdao.com)，F12 → Network 复制 Cookie 与 `cstk` 参数
3. 保存连接 → **立即同步全部笔记**，笔记将分块写入知识库并参与 RAG 检索
4. 服务运行期间按 `SyncJob.cronExpr` 自动同步（**BullMQ + Redis**，默认每小时）

### 定时同步引擎（BullMQ，仿 OpenClaw Cron）

| 层级 | 作用 | 本项目对应 |
|------|------|------------|
| **任务定义持久化** | 重启不丢调度配置 | PostgreSQL `SyncJob` + `backend/data/sync-cron-jobs.json` |
| **调度引擎** | 按 cron 触发 | BullMQ `repeat.pattern` + 时区 |
| **执行队列** | 异步、可重试 | Redis 队列 `source-sync` + Worker |
| **执行体** | 真正拉取笔记 | `SyncOrchestratorService.syncUserProvider` |

环境变量见 `backend/.env.example` 中 `SYNC_CRON_*`。修改 cron：

```bash
PATCH /sources/sync/jobs/{syncJobId}
Header: x-user-id: demo-user
Body: { "cronExpr": "0 */2 * * *", "enabled": true }
```

从 DB 重建 BullMQ 与本地 json：`POST /sources/sync/reconcile`

API 示例：

```bash
# 保存凭据
POST /sources/youdao/credentials
Header: x-user-id: demo-user
Body: { "cookie": "...", "cstk": "..." }

# 同步全部笔记
POST /sources/youdao/sync
Body: { "syncAll": true }
```

### 5. 启动服务

```bash
# 后端 (端口 3000)
cd backend
npm run start:dev

# 前端 (端口 3001)
cd frontend
npm start
```

## 项目结构

```
knowledge/
├── backend/                 # NestJS 后端
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/        # 认证模块
│   │   │   ├── conversation/# 对话模块
│   │   │   ├── knowledge/   # 知识库模块
│   │   │   ├── file/        # 文件处理模块
│   │   │   ├── memory/      # 记忆管理模块
│   │   │   └── ai/          # AI 服务模块
│   │   └── main.ts
│   └── prisma/              # 数据库 Schema
├── frontend/                # React 前端
│   └── src/
│       └── App.tsx
└── docker-compose.yml       # Docker 配置
```

## API 接口

### 认证
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录

### 对话
- `POST /api/conversations` - 创建对话
- `GET /api/conversations` - 获取对话列表
- `GET /api/conversations/:id` - 获取对话详情
- `DELETE /api/conversations/:id` - 删除对话

### 文件
- `POST /api/files/upload` - 上传文件

### 知识库
- `GET /api/knowledge` - 获取文档列表
- `GET /api/knowledge/search?q=xxx` - 搜索文档

### AI 对话
- `POST /api/ai/chat/:conversationId` - 发送消息

### 记忆
- `GET /api/memory/:conversationId/short` - 获取短期记忆
- `GET /api/memory/:conversationId/long` - 获取长期记忆
- `GET /api/memory/:conversationId/context` - 获取完整上下文

## 架构设计

### 记忆管理

```
用户发送消息
    ↓
写入 Redis（更新短期记忆）
    ↓
写入 PostgreSQL（落库永久保存）
    ↓
检查 token 计数 → 超过阈值 → 截断 + 摘要
    ↓
AI 回答时：合并短期记忆 + 知识库检索 + 长期记忆
```

### 文档处理流程

```
上传文件 → 解析内容 → 分块处理 → 向量化 → 存储
```

## 后续开发

- [ ] 用户认证完善（JWT 中间件）
- [ ] 向量数据库集成（pgvector 完整实现）
- [ ] 流式响应（SSE）
- [ ] 文件管理界面
- [ ] 知识库权限管理
- [ ] 多模型支持

## 许可证

MIT
