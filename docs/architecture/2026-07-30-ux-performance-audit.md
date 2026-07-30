# Syntara 用户体验与数据加载架构审计

日期：2026-07-30

## 结论

当前最主要的问题不是“缺少一个更漂亮的加载页”，而是：

1. 页面把本来可以合并、延后或不读取的数据同时拉取。
2. 一些读路径会顺便补数据、建索引或写初始化记录。
3. AI 回答原来在客户端和服务端重复构建上下文；本轮已取消浏览器端的弃用预加载，并为普通讲解建立单模型快速路径，但完整工作流仍需继续收敛。
4. 会话持久化原来反复保存长消息快照，数据量随对话长度呈平方增长；本轮已改为只提交变化消息和删除墓碑的 patch 协议。
5. 本地开发连接到远程 Railway proxy，当前每个 Prisma client pool 被限制为 1 条连接；并发请求因此更容易排队，并将后端问题放大成页面卡顿。

正确的优化顺序应当是：

> 取消不需要的读取 → 缩小行与字段 → 批量读取 → 按版本缓存 → 将长任务异步化 → 最后才用骨架屏或进度页管理不可避免的等待。

加载界面只能解释等待，不能代替数据架构优化。

## 审计方法与限制

本次审计使用了四类证据：

- 逐条追踪课程、笔记本、AI、记忆、上传、复习计划和日历的客户端与服务端调用链。
- 在已登录的本地页面实际观察首屏状态、请求日志和可见结果。
- 对当前数据库中的课程与笔记本计数做只读一致性检查。
- 检查现有 `.next` 构建快照、静态资源和已加载页面资产。

本次样本是一个已登录开发账号和远程开发数据库，不等同于生产压测。远程数据库延迟、开发编译和 `connection_limit=1` 会放大绝对耗时；请求扇出、重复读取和负载大小仍然是有效的结构性证据。

当前截图保存在：

- `tmp/performance-audit/01-my-courses-loaded.png`
- `tmp/performance-audit/02-my-courses-after.png`
- `tmp/performance-audit/05-learn-resource-popup-metadata.png`
- `tmp/performance-audit/06-learn-source-detail-on-click.png`
- `tmp/performance-audit/07-learn-source-text-detail.png`

视觉检查确认课程卡片、计数、导航、资料库目录、封面和正文视图在优化后保持可用。截图只能覆盖可见桌面状态；键盘路径、读屏语义和弱网行为仍需单独做可访问性与网络节流测试。

## 1. “我的课程”首屏

### 优化前

当前账号有 9 门课程时，业务数据至少发出：

- 1 次 `GET /api/courses`
- 9 次 `GET /api/notebooks?courseId=...`
- 1 次全局 `GET /api/gamification/summary`

也就是 10 次课程内容请求，再叠加一个很重的全局账户请求。页面必须等待 9 门课程的笔记本列表全部完成后，才能得到卡片上的笔记本数量。

实测日志中：

- `/api/courses` 曾耗时约 9.9 秒。
- 单门课程的笔记本列表约 4.5–10.4 秒。
- 全量游戏化汇总曾耗时 78 秒，并与其他请求争用数据库连接。

这不是封面图片造成的。首要原因是按课程做 N 次列表读取，以及全局侧栏为了显示等级和三种余额而读取完整任务、角色、奖励、库存和提示信息。

### 第一批改动后

首屏业务读取改为：

- 1 次 `GET /api/courses`，直接返回课程表中的 `notebookCount`。
- 1 次非阻塞的 `GET /api/gamification/rail-summary`，只读取等级和三种余额。

课程列表不再加载任何笔记本列表或笔记本内容。为了让汇总字段可以长期可信，数据库迁移会：

- 一次性回填历史 `Course.notebookCount`。
- 在 `Notebook` 插入、删除或移动课程后，由数据库触发器增减计数。

初次审计时，`20260730010000_repair_course_notebook_counts` 尚未应用，且有 1 门课程的
汇总计数与实际笔记本数量不一致。后续复核确认：该迁移已于
`2026-07-30 04:44:40 UTC` 在远端开发库完成，数据库迁移记录与本地 SQL 的 SHA-256
均为 `85d7c68642780ae3cacf4845fc086d1f6b4f7cf4dbc388496d41485a618fb6c2`。
全库不一致课程数已经为 0，触发器的插入/删除事务探针也通过。

该一致性仍是发布门禁。部署前运行 `pnpm db:verify:course-notebook-counts`；命令会检查迁移
记录、触发器、全库 parity，并在最终回滚的事务中验证一次真实的 Notebook 插入/删除。
任意检查失败都会非零退出，不能只依据迁移命令的成功输出判断。

运行时的 `refreshCourseSummaryFields` 也不再覆盖 `notebookCount`，避免一个较早的聚合结果
覆盖并发触发器增量；数据库触发器现在是该字段的唯一运行时写者。这样即使维护脚本绕开
应用 repository，课程列表也不会重新漂移。

### 资源判断

课程列表真正需要的只有：

- 课程 ID、名称、简介、标签、头像/背景引用。
- 创建者与访问角色。
- 笔记本、题目等已维护的汇总计数。

不需要：

- 笔记本行。
- 场景、Markdown 正文、题目正文。
- 笔记本封面 slide JSON。
- 完整游戏化任务、角色和库存。

