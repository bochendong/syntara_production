# PostgreSQL / IndexedDB 到本地 SQLite 的映射

## 第一批（已建表）

| 现有模型 | 本地表 | 迁移说明 |
| --- | --- | --- |
| `Course` / `CourseRecord` | `courses` | 去除 `ownerId` 读取前置；单设备默认 owner |
| `Notebook` / `StageRecord` | `notebooks` | 统一 Stage = Notebook 的历史命名 |
| `NotebookProblem` | `problems` | 公共题面和评分配置保存为 JSON |
| `Conversation` | `conversations` | 课程/笔记本作用域保留 |
| `Message` | `messages` | 消息拆行存储，不再每次覆盖整段会话 JSON |

## 第二批（已建表，可由迁移包导入）

| 现有模型 | 计划本地结构 | 说明 |
| --- | --- | --- |
| `NotebookProblemAttempt` | `problem_attempts` | 作答追加写 |
| `NotebookProblemProgress` | `problem_progress` | 可由 attempts 重建的当前投影 |
| `StudyMemory` | `study_memories` | 学习状态、薄弱点与下一教学动作 |
| `CourseQuestionRun` | `question_runs` | 本地幂等与失败恢复 |

## 第三批（页面、离线资源与本机检索已入库）

| 现有模型 | 计划本地结构 | 说明 |
| --- | --- | --- |
| `Scene` / `NotebookPage` | `notebook_pages` | 已完成；兼容新 Page 与旧 Scene |
| `MarkdownNotebookSection` | `markdown_sections` | 已完成；Markdown 纯文本 |
| `NotebookPage` / `MarkdownNotebookSection` / `NotebookProblem` / `MemoryFact` | `local_course_search`（FTS5） | 设备内全文索引；结果只用于本机资料库搜索，不自动发送给模型 |
| `CourseSource` | `course_sources` | 原始文件存 App Data，表内保存 hash/path |
| `KnowledgeDocument` | `knowledge_documents` | 可重建知识投影 |
| `KnowledgeChunk` | `knowledge_chunks` + FTS5 | 先全文检索，向量作为可选派生索引 |
| `Asset` / `NotebookImageAsset` | `assets` + App Data `assets/<hash-prefix>/<sha256>.<ext>` | 迁移包携带 Base64；导入时校验 SHA-256 并写内容寻址文件，SQLite 只保存相对路径 |
| `NotebookPageAsset` | `page_assets` | 保留页面、资源、角色和顺序 |
| 归档生成的笔记本资源索引 | `notebook_assets` | 避免打开一本笔记时读取其他课程的资源 |
| 课程日程 / syllabus 日期 / 复习计划 | `course_events` | 日期型课程事项进入 SQLite；不再把 localStorage 作为真实来源 |
| 课堂讲解 | `lecture_decks` + `lecture_pages` | deck 关联助教消息；页面保存语义区域和动作，图片/语音通过 `assets` 引用 |

旧版 `assets.data_base64` 记录会在启动时分批搬到 App Data，成功落盘后清空 SQLite
大字段。阅读器只在当前页面真正渲染图片时通过受限原生命令读取对应文件。

`MemoryFact` / `MemoryFactEvent` 的完整事件模型、`CourseQuestionRun`、知识文档分块索引和
原始课程文件仍在后续迁移批次中。

## 不迁入本地学习核心

- NextAuth `User` / `Account` / `Session`
- Stripe 充值、订单和 webhook
- 课程商城购买关系
- 管理员表与共享 QA 结果

这些属于可选在线服务。移除它们能让本地应用在没有账户、OAuth、PostgreSQL 和 Stripe
的情况下完整打开个人资料库。
