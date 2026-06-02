# 企业级知识库系统 + 溜娃助手

基于 NestJS + React 的全栈应用，包含两大核心模块：**知识库对话系统** 与 **溜娃助手**。

---

## 一、技术栈总览

| 层级 | 技术 | 版本/说明 |
|------|------|-----------|
| **后端框架** | NestJS + TypeScript | 模块化、依赖注入架构 |
| **ORM** | Prisma | PostgreSQL 类型安全 ORM |
| **数据库** | PostgreSQL + pgvector | 关系型 + 向量相似度搜索 |
| **缓存** | Redis | 短期记忆、会话缓存 |
| **LLM** | 阿里云通义千问 (DashScope) | qwen-plus 模型 |
| **AI SDK** | Vercel AI SDK | streamText / generateText + tool calling |
| **向量模型** | text-embedding-v1 | 1536 维向量 |
| **地图服务** | 高德地图 Web 服务 API | POI 搜索、逆地理编码 |
| **天气服务** | 和风天气 API | 3 天天气预报 |
| **邮件服务** | Nodemailer + QQ SMTP | 计划推送 |
| **前端框架** | React + TypeScript + Vite | SPA 应用 |
| **UI 组件** | Ant Design 5.x | 企业级组件库 |
| **流式通信** | SSE (Server-Sent Events) | 前端实时展示 |
| **可观测性** | LangSmith | LLM 调用追踪 |

---

## 二、模块一：知识库对话系统

### 2.1 系统架构

```
┌──────────────────────────────────────────────────────────────────┐
│                          前端 (React + Ant Design)                │
│  ┌────────────────┐  ┌──────────────┐  ┌──────────────────┐     │
│  │  对话列表/管理  │  │  聊天界面     │  │  文档上传/知识库   │     │
│  │                │  │  (流式渲染)   │  │  管理界面        │     │
│  └────────────────  └──────────────┘  └──────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
                              │ HTTP / SSE
┌──────────────────────────────────────────────────────────────────┐
│                        后端 (NestJS)                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ ai       │  │knowledge │  │ memory   │  │ embedding│        │
│  │ Module   │  │ Module   │  │ Module   │  │ Module   │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
│  ┌──────────┐  ┌──────────  ┌──────────┐  ┌──────────┐        │
│  │file      │  │langsmith │  │redis     │  │prisma    │        │
│  │Module    │  │Module    │  │Module    │  │Module    │        │
│  └──────────┘  ──────────┘  └──────────┘  └──────────┘        │
└──────────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────────────┐
│                     外部服务 & 数据存储                            │
│  PostgreSQL(pgvector) │ Redis │ DashScope LLM │ LangSmith       │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 核心模块设计

#### 2.2.1 AI 服务模块 (`src/modules/ai/`)

**职责**：协调 RAG 检索、记忆管理、LLM 调用的核心编排模块

**关键文件**：
- [ai.controller.ts](file:///d:/职业/code/cursor/knowledge/backend/src/modules/ai/ai.controller.ts) — SSE 流式响应端点
- [ai.service.ts](file:///d:/职业/code/cursor/knowledge/backend/src/modules/ai/ai.service.ts) — 对话编排逻辑

**核心流程**：
```
用户消息 → addMessage(短期+长期记忆) → getContextForQuery(合并记忆)
    → searchRelevantTraced(RAG 检索，LangSmith 追踪)
    → buildSystemPrompt(系统提示词构建)
    → streamText(LLM 流式生成，LangSmith 追踪)
    → onFinish 写入记忆 → 逐块 SSE 推送前端