现有 `.next` 构建快照中，`/my-courses` 路由 JavaScript 约为 1.586 MiB raw / 412 KiB Brotli。后续还应把 KaTeX、Streamdown 和只在 AI/课堂使用的组件从根布局或课程列表依赖中拆出。

## 2. 单门课程工作区

### 现状

优化前，页面共有 6 次主要内容请求：

1. 课程详情。
2. 笔记本列表。
3. 可移动到的课程列表。
4. 课程题库摘要。
5. 每个笔记本的记忆数量。
6. 所有笔记本的首张 slide。

前两次原来串行执行；其余数据虽然是后台读取，但首张 slide 会覆盖整门课的所有笔记本。当前所有者路径的 SQL 下限会随笔记本数量增长，约为 `N + 14`；加入课程和旧副本路径还会更多。

### 第一批改动后

- 课程详情和笔记本元数据列表并行读取。
- 笔记本列表仍然只返回元数据，不返回 scenes 或 Markdown 正文。
- 首张 slide 只在“笔记本”标签可见时读取。
- 每次只请求当前分页可见的最多 6 个非 Markdown 笔记本。
- 没有封面的笔记本在本次页面会话中会记录为已尝试，避免因 React 重渲染反复查询。
- 封面鉴权和记忆计数鉴权从“每个笔记本单独查”改为按课程批量检查。

### 下一目标

仍建议增加一个课程工作区聚合契约：

```text
GET /api/courses/:courseId/workspace?notebookLimit=6&cursor=...
```

首包只返回：

- 课程展示字段。
- 第一页笔记本元数据。
- 每个笔记本的轻量计数。
- 下一页 cursor。
- `contentVersion` / ETag。

不返回：

- 题目正文或答案。
- 记忆正文。
- slide 内容。
- 全部同学模拟数据。
- 其他课程列表。

“移动笔记本”的目标课程应在用户打开编辑菜单时再读取。题库统计和记忆计数可在首屏稳定后用同一个聚合请求或服务端批量查询补齐。

当前题库摘要在实际课程中约为 74–146 KiB（227–417 题）。课程首页只需要聚合数字和少量薄弱主题，不应下载每一道题的客户端摘要。

## 3. 课程页资料库弹窗、封面与课堂

### 实际产品入口

产品已经没有独立的“笔记本页面”。当前主路径是：

```text
/learn 课程页
  -> 右侧“资料库”
  -> “原始讲义库”弹窗
  -> 点击具体讲义或笔记本
  -> 弹窗内显示封面 / 正文
```

课堂路由仍然存在，但它只承担图片讲义播放，不应被当作资料库主入口。

打开资料库弹窗后，当前只发出两类目录读取：

1. `GET /api/notebooks?courseId=...`：补充没有来源文件的独立笔记本。
2. `GET /api/courses/:courseId/source-uploads?includeText=0&includeArtifacts=0`：读取原始讲义目录元数据。

网格卡片刻意不请求真实封面图片，而使用轻量的文件/笔记本卡面。列表不读取 Markdown 正文、scene、题目正文或二进制封面；真实封面只在用户打开具体项目后的详情视图使用。

当前 notebook repository 的列表投影也已经不包含：

- `Scene`
- `MarkdownNotebookSection.markdown`
- `coverSlideJson`

它只返回名称、描述、标签、类型、汇总计数、`coverImagePath` 和版本等元数据。因此“弹窗先加载名称和基本信息，点击后加载内容”是正确方向。

### 本次点击加载改造

原先弹窗打开时会把所有来源的 `textSections` 一起加载。现在目录请求固定使用 `includeText=0`；点击具体讲义后才请求：

```text
GET /api/courses/:courseId/source-uploads/:sourceHash
```

这个详情接口用单条 SQL 同时完成访问范围约束与指定讲义段落读取，不再先后查询课程、来源目录和正文。当前 MAT102 样本返回 8 段、约 13.5 KiB；远程开发数据库的单独请求约 1.74 秒。弹窗会立即显示局部读取状态，成功后提供“文本 / 图片”切换，失败时提供“重试读取”。

还修复了一个竞态：来源目录尚未完成时，用户可能先点到临时的 notebook 卡片；当来源元数据回来并把它替换为 source 卡片时，现在会把选中状态迁移到新卡片，不会把用户突然送回列表。

当前 MAT102 详情封面是约 377 KiB 的 PNG。它已经不会在目录网格加载，但仍高于建议的 150–250 KiB 卡片/详情预览预算；后续应生成独立 WebP/AVIF 预览，原始 PNG 只在用户放大或下载时读取。

### 推荐的数据层次

后续把讲义/笔记本内容继续拆成：

```text
Notebook
  元数据、计数、coverImagePath、contentVersion

NotebookPage
  页面 ID、标题、顺序、thumbnailRef、contentHash

NotebookPageContent
  大体积 slide/markdown 内容；用户打开笔记本或翻到该页时读取
```

不要把封面二进制或整张 slide JSON 放回目录响应。封面应是单独的、可 CDN 缓存的 AVIF/WebP 缩略图，并带固定尺寸，避免布局跳动。

### 课堂

课堂页原来会先获取一次完整笔记本作为“元数据”，随后 `loadFromStorage` 再获取一次完整笔记本。现在已经把 `sourceNotebookId` 放入正常的 Stage 元数据，课堂只需要一次完整加载。

