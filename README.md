# 企业级知识库系统

基于 NestJS + React 的企业级知识库管理系统，支持文档上传、智能问答、记忆管理等功能。

## 功能特性

- 文档上传（PDF、Excel、图片）
- 智能文档解析与分块
- 基于知识库的 RAG 问答
- 双层记忆架构（Redis 短期 + PostgreSQL 长期）
- 会话历史管理
- 流式响应支持

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

编辑 `backend/.env` 文件，设置你的 OpenAI API Key：

```
OPENAI_API_KEY=your-api-key-here
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
