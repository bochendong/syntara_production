# 旧聊天退役记录

> 历史验收快照：下文的未提交状态、测试账号和部署号描述当时的验收。当前整合范围见 [测试分支整合清单](./native-staging-release.md)。

2026-10-22，来源工作区 `codex/native-home-restore`；现已逐文件整合到 `codex/native-google-staging`，均未暂存、未提交。测试环境部署与实际对话证据见 [整合记录](./native-navigation-integration.md)。

## 删除范围

- 删除旧 Web `/chat` 页面及其私有记忆包装页、`ChatPageClient`、专用输入框、消息线程和 hooks 等 22 个文件。
- 删除另两个已无引用的旧聊天模块，共删除 24 个 Web 文件。记忆、课堂、题库仍使用的共享类型和组件保留。
- 删除旧原生 `/api/native/v1/turn`、无人调用的 `/api/native/v1/review-plans` 和仅服务于这两个接口的 `teaching-turn.ts`，共 3 个服务端文件。
- 删除旧 `streamAssistantReply`、`runNativeTeachingTurn`、`stream_ai_response`、`native_teaching_turn`、`native_create_review_plan` 以及对应请求类型和 Rust 注册。
- 删除未被调用的旧 `/chat` 深链生成函数和指向已删模块的导出、通知来源记录。

未删除会话数据库或日程、作答、历史消息。历史计划卡片的渲染保留。`/api/chat` 是现行 Web Learn 的回答接口，与已删除的 Web `/chat` 页面不是同一对象。

## 当前聊天链路

`CourseWorkspace → streamNativeChat → runNativeChatTurn → native_chat → /api/native/v2/chat`。

原生能力声明和客户端检查改为 `capabilities.chat`，返回 SSE 地址 `/api/native/v2/chat`，不再声明旧 `teachingTurn`、`reviewPlan`。**测试分支整合时必须同步更新客户端检查和服务端 capability handler**；仅更新客户端会使旧 capability 响应无法启用聊天。来源任务阶段没有改写测试后端或安装包；后续整合已同时更新测试包与 staging 后端，没有复制整个共享工作区。

## 复习计划到底由谁调用

1. **新版 App 不调用旧复习计划接口。** `createNativeReviewPlan` 只有定义/导出，没有 UI 调用；旧 `/review-plans` 仅自己转调旧教学回合。这条无调用链已删除。不能把“接口存在”说成“有人在用”。
2. **原生内置 MAT136 示例确有计划卡片。** `apps/native/src/data/seed.ts` 的 `message-mat136-review-plan-assistant-local` 带有 `provider: bundled-mock` 和 `reviewPlan: NATIVE_MAT136_REVIEW_PLAN`。这是示范消息和历史展示，并非新版 AI 正在调用旧接口。
3. **Web 学习页另有真实调用。** `components/learn/learn-page-client.tsx` 的 `buildEvidenceBasedPlan` 调用 `requestTeachingReviewPlan`，后者请求 `/api/teaching/review-plan`；另有 `review_plan` 学习操作通过现行课程助理处理。它们不依赖此次删除的原生 v1 入口，本次未退役这套 Web 产品功能。

以上是静态调用和示例数据证据，没有查询生产用户使用日志，也不推断历史代码由哪位作者添加。

## 检查结果

- 本地 Next.js 实际 HTTP：`/chat`、`/chat/private-memory`、POST `/api/native/v1/turn`、POST `/api/native/v1/review-plans` 均为 404。
- 本地真实能力接口返回 503 `auth_not_configured`：此独立工作区没有配置 PostgreSQL/登录，未连接真实服务。
- `verify-retired-chat.mjs` 直接运行能力 handler 的隔离测试：有/无模型配置、v2 SSE 声明、删除旧能力、未授权 401 均通过；没有加载环境、数据库或 AI。
- 原生访问契约、原生构建、原生/QA 与根 TypeScript、定向 ESLint/Prettier、Rust 离线编译与格式检查通过。
- 已有原生快照校验失败仍属上轮记录，本轮未修改快照或运行数据迁移。

删除前的工作区文件和完整清单保存在 Git 公共元数据 `codex/tasks/native-home-restore/retired-chat/`，可用于恢复和核对归属。此次改动已进入测试环境分支的未提交工作区；测试后端部署 `fdb48275-c2f3-4070-a524-ab69ab07693f` 已成功，原生实际 v2 对话收到回答，HTTP 日志为 200。

验收截图保留在本地工作区和安装包 evidence 目录，未随源码上传 GitHub。