下一步应把完整笔记本再拆成：

1. notebook shell + page index。
2. 当前页内容。
3. 前后各一页预取。
4. 历史聊天 cursor 分页。

这样 100 页笔记本和 5 页笔记本的首屏成本可以接近一致。

## 4. AI 回答、记忆、聊天与题库

当前最大的后端性能债务在 AI 上下文编排，而不是页面图片。

| 流程 | 当前估算 | 主要问题 | 目标 |
| --- | ---: | --- | --- |
| `/learn` 普通高置信讲解 | 优化前 4 次、第一步后 3 次、本轮静态链路为 1 次主模型；DB 仍高于目标 | 浏览器端弃用预加载已移除，普通讲解不再调用语义路由和记忆检索规划模型；分层记忆仍有独立访问检查 | 1 次统一上下文组装，1 次主模型；DB 4–8 次 |
| `/learn` 计划/日历/练习/课堂等工作流 | 保留语义规划，再进入回答或工具执行 | 这些请求不能误走普通讲解快速路径；仍需把 planner handoff 和 answerer 收敛为明确的服务端用例 | 1 次必要规划 + 1 次回答或确定性工具 |
| 笔记本回答 | 约 2 次模型，15–30+ 次 DB | 笔记本、聊天、记忆和知识检索分别鉴权和读取 | 4–8 次有界 SQL，按版本和 cursor 读取 |
| 查看用户记忆 | 约 2 次模型，15–30+ 次 DB | “读取”路径会触发懒索引、缓存写和调试上下文返回 | 纯读；索引与摘要由异步任务更新 |
| 复习计划 | 正常约 3–4 次 DB；按概念约 6–8 次 | 相对健康，但投影仍可缩小 | 读取 LearnerCourseState + 题目候选薄投影 |
| 对话持久化 | 当前 patch 最多 120 条变化消息或 120 个墓碑；详情用 121 条 lookahead | 已消除每轮整段覆盖；底层通用 Conversation 表仍缺少课程会话专用索引与显式顺序字段 | 每条 Message 幂等写入，cursor 读取最近 20–30 条 + 摘要 |

### 本轮 AI 链路改造

- 浏览器不再调用一次 `buildCourseChatContext` 和一次 `/api/memory/context`，然后把会被服务端丢弃的上下文发送给回答器。
- 普通、明确的解释题使用确定性分类和确定性记忆检索意图：`/api/learn/turn` 不调用模型，记忆检索规划不调用模型，只保留一次流式回答模型。
- 制定计划、写日历、从题库出题、生成课堂、查看/写入学习记忆和短确认等请求仍进入语义规划，避免快速路径误执行或漏确认。
- `/api/chat` 只解析一次课程和访问角色，并把该可信结果复用于来源资料读取；静态链路上减少了约 3 次重复的 Course/访问查询。
- 回答器收到由服务端根据真实证据构造的 `answererHandoff`，其中明确包含必做行为、禁止行为、资源状态和缺少原始资料时的提示。
- learn-core 的专用回答约束通过 10 分钟、绑定用户/课程/原问题摘要的 HMAC 信封传递；`/api/chat` 验签后只合并 planner 的行为约束，证据和资源状态仍以当前服务端检索为准。无可用签名 secret 时安全退化到通用 handoff，不影响回答。
- 英文 review plan、错题/薄弱点审计和证明题已从普通讲解快速路径排除，避免为了省一次模型调用而绕过计划 artifact 或证明质量约束。
- 公共 `/api/v1/courses/:id/questions` 也复用同一份可信 access，不再分别在 context、source 和 trusted turn 中重复整套课程鉴权。

这一步已经把“普通解释”降到理想的单模型形态，但还不能把所有问答笼统宣称为 4–8 次 SQL：分层记忆仍可能再次解析目标访问范围，且计划类流程仍是独立的 planner + answerer。下一步应把这些读取收进同一个 `CourseAnswerTurn` 请求上下文和 trace 后，再以运行时计数作为性能门禁。

### 课程左栏会话与删除

优化前，URL 参数、随机草稿 ID、点击意图 key、本地缓存和远端 revision 都可能决定“当前会话”。这会导致直接打开会话 URL 或浏览器前进/后退不加载、切换会话时草稿或附件串线、删除当前会话后消息和 URL 不一致，以及较晚返回的首屏列表把刚创建的会话覆盖掉。

本轮已将行为收敛为：

- URL 的 `session` 是当前会话的唯一身份；没有 session 时立即生成草稿 ID 并用 `replace` 写入规范 URL。
- 点击会话和新建会话都先改变 URL，详情读取只监听 `(courseId, urlSessionId)`，因此直接链接与前进/后退使用同一条路径。
- 左栏首屏只请求 5 条会话元数据，不带消息正文；点击后才读取该会话的有界详情窗口。
- 文本草稿按 `user/course/session` 存入 `sessionStorage`；附件按 session 隔离在当前标签页内存中，切换会话不会串线。
- 当前消息为空但已有未发送草稿或附件时，“新对话”会保留旧草稿并创建新 URL；只有消息、草稿、附件都为空时才复用当前空白会话。
- 同步协议只提交变化过的消息和显式删除墓碑，不再用不完整的最近窗口覆盖服务器历史；部分窗口不会推断“未出现的旧消息已删除”。
- 单条消息删除使用服务端 soft tombstone：正文和附件元数据被清空，但 ID 保留为删除标记。新标签或旧设备重新提交同一 ID 时会被拒绝并收到删除确认，因此旧 localStorage 不会把消息复活。
- 删除先显示确认框，随后只乐观移除目标会话。删除当前会话会立即 `replace` 到安全的新草稿；服务端失败则撤销墓碑并恢复列表。
- 较晚到达的云端列表会与“响应到达时”的本地最新索引合并，不再使用请求发起时的旧快照。
- 云端列表失败时保留本机记录，并在左栏显示错误与重试；未知总数使用 `5+`，不再把已加载数量伪装成精确总数。