```

**流式响应实现**：
```typescript
const result = streamText({ model, system, messages, temperature: 0.7 });
res.setHeader('Content-Type', 'text/event-stream');
for await (const chunk of result.textStream) {
  res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
}
```

**LangSmith 集成**：
- `knowledge-hybrid-search` — RAG 检索 Run 名称
- `knowledge-chat` — LLM 生成 Run 名称
- 通过 `wrapRetriever()` 包装检索器，通过 `getStreamText()` 获取包装后的流式生成函数
- `providerOptions.langsmith` 注入元数据（user_id、conversation_id、knowledge_chunks）

#### 2.2.2 知识库模块 (`src/modules/knowledge/`)

**职责**：文档管理、向量检索、RAG 知识供给

**关键文件**：
- [knowledge.service.ts](file:///d:/职业/code/cursor/knowledge/backend/src/modules/knowledge/knowledge.service.ts)

**RAG 检索算法**：
1. **向量搜索**（主路径）：
   ```sql
   SELECT dv."id", dv."content", kd."filename",
          (dv.embedding <=> ${queryEmbedding}::vector(1536)) AS similarity
   FROM "DocumentVector" dv
   JOIN "KnowledgeDocument" kd ON dv."documentId" = kd."id"
   WHERE kd."userId" = ${userId}
   ORDER BY similarity ASC
   LIMIT ${limit}
   ```
   使用 pgvector 的 `<=>` 运算符计算余弦距离。

2. **全文搜索**（降级路径）：
   向量搜索失败时，回退到 `content LIKE '%query%'` 模糊匹配。

#### 2.2.3 记忆管理模块 (`src/modules/memory/`)

**职责**：双层记忆架构，短期（Redis）+ 长期（PostgreSQL）

**关键文件**：
- [memory.service.ts](file:///d:/职业/code/cursor/knowledge/backend/src/modules/memory/memory.service.ts)

**双层记忆架构**：

| 层级 | 存储 | 数据结构 | 过期策略 |
|------|------|----------|----------|
| **短期记忆** | Redis | 最近消息列表 + 摘要 + token 计数 | TTL = 86400 秒 (24h) |
| **长期记忆** | PostgreSQL | 全部 Message 记录 | 永久保存 |

**Token 管理机制**：
- 阈值：`MAX_TOKENS = 4000`
- 估算公式：`tokens = ceil(text.length / 4)`
- 截断策略：超过阈值时保留最近 10 条消息，生成摘要
- 查询时合并短期 + 长期记忆作为 LLM 上下文

#### 2.2.4 向量化模块 (`src/modules/embedding/`)

**职责**：文本向量化，调用阿里云 text-embedding-v1 模型

**关键文件**：
- [embedding.service.ts](file:///d:/职业/code/cursor/knowledge/backend/src/modules/embedding/embedding.service.ts)

**向量模型配置**：
- 模型：`text-embedding-v1`
- 维度：1536 维
- API：DashScope Embedding API

### 2.3 RAG 完整流程

```
用户上传文档
    ↓
文档解析 → 分块 (Chunking)
    ↓
每块向量化 → 存入 DocumentVector 表 (pgvector)
    ↓
用户发起对话
    ↓
Query 向量化 → 余弦相似度搜索 → 返回 Top-K 相关块
    ↓
LLM System Prompt 拼接：[上下文记忆] + [检索到的知识块]
    ↓
流式生成回答 → SSE 推送前端
```

### 2.4 数据模型

```prisma
KnowledgeDocument    // 知识文档 (id, userId, filename, content, embedding)
DocumentVector       // 文档分块向量 (id, documentId, chunkIndex, content, embedding vector)
Conversation         // 对话会话 (id, userId, title)
Message              // 对话消息 (id, conversationId, role, content, createdAt)
```

---

## 三、模块二：溜娃助手

### 3.1 系统架构

```
┌──────────────────────────────────────────────────────────────────┐
│                      前端 (React + Ant Design)                    │
│  ┌────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │
│  │  任务输入区     │  │  执行过程可视化   │  │  结果展示区      │ │
│  │  (定位+年龄)    │  │  (思考过程/SSE)  │  │  (景点/天气/邮件)│ │
│  └────────────────┘  └──────────────────┘  └──────────────────┘ │
──────────────────────────────────────────────────────────────────┘
                              │ HTTP / SSE
┌──────────────────────────────────────────────────────────────────┐
│                        后端 (NestJS)                              │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │                    BabyTripAgent (主控智能体)                 ││
│  │  意图识别 → 任务分解 → 工具路由 → 结果整合 → 方案生成          ││
│  └──────────────────────────────────────────────────────────────┘│
│           │              │              │           │             │
│  ┌──────────┐    ┌──────────┐   ┌──────────┐ ┌──────────       │
│  │Weather   │    │ Spots    │   │ Email    │ │ Trace    │       │
│  │Service   │    │ Service  │   │ Service  │ │ Service  │       │
│  │(和风天气) │    │(高德地图) │   │(QQ SMTP) │ │(SSE追踪) │       │
│  └──────────┘    └──────────┘   └──────────┘ └──────────       │
│  ┌──────────┐                                                   │
│  │LangSmith │  ← 通过 getGenerateText() 包装 LLM 调用            │
│  │Module    │                                                   │
│  └──────────┘                                                   │
└──────────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────────────┐
│                     外部服务集成层                                │
│  高德地图 POI API │ 和风天气 3 天预报 │ QQ 邮箱 SMTP │ DashScope LLM│
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 架构设计：单智能体 + 工具调用模式