浏览器回归已验证：点击两条已有会话会改变 URL，浏览器返回/前进可恢复对应会话；草稿不会出现在另一会话，直接打开原 session URL 又会恢复；删除确认框可取消且无副作用，确认删除当前空白会话后会立即切换到安全会话。测试期间远端开发数据库发生超时，左栏仍显示本机会话、明确的“重新加载”和本地保存提示，没有阻塞课程正文和输入框。

当前 P0 已经消除了最危险的状态竞争，但 `learn-page-client.tsx` 仍承担过多职责。下一阶段应把会话 reducer、缓存、远端协议和 UI 控制器移入独立的 `features/learn-conversations` 模块，并在数据库中新增课程会话专用实体，而不是继续依赖通用 `Conversation.meta`：

```text
CourseConversation(
  id,
  ownerId,
  courseId,
  title,
  revision,
  lastMessageAt,
  messageCount,
  deletedAt
)

CourseConversationMessage(
  id,
  conversationId,
  sequence,
  role,
  content,
  createdAt,
  deletedAt
)
```

核心索引应为 `(ownerId, courseId, deletedAt, lastMessageAt DESC, id DESC)`，消息使用 `(conversationId, sequence)` 唯一约束。由于产品尚未上线，可以直接迁移并删除旧的兼容分支。

### 目标调用边界

建议把课程问答统一成一个服务端用例：

```text
CourseAnswerTurn
  1. resolve access once
  2. read conversation window once
  3. read LearnerCourseState once
  4. retrieve top-k notebook / memory / problem evidence in parallel
  5. make one teaching decision
  6. stream one answer
  7. persist message + mastery delta in one transaction
  8. enqueue indexing / summary refresh after commit
```

客户端只发送：

- `courseId`
- 可选 `notebookId`
- `conversationId`
- 用户消息
- 明确开启的工具能力

浏览器端重复上下文已经移除；剩余目标是让 planner、回答器和工具执行共享同一个服务端 `CourseAnswerTurn`，而不是只在 `/api/chat` 内局部复用访问结果。

### 建议数据结构

```text
Conversation(id, userId, courseId, notebookId?, lastMessageAt, summaryVersion)
Message(id, conversationId, role, content, createdAt, idempotencyKey)
ConversationSummary(conversationId, throughMessageId, summary, version)

LearnerCourseState(
  userId,
  courseId,
  masteryJson,
  weaknessJson,
  nextTeachingMoveJson,
  version,
  updatedAt
)

MemoryFact(
  ownerId,
  scopeType,
  scopeId,
  kind,
  key,
  valueJson,
  confidence,
  evidenceRefs,
  status,
  updatedAt
)
```

记忆读路径必须是纯读。embedding、chunk、知识缓存、对话摘要和 mastery 合并通过 outbox/job 在写入后异步更新；不要在用户等回答时执行运行时 DDL、全量回填或大批索引写入。

## 5. 上传、回复问题、复习计划与日历

### 上传笔记本/资料

当前上传允许每个文件约 50 MiB、最多约 220,000 字符；客户端最多串行上传 3 个文件。服务端 route 内同步完成解析、模型处理、笔记本生成、记忆和知识投影，route 上限约 300 秒，而客户端等待可达 12 分钟。

此外，当前“课程资料”面板的一部分只是浏览器 IndexedDB 文件柜，并不等于服务端已经保存和建立索引；来源记录虽然包含 `storageKey`，原始文件也没有进入正式对象存储。封面依赖本机实例路径，索引工作使用请求后的非持久化回调，因此实例重启、部署切换或任务失败后缺少可靠恢复边界。

应改为：

```text
UploadSession
  -> object/blob storage
  -> IngestJob
  -> durable worker
  -> staged artifacts
  -> transactional publish
  -> outbox events
```

API 在文件落盘并创建任务后立即返回 `202 + jobId`。页面通过 SSE 或轮询读取公开阶段：

- 已上传
- 正在解析
- 正在生成笔记本
- 正在建立检索索引
- 已完成 / 可重试

超过 10 秒的工作应该是可恢复任务，不应该依赖浏览器标签页和一个持续打开的 HTTP 请求。

`IngestJob` 至少需要持久化输入 blob 引用、内容 hash、当前阶段、尝试次数、租约、错误摘要和产物版本；发布 notebook、MemoryFact 和检索索引时通过事务 + outbox 保证“界面显示完成”与实际可读取状态一致。相同文件 hash 的重复上传应返回已有任务或新版本，而不是再次执行整条模型链路。

### 回复问题

回复问题复用 `CourseAnswerTurn`。题库只先检索题目 ID、标题、概念、难度和状态；只有模型确定需要某题时才读取公开题干，答案和私有解析必须延后且受工具权限控制。

### 制定复习计划

现有流程相对轻，应继续保持确定性优先：

- 读取 LearnerCourseState。
- 读取最近答题状态和到期复习项。
- 从薄题目索引中选题。
- 写入一条版本化 PracticePlan。

不需要为了“显得智能”再调用一次模型。模型只在用户要求解释计划或需要自然语言改写时使用。

### 日历

当前网页版日历主要在浏览器 `localStorage`，约限制为 120 个事件，因此现状是 0 次数据库调用，单设备很快，但不能多设备同步。复习计划虽然主要由确定性规则生成，但“写入日历”和部分 MemoryFact 写入是客户端本地更新加 fire-and-forget，不能保证两者原子一致；全局日历也不是真正的跨课程服务端视图。原生端另有 SQLite/Dexie 路径，进一步说明日历需要统一领域边界，而不是继续复制存储实现。

若需要同步，建议新增：

```text
CalendarEvent(
  id,
  userId,
  sourceType,
  sourceId,
  title,
  startsAt,
  endsAt,
  status,
  version,
  updatedAt
)
```

- 打开月视图只做 1 次日期范围查询。
- 复习计划写日历使用幂等 `sourceType + sourceId` upsert。
- 一次计划的多条事件用单事务批量写入。
- 客户端缓存当前月和相邻月，按 `updatedAt/version` 增量同步。
- 计划发布和日历事件写入通过同一事务或 outbox 关联，失败时可重放，不用浏览器静默补写。

## 6. 长加载应该采用什么体验

| 等待时间 | 建议体验 |
| --- | --- |
| 0–300 ms | 不显示加载状态，避免闪烁 |
| 300 ms–2 s | 保留页面框架与上次缓存，局部 skeleton |
| 2–10 s | 显示明确阶段、已完成部分、重试入口 |
| 10 s 以上 | 持久化后台任务，可离开页面、取消、恢复和失败重试 |

关键规则：

- 页面 shell、标题和主要导航不应被全屏 loading 遮住。
- 缓存数据可以立即显示，并标记“正在更新”。
- 某个卡片的封面慢，只影响该卡片，不阻塞整个网格。
- 题库或记忆统计失败，不应让课程和笔记本名称消失。
- 过渡页适用于上传/生成这类真实长任务，不适用于掩盖 N+1 查询。

## 7. 数据库与连接策略

当前开发环境会在 Railway public proxy URL 没有显式参数时注入：

```text
connection_limit=1
pool_timeout=30
connect_timeout=15
```

这使同一个 Prisma pool 只能串行执行请求，池耗尽后还可能等待 30 秒。应当：

1. 用显式环境变量配置 pool，而不是按主机名静默决定。
2. 按“数据库可用连接 / 最大应用实例数”计算每实例上限。
3. 开发默认至少与客户端受控并发一致；当前客户端部分 GET 并发是 2。
4. `P2024` 返回 503 与短 `Retry-After`，不要在同一请求里再等一轮 30 秒。
5. 生产使用 pooled runtime URL，迁移使用独立 direct URL。
6. 为慢 SQL、请求扇出、响应字节和模型调用建立统一 trace。

增大连接池不是代替查询优化。先把一次用户动作的 SQL 数量变小，再按实际容量设置池。

## 8. 性能预算与验收

建议在 CI/预发布环境建立以下预算：

| 场景 | 预算 |
| --- | ---: |
| 我的课程首屏业务 HTTP | 1 个阻塞请求，最多 2 个后台请求 |
| 课程工作区首包 | 1 个 bootstrap 请求 |
| 课程工作区首包 SQL | 所有者 3–5；加入课程 5–7 |
| 首包 JSON | gzip 后小于 100 KiB |
| 列表封面 | 每张小于 150–250 KiB，只加载可见项 |
| 对话历史 | 最近 20–30 条 + 一条摘要 |
| 正常课程回答 | 1 次主模型，DB 4–8 次 |
| 首屏数据可用 p75 | 同区域数据库小于 1 s；远程开发小于 2 s |
| 长任务 API 确认 | 1 s 内返回 jobId |

每个请求应记录：

- `route`
- `requestId`
- SQL 数量和总 SQL 时间
- 响应未压缩/压缩字节
- cache hit/miss
- 模型调用次数、输入 token、首 token 时间
- job 排队、执行和重试时间

## 分阶段实施顺序

### P0：已经开始

- 课程列表取消按课程读取笔记本。
- 笔记本计数改为可靠的反规范化字段，并补回填与触发器。
- 全局侧栏改用轻量只读 summary。
- 课程详情和笔记本列表并行。
- 封面只读取当前可见的最多 6 本。
- 封面和记忆批量鉴权。
- 课堂去掉重复完整笔记本读取。
- `/learn` 资料库弹窗目录只读元数据；指定讲义正文改为点击后单接口、单 SQL 读取。
- 普通课程讲解移除客户端上下文/记忆预加载，改为单模型快速路径；工作流请求继续走语义规划。
- `/api/chat` 单次解析可信课程访问，并复用到资料读取和服务端 answerer handoff。
- 左栏会话以 URL session 为唯一身份，首屏只读 5 条元数据，点击后加载详情。
- 会话同步改为 patch + 删除墓碑，草稿按 session 隔离，删除具备确认、乐观切换与失败回滚。

### P1：下一阶段