**设计决策**：采用 **单智能体 (Coordinator Agent) + 专业 Tool** 架构，而非多智能体。

**原因**：
- 各功能（天气/景点/邮件）是强关联的流水线任务，而非独立决策
- 开发成本低，适合 MVP 快速上线
- 为未来升级到多 Agent 预留接口

**智能体工作流**：
```
用户输入 → 意图分析 → 参数解析(距离/票价/周末关键词)
    → 天气查询 Tool → 景点搜索 Tool → 过滤 Tool
    → 历史查询 Tool → 方案生成 (LLM generateText)
    → 邮件发送 Tool (可选)
    → 结果整合 → 返回前端
```

### 3.3 核心模块设计

#### 3.3.1 智能体核心模块 (`src/modules/baby-trip/`)

**关键文件**：
- [baby-trip.controller.ts](file:///d:/职业/code/cursor/knowledge/backend/src/modules/baby-trip/baby-trip.controller.ts)
- [baby-trip.service.ts](file:///d:/职业/code/cursor/knowledge/backend/src/modules/baby-trip/baby-trip.service.ts)
- [baby-trip.types.ts](file:///d:/职业/code/cursor/knowledge/backend/src/modules/baby-trip/baby-trip.types.ts)

**核心方法 `execute()` 流程**：

1. **参数解析**：
   ```typescript
   // 从用户消息中自动提取
   const distMatch = msg.match(/(\d+)\s*km/);     // "5km" → 5000m
   const priceMatch = msg.match(/票价\s*(\d+)\s*元/); // "票价100元" → 100
   const isWeekendQuery = /周末|星期六|星期日|周六|周日|双休/.test(msg);
   ```

2. **定位坐标**：
   - 优先使用前端浏览器 Geolocation API 获取的经纬度
   - 降级使用 `.env` 中配置的 `DEFAULT_LATITUDE/DEFAULT_LONGITUDE`

3. **工具链执行**（按步骤）：
   - Step 0: 意图分析
   - Step 1: 天气查询（今天 或 本周末两天）
   - Step 2: 景点搜索（高德地图 POI）
   - Step 3: 票价过滤（根据用户指定上限）
   - Step 4: 历史记录查询（已玩过的景点标记）
   - Step 5: 方案生成（LLM）
   - Step 6: 邮件发送（可选）

4. **全程追踪**：
   - 每个步骤记录到 `reasoningSteps`（思考过程）
   - 每个工具调用记录到 `toolCalls`（参数/结果/耗时/重试）
   - 最终输出存入 `BabyTripTrace` 表

#### 3.3.2 天气服务 (`src/modules/weather/`)

**关键文件**：
- [weather.service.ts](file:///d:/职业/code/cursor/knowledge/backend/src/modules/weather/weather.service.ts)

**API 集成**：和风天气 `/weather/3d` 3 天预报

**两种查询模式**：
- `getWeather(lat, lng)` — 查询当天天气
- `getWeekendWeather(lat, lng)` — 查询本周六/周日天气（自动计算日期）

**返回数据结构**：
```typescript
interface WeatherData {
  weather: string;     // 天气状况
  temp: string;        // 温度范围 (如 "18-25")
  dayOfWeek: string;   // 星期几
  tips: string;        // 出行建议
  suitableForKids: boolean;
}
```

#### 3.3.3 景点服务 (`src/modules/spots/`)

**关键文件**：
- [spots.service.ts](file:///d:/职业/code/cursor/knowledge/backend/src/modules/spots/spots.service.ts)

**API 集成**：高德地图 `/place/around` 周边搜索

**搜索策略**：
1. 调用高德 POI 搜索，类型：`风景名胜|公园|动物园|游乐园|博物馆`
2. 按距离排序
3. 过滤适合儿童年龄的场所
4. 提取名称、地址、经纬度、分类信息

**儿童年龄适配**：
- 0-3 岁：公园、植物园
- 3-6 岁：动物园、游乐园、儿童公园
- 6-12 岁：博物馆、科技馆、主题乐园

#### 3.3.4 邮件服务 (`src/modules/email/`)

**关键文件**：
- [email.service.ts](file:///d:/职业/code/cursor/knowledge/backend/src/modules/email/email.service.ts)

**技术**：Nodemailer + QQ SMTP

**功能**：
- HTML 邮件模板（景点卡片 + 天气 + 费用明细）
- 纯文本备用版本
- 发送日志记录到 `EmailLog` 表

#### 3.3.5 过程追踪模块

**核心机制**：SSE (Server-Sent Events) 实时推送

**前端 SSE 端点**：`GET /baby-trip/trace/stream/:taskId`

**推送事件类型**：
```typescript
type TraceEvent =
  | { type: 'trace_update', data: trace }  // 追踪数据更新
  | { type: 'waiting' }                     // 等待中
  | { type: 'complete' }                    // 任务完成
```

**追踪数据结构**：
```typescript
interface BabyTripTrace {
  taskId: string;
  reasoningSteps: ReasoningStep[];  // 思考过程
  toolCalls: ToolCallRecord[];       // 工具调用记录
  finalOutput: string;               // 最终结果
  totalDuration: number;             // 总耗时 (ms)
  tokenUsage: { input, output };     // Token 消耗
}
```

### 3.4 LangSmith 可观测性

**集成方式**：
- `LangSmithService` 通过 `wrapAISDK` 包装 Vercel AI SDK
- 同时包装 `streamText` 和 `generateText`
- BabyTrip 的 `generatePlan` 方法使用 `langSmith.getGenerateText()` 获取包装后的函数

**追踪名称**：
- `baby-trip-planner` — 溜娃计划生成
- Tags: `baby-trip`, `qwen-plus`

### 3.5 前端可视化

**关键文件**：
- [BabyTripPanel.tsx](file:///d:/职业/code/cursor/knowledge/frontend/src/components/BabyTripPanel.tsx)

**功能特性**：
1. **定位功能**：浏览器 Geolocation API + 高德逆地理编码 → 自动获取城市
2. **任务输入**：支持自然语言输入（距离、票价、年龄等参数自动解析）
3. **思考过程展示**：实时渲染 `reasoningSteps`（意图分析 → 工具选择 → 结果整合）
4. **工具调用日志**：展示每个工具的参数、结果、耗时、重试记录
5. **景点导航**：点击景点名称或"导航"按钮 → 跳转高德地图导航页面
6. **天气展示**：区分单日天气和周末双日天气
7. **游玩标记**：标记已玩过的景点，存储到数据库

### 3.6 数据模型

```prisma
BabyTripTask      // 溜娃任务 (id, userId, title, status, createdAt)
BabyTripTrace     // 执行追踪 (taskId, reasoningSteps[], toolCalls[], finalOutput)
Spot              // 景点记录 (id, userId, name, lat, lng, category, visitedAt)
EmailLog          // 邮件日志 (id, userId, taskId, to, subject, status)
```

### 3.7 API 接口

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/baby-trip/execute` | 执行溜娃任务（核心入口） |
| GET | `/baby-trip/weather/weekend` | 查询周末天气 |
| GET | `/baby-trip/trace/stream/:taskId` | SSE 实时追踪 |
| GET | `/baby-trip/tasks` | 获取任务列表 |
| GET | `/baby-trip/trace/:taskId` | 获取追踪记录 |
| POST | `/baby-trip/visited` | 标记游玩记录 |
| GET | `/baby-trip/visited` | 获取游玩历史 |

---

## 四、系统对比与协同

| 维度 | 知识库对话系统 | 溜娃助手 |
|------|----------------|----------|
| **架构模式** | RAG + 流式对话 | 单智能体 + 工具调用 |
| **LLM 调用方式** | streamText（流式） | generateText（非流式） |
| **记忆机制** | Redis + PostgreSQL 双层 | BabyTripTrace 结构化记录 |
| **外部服务** | DashScope Embedding | 高德地图 + 和风天气 + QQ SMTP |
| **实时通信** | SSE（流式文本推送） | SSE（执行过程追踪推送） |
| **可观测性** | LangSmith（knowledge-chat） | LangSmith（baby-trip-planner） |
| **前端交互** | 对话气泡 + Markdown 渲染 | 任务面板 + 可视化追踪 |

---

## 五、快速开始

### 5.1 安装依赖

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 5.2 启动基础设施

```bash
docker-compose up -d   # PostgreSQL + Redis
```

### 5.3 数据库迁移

```bash
cd backend
npx prisma migrate dev
npx prisma generate
```

### 5.4 环境变量配置

编辑 `backend/.env`，关键配置项：

```env
# 数据库
DATABASE_URL=postgresql://postgres:password@localhost:5432/knowledge

# LLM
DASHSCOPE_API_KEY=sk-xxx

# 地图 & 天气
AMAP_API_KEY=xxx
QWEATHER_API_KEY=xxx

# 邮件
EMAIL_SMTP_HOST=smtp.qq.com
EMAIL_SMTP_USER=your-qq@qq.com
EMAIL_SMTP_PASS=授权码

# LangSmith（可选）
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_pt_xxx
LANGSMITH_PROJECT=knowledge-base

# 默认位置
DEFAULT_LATITUDE=39.9042
DEFAULT_LONGITUDE=116.4074
DEFAULT_CHILD_AGE=5
```

### 5.5 启动服务

```bash
# 后端 (端口 3000)
cd backend && npm run start:dev

# 前端 (端口 3001)
cd frontend && npm start
```

---

## 六、项目结构

```
knowledge/
├── backend/
│   ├── src/
│   │   ├── modules/
│   │   │   ├── ai/               # AI 对话核心 (RAG + 流式响应)
│   │   │   ├── knowledge/        # 知识库管理 (文档 CRUD + 向量检索)
│   │   │   ├── memory/           # 双层记忆 (Redis 短期 + PG 长期)
│   │   │   ├── embedding/        # 向量化 (DashScope text-embedding)
│   │   │   ├── file/             # 文件上传处理
│   │   │   ├── conversation/     # 对话会话管理
│   │   │   ├── langsmith/        # LangSmith 追踪集成
│   │   │   ├── redis/            # Redis 服务
│   │   │   ├── prisma/           # Prisma 服务
│   │   │   ├── baby-trip/        # 溜娃助手主控模块
│   │   │   ├── weather/          # 和风天气服务
│   │   │   ├── spots/            # 高德地图景点服务
│   │   │   ├── email/            # QQ 邮件服务
│   │   │   └── source-connector/ # 有道云笔记同步
│   │   └── main.ts
│   └── prisma/schema.prisma      # 数据库模型
├── frontend/
│   ── src/
│       ├── components/
│       │   ├── ChatPanel.tsx     # 对话面板
│       │   ├── BabyTripPanel.tsx # 溜娃助手面板
│       │   ── KnowledgePanel.tsx# 知识库面板
│       ├── services/             # API 调用封装
│       └── App.tsx               # 主应用入口
├── docker-compose.yml
└── README.md
```

---

## 七、常见问题

### 7.1 LangSmith 没有追踪到溜娃助手
确保：
1. `LANGSMITH_TRACING=true` 且 `LANGSMITH_API_KEY` 已配置
2. 后端已重启（开发模式自动重载）
3. 在 LangSmith 控制台查找 `baby-trip-planner` Run 名称

### 7.2 景点导航打不开
确保：
1. 浏览器已授予定位权限
2. 景点数据包含有效的 `lat/lng` 坐标
3. 高德地图 API Key 有效

### 7.3 邮件发送失败
确保：
1. QQ 邮箱已开启 SMTP/IMAP 服务
2. `EMAIL_SMTP_PASS` 使用的是 **授权码**（非登录密码）
3. SMTP 端口 465，SSL 加密

---

## 八、开发指南

### 添加新的 Tool

1. 在 `src/modules/` 下创建服务模块（如 `weather/`）
2. 实现业务逻辑方法
3. 在 `BabyTripService` 中注入并调用
4. 在 `toolCalls` 中记录调用过程
5. 前端在 `BabyTripPanel.tsx` 中展示结果

### 扩展 LangSmith 追踪

1. 在 `ai-sdk.tracing.ts` 中添加新的包装函数
2. 在 `langsmith.service.ts` 中暴露 getter
3. 在目标服务中通过 `langSmith.getXxx()` 获取包装后的函数
4. 添加 `providerOptions.langsmith` 配置

---

MIT License