- 新增课程 workspace bootstrap。
- 课程首页改用聚合题库/记忆统计，不下发全部题目摘要。
- 新增 `CourseConversation` / `CourseConversationMessage` 专用表、索引、sequence 和摘要；把会话控制器从 17k 行页面组件中拆出。
- 会话详情从当前 120 条安全窗口进一步改为最近 20–30 条 + 摘要的 cursor 读取。
- AI 上下文组装收敛到一个服务端用例，并移除分层记忆内部的重复访问解析。
- 记忆读取变为纯读，索引和摘要移到 outbox worker。

### P2

- 上传改成持久化 IngestJob。
- 日历服务端同步与计划幂等批量写入。
- NotebookPage/NotebookPageContent 成为课堂正式读取路径。
- 路由级 bundle 拆分、封面 CDN 转码和性能预算自动化。

## 9. 第二阶段落地（2026-07-30）

本章记录第一轮审计之后已经落地并验证的改变。前文保留的是当时的基线和建议；若两者描述不同，以本章的后续实现状态为准。

### 9.1 AI 读取与记忆边界

AI 回答的读取路径已经从“读取时顺便维护数据”进一步收敛为有界纯读：

- 正常课程来源检索使用 2 条 SQL，兼容回退最多 3 条；最多保留 12 个片段，每段最多 1,600 字符，课程来源部分总计最多 9,000 字符。
- 旧证据回退也有硬上限：最多扫描 96 条候选，Markdown 正文最多 12,000 字符、题目内容最多 10,000 字符、消息最多 4,000 字符，进入排序的候选最多 40 条。
- 课程、平台与 learner 三层直接记忆合并为一次 `UNION ALL` 查询，分别最多返回 8、4、6 条，不再为每一层重复建立访问上下文。
- 直接记忆、语义召回、来源/题目/消息证据、知识缓存与学习分析可以并行启动，关键路径不再是这些分支耗时的简单相加。
- 提示词按 9,500 字符的章节预算和 12,000 字符的最终预算组装，避免检索虽然有界、最后却在 prompt 中重新无限膨胀。
- 模型配置增加 30 秒进程缓存，避免每次回答都读取同一份系统配置。
- 读路径不再执行懒索引、缓存刷新、运行时 DDL 或数据回填。冷向量索引事务的超时边界已单独放宽到 15 秒，避免首次 HNSW 操作被 Prisma 默认 5 秒事务超时误杀，但它不属于正常回答读取。

远端开发库的真实只读 smoke test 返回了 2 条课程直接记忆、1 份 Markdown、6 道题目和 5 条消息，最终渲染证据约 10,782 字符。这里的 10,782 是所有证据类型合并后的结果；其中课程来源片段仍受上述 9,000 字符单项预算约束。

记忆写入也减少了同步工作：canonical `StudyMemory` 写成功就是请求的成功边界，向量索引改在 Next.js `after()` 中执行，本地 shadow 立即更新，远端 shadow 不阻塞响应。需要特别说明，`after()` 只是响应后的进程内工作，不是耐久队列；实例中断时仍可能丢失，因此 outbox + worker 仍是正式上线前的必做项。

### 9.2 复习计划

复习计划选题改为薄投影的两阶段读取：

1. 1 条候选 SQL，最多读取 24 条轻量候选。
2. 只有确认选中题目后才发出 0 或 1 条详情 SQL，一次最多补 20 题。

查询只读取公开题目字段，不把答案或私有解析提前送入计划器。在一门有 417 道题的真实课程中，旧路径物化约 1,143,382 B；新路径读取 24 条候选并补 5 条详情，共约 15,169 B，减少 98.67%。这说明复习计划的主要收益来自缩小投影和延后详情，而不是增加一个加载动画。

### 9.3 资料上传与来源持久化

同步来源处理内部已经完成以下 P0 收敛：

- Markdown 的 `S` 次逐段插入改成一次 `createManyAndReturn` 批量插入；在来源级 advisory lock 下，追加路径固定为 6 条事务语句，再加原有课程摘要刷新，SQL 数量不再随段落数 `S` 增长。
- 题目预检从读取整门课程的 public JSON，改为一次 `dedupeKey IN (...)` 索引查询；输入键 `D <= 5,000`，只投影 `id/title/dedupeKey`。
- 原子写入只读取输入键和最多 129 条轻量 legacy 行。legacy 数据超过 128 条时明确要求先跑维护迁移，不再静默退化为全题库物化。
- 来源调用方写完后不再重新读取整个题库。
- learner memory、知识图谱和一次缓存刷新保留各自写入，但并行执行，关键路径取最慢分支而不是三者之和。
- 提取文本的服务端契约统一为最多 220,000 字符。

这些改变减少了 route 内的 SQL 和内存放大，但没有把上传变成耐久任务。当前上传仍在长 HTTP 请求内完成解析、生成和发布，原始文件也尚未统一进入对象存储；客户端不同入口仍有 4/18 MB 的限制，而服务端二进制上限为 50 MB。正式形态仍应是 blob storage + `IngestJob` + durable worker + transactional publish + outbox，并让 API 尽快返回 `202 + jobId`。

### 9.4 日历服务端化

日历已经不再只是浏览器 `localStorage`。第二阶段新增：

- `LearningCalendarEvent`：服务端事件、版本号和 soft delete。
- `LearningCalendarMutation`：按 `Idempotency-Key` 保存写入回放结果。
- 日期范围 GET、最多 50 条的批量 POST，以及带 `expectedVersion` 的 PATCH/DELETE。
- 用户与课程访问范围校验、409 CAS 冲突、256 KiB 请求体、最多 366 天的查询范围和最多 120 条的列表响应。

迁移 `20260730030000_add_learning_calendar_store` 已应用到远端开发数据库。忽略鉴权和事务边界后，当前业务 SQL 预算为：

| 日历动作 | 成功路径业务 SQL |
| --- | ---: |
| 日期范围 GET | 1 |
| POST，不带课程 | 3 |
| POST，带课程 | 4 |
| PATCH | 3；更换课程时再加 1 |
| DELETE | 3 |
| 幂等重放 | 1 |

PATCH 和 DELETE 使用 `updateManyAndReturn`，不再在成功后多查一次事件。日历 API 也改为只解析已有用户，不再为了日历 CRUD 重复初始化用户、积分和交易记录；真实浏览器首次测试正是通过一次 15 秒超时发现并去掉了这条无关初始化链。

客户端按 `(courseId, range)` 缓存最多 24 个范围，TTL 为 60 秒。新建、更新和删除使用乐观 UI，服务端失败会回滚；重新打开新鲜月份不发 GET，过期月份先显示缓存再刷新。全局 `/calendar` 读取账号范围，课程内日历只读取当前课程范围，均只在日历界面真正出现时加载。

真实浏览器回归已完成“创建 → 更新 → 刷新后仍存在 → 删除”，测试事件最终已清理。连接本地应用与远端 Railway proxy 时，POST 约 9.2 秒、预热后的 GET 约 1.4 秒；最终少一条 SQL 之前，PATCH/DELETE 分别约 7.3/6.7 秒。这些绝对值仍主要受跨区 proxy 和单连接池影响，乐观 UI 只能改善感知，生产仍需同区域数据库和正确的连接池预算。

主页 dashboard 仍有旧的本地摘要读取，计划与日历的跨领域原子发布也尚未通过 outbox 打通；因此不能把当前日历称为“所有入口已经统一”。

### 9.5 图片笔记本增量场景写入

图片笔记本生成新增 `begin / upsert / finalize` 协议：

- `begin` 清空旧草稿并提升写入版本。
- 每次 `upsert` 只写 1–8 个场景，请求体最多 2.5 MB。
- `finalize` 在全部页完成后发布最终状态。

对于 `N` 页笔记本，生成期间的 HTTP 请求从约 `3N + 7` 降到 `N + 4`，场景写入单位从 `N(N + 1) / 2 + N` 降到 `N`。当 `N = 20` 时，请求数从 67 降到 24（约减少 64%），场景写入单位从 230 降到 20（约减少 91%）。这解决的是重复传输和整本覆盖，不等同于让整条生成流程具备任务租约、跨实例恢复和自动重试；这些仍属于 durable job 层。

### 9.6 课程页资料库弹窗的渐进读取

产品仍没有独立的笔记本页面；以下逻辑只服务于课程内资料库弹窗和课堂入口：

- 课程概览不再自动 hydrate 笔记本，真实课程首屏日志中没有 `/api/notebooks` 请求。
- 只有打开资料库、发布/来源流程或其他确实需要笔记本的界面才加载元数据目录。
- 点击 Markdown 笔记本后，先读取最多 20 条目录元数据，再只读取首个选中章节的正文；“加载更多”和切换章节继续按 cursor/章节 ID 请求。
- 章节目录不返回 `markdown/sourceMeta/scenes`，单章详情只返回一个 Markdown body。所有者路径的目录和详情各为 2 条 SQL（访问检查 + 内容查询）。
- 点击图片笔记本只读取封面或首张预览，不读取全量 scenes；进入 `/classroom/:id` 后才读取课堂内容。
- 来源兼容回退最多检查 4 个笔记本、6 个章节正文，不再无限扫描。
- 客户端分别缓存 notebook 页和 `notebook:section` 正文，避免在同一操作中重复请求。
- 未打开弹窗时，课程状态明确显示“按需加载”，只有实际发出目录请求后才显示“加载中”；读取失败会停在可重试状态，不再由 effect 每秒自动重放请求。

对应的新接口是：

- [`GET /api/notebooks/:id/markdown-sections`](../../app/api/notebooks/%5Bid%5D/markdown-sections/route.ts)
- [`GET /api/notebooks/:id/markdown-sections/:sectionId`](../../app/api/notebooks/%5Bid%5D/markdown-sections/%5BsectionId%5D/route.ts)

旧的 `includeMarkdown` 接口暂时保留，但课程页客户端已没有使用者。这个兼容入口可以在确认其他表面也完成迁移后删除。

真实浏览器点击还发现并修复了一个只在 PostgreSQL 实际执行时出现的问题：Prisma 将 `LEFT()` 的长度参数绑定成 `bigint`，目录查询因此返回 `42883`。目录和详情查询现在都显式转换为 `integer`，并且读取接口不再初始化 fallback 用户或积分账本。修复后，同一本 8 章节 Markdown 笔记本完成了“20 条以内目录 → 首章正文 → 另一个章节正文”的真实切换；每次目录或正文读取仍只包含访问检查与内容查询两条业务 SQL。

### 9.7 `/learn` 入口资源拆分

第二阶段把只在特定交互中出现的六个大组件改为 dynamic import：

- 题库
- 课程资料面板
- 学习进度面板
- 新建课程对话框
- 课程设置对话框
- 全部会话对话框

课程入口的选择性生产构建快照从 39 个相关 chunk、3.20 MB raw / 975.7 KiB gzip，降到 14 个相关 chunk、2.80 MB raw / 842.0 KiB gzip；gzip 约减少 133.8 KiB（13.7%）。题库约 119 KiB gzip 已移出默认入口。

完整 `pnpm build` 在 4 GiB Node heap 下通过；默认约 2 GiB heap 已能完成 Webpack 编译，但在 Next.js TypeScript worker 阶段 OOM。这个结果也是结构债务的直接信号：这只是路由资源拆分，不是结构重构。[`learn-page-client.tsx`](../../components/learn/learn-page-client.tsx) 仍约 18,827 行、759 KiB，继续在一个组件内承担课程、会话、资料库、题库、日历和 AI 控制状态。后续应按 feature/controller 拆分，避免一次改动触发整页回归，并恢复默认构建内存预算。

### 9.8 当前课程开屏预算

在现有远端会话、默认概览路径下，课程开屏的当前结构预算为：

| 场景 | 当前请求与 SQL |
| --- | --- |
| 已有远端会话、默认概览冷开 | 约 8 个数据 HTTP；7–8 条业务 SQL + 7 条重复鉴权 SQL，再加 `/api/auth/session`，物理 SQL 约 15–16 条 |
| 30 秒缓存内切换课程 | 通常 4 个 HTTP、4 条业务 SQL、4 条鉴权 SQL |
| 切换已有对话 | 1 次 RSC 导航 + 1 次详情 HTTP；1 条业务 SQL + 1 条鉴权 SQL |
| 左栏会话列表 | 5 条元数据，1 条 SQL，通常约 1–5 KiB |
| 会话详情 | 最近 30 条完整消息 + 最多 500 个墓碑，1 条 SQL |
| 课程详情 | 1 条 SQL，通常约 1–4 KiB |
| content state | 1 条聚合 SQL、响应小于 1 KiB；当前每 30 秒刷新 |

真实开发日志中，远端数据库冷连接曾让 `/api/courses` 达到 21.3 秒，预热后约 1.0 秒；同次课程进入中，会话列表约 3.2 秒、课程详情约 4.7 秒、content state 约 1.76 秒、计划约 1.06 秒、learner state 约 0.95 秒。这些不是生产 p75，但清楚显示了“多个轻请求各自重复鉴权 + 跨区单连接”的放大效应。

会话详情虽然已限制消息条数，富附件和消息 JSON 仍缺少字节预算；计划接口最多读取 80 条完整 fact 而界面只保留 4 条，learner state 的 JSON 也仍无硬上限。它们是下一轮缩小投影的直接目标。

### 9.9 下一阶段剩余工作

第二阶段之后，优先级应是：

1. 新增 `/api/learn/bootstrap`，在一个可信请求上下文中复用鉴权并返回课程薄详情、5 条会话元数据、`contentVersion`、lean learner state 和最多 4 条计划，消除当前开屏 fan-out。
2. 用显式 `PracticePlan`、`LearnerCourseState` 或等价投影替代从通用 `MemoryFact` 读取大 JSON；新增 `CourseContentVersion`，替代每 30 秒聚合扫描 content state。
3. 为会话正文和附件建立总字节、单消息字节、cursor 与摘要预算；把会话 controller 从巨型页面组件移出。
4. 把上传与长时生成改为 blob + job + lease + retry + transactional publish + outbox。当前 `after()`、fire-and-forget 和长 HTTP route 都不能承担耐久恢复。
5. 让计划发布、日历事件和学习状态通过同一事务或 outbox 关联；完成主页 dashboard 的服务端日历切换。
6. 在同区域预发布环境记录每个 route 的 SQL 数、响应字节、缓存命中、首 token 和任务阶段耗时，并把本章预算变成自动化门禁。

本阶段的核心选择没有变化：先减少不必要的读取、缩小载荷和并行独立分支，再用局部 skeleton、乐观 UI 或阶段页解释真正不可避免的等待。过渡页适合上传和生成；课程开屏的重复鉴权与请求扇出应由 bootstrap 和数据投影解决，而不是被全屏 loading 掩盖。

### 9.10 落地验证入口

- [AI 回答数据预算](../../scripts/maintenance/verify-ai-answer-data-budgets.mjs)
- [复习计划薄投影契约](../../scripts/maintenance/verify-review-plan-lean-problem-contracts.mjs)
- [来源上传数据预算](../../scripts/maintenance/verify-source-upload-ingestion-data-budgets.mjs)
- [日历服务端契约](../../scripts/maintenance/verify-learning-calendar-server-contracts.mjs)
- [日历客户端切换契约](../../scripts/maintenance/verify-learning-calendar-client-cutover.mjs)
- [图片笔记本增量写入契约](../../scripts/maintenance/verify-incremental-notebook-scene-persistence.mjs)
- [资料库弹窗渐进读取契约](../../scripts/maintenance/verify-notebook-popup-progressive-cutover.mjs)
- [日历数据库迁移](../../prisma/migrations/20260730030000_add_learning_calendar_store/migration.sql)
