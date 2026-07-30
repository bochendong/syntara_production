# Syntara macOS / iPadOS 迁移架构

## 决策

采用 **Tauri 2 + React/Vite + SQLite**，不采用 WebView 打开线上站点，也不在应用内运行
Next.js 服务器。

这条路线保留现有 TypeScript 教学领域逻辑和主要交互资产，同时把运行时边界改为：

```text
React 学习界面
  ├─ LocalRepository ── SQLite（课程、题库、笔记本、会话、记忆）
  ├─ Local Search ───── SQLite FTS5（只在设备内检索）
  ├─ AssetRepository ── App Data 内容寻址文件（SQLite 只留索引）
  ├─ AI Runtime ─────── Rust command + OpenAI Responses SSE + Apple Keychain
  └─ Optional Sync ─── 用户主动开启的备份/跨设备同步
```

线上 PostgreSQL 不再是打开应用和学习的前置条件。

## 为什么不是全量 SwiftUI 重写

现有项目的价值不只在页面，还包括 TypeScript 中的题库导入、教学编排、记忆读写、
notebook 生成和多模型适配。一次性改写为 Swift 会同时改动界面、领域逻辑、数据层和 AI
运行时，无法建立可靠的行为对照。

Tauri 的 macOS/iOS 产物仍是平台应用包；Rust 核心负责文件、SQLite、安全存储和网络，
现有 React 逻辑可分批从 Next.js 中抽出。等核心迁移完成后，个别需要强平台体验的界面
仍可以通过原生插件或 Swift bridge 替换，不需要推翻数据层。

## 已确认的线上慢路径

当前四类核心适配器都已经是远程数据库优先：

- `lib/utils/course-storage.ts`：IndexedDB 课程迁移被显式停用，所有 CRUD 调用课程 API。
- `lib/utils/stage-storage.ts`：笔记本、场景和首图均调用 notebook API。
- `lib/utils/notebook-problem-api.ts`：题库列表、详情、提交与导入均调用 API。
- `features/learn-conversations/client/remote-conversation-api.ts`：会话分页、加载与写入均调用数据库 API。

`lib/utils/backend-api.ts` 还把上述数据库 GET 请求限制为两个并发槽。课程首页同时加载多类
数据时，网络延迟和数据库查询会串成队列。

## 平台与界面策略

- macOS：启动进入 Learn 主屏，课程内使用三栏资料库布局，支持可调整窗口、键盘、鼠标
  和后续多窗口。
- iPadOS 横屏：Learn 首页保持主屏式组件与课程图标网格；课程内保留三栏/双栏结构。
- iPadOS 竖屏与紧凑宽度：内容单栏 + 底部导航，会话列表改为横向选择器。
- 使用系统语义层级、可读字号和安全区，不依赖固定画布尺寸。
- 最低版本暂定 macOS 14 / iPadOS 17，和 SwiftData 时代的系统能力保持一致；Tauri
  数据层本身使用 SQLite，不绑定 SwiftData。

## 数据原则

1. 本地是真实来源（source of truth）。
2. 所有写入先本地提交，界面立即更新。
3. 同步是可选、可观察、可重试的后台能力。
4. 大文件进入内容寻址的文件目录，SQLite 只保存元数据和引用。
5. API key 进入 Keychain/安全存储，不进入 SQLite、日志或前端状态。
6. 搜索先使用 SQLite FTS5；向量索引是可重建派生物，不阻塞资料读取。
7. 公共课程题库以版本化、带哈希的快照随 App 分发；启动时幂等 upsert，
   不因设备上已有自建课程而跳过升级。

## 安装包与用户本地数据的边界

| 位置 | 保存什么 | 更新方式 |
| --- | --- | --- |
| App 安装包 | React/Rust 运行代码、SQLite migration、版本化的公共题库/Mock 清单，以及首次安装必需的课堂 PNG/MP3 种子 | 随 App 版本更新；运行时只读 |
| SQLite（App Data） | 课程、笔记本、题目、会话、消息、学习记忆、课程日程、课堂 deck/page/action 元数据，以及资源 hash/相对路径 | 由 `LocalRepository` 事务写入 |
| 内容寻址资源库（App Data） | 用户导入或生成的图片、音频、PDF；内置课堂种子也会在首启校验后复制到这里 | 按 SHA-256 去重，SQLite 只引用路径 |
| WebView 本地偏好 | 折叠栏、所选模型等可丢失的纯界面偏好 | 不作为学习数据真实来源 |
| 仓库 `apps/native/artifacts` | Image2 提示词、source marker、恢复尝试、遮罩预览和校验报告 | 仅供开发/追溯，不进入 Vite `public`，因此不进入安装包 |

内置课堂采用“包内种子、首启安装”的两阶段链路：App 只携带能离线恢复 Mock 所必需的
最终 PNG/MP3；首次启动时校验资源并写入内容寻址目录，再把 deck、页面、语义区域、
动作序列和资源引用写入 SQLite。之后聊天界面先从 SQLite 读取讲解摘要，用户点击
“查看讲解”时才读取该 deck 的图片和音频。后续在线生成的 Image2 图片与 OpenAI 语音
只进入用户 App Data，不会写回安装包。

## 迁移阶段

### Phase 1：本地壳与核心资料库

- Tauri macOS/iPadOS 工程
- SQLite migration
- 课程、笔记本、题库、会话与消息纵向切片
- 设备宽度适配
- 图片笔记本 / Markdown / 题目详情本地阅读
- 页面图片资源归档、导入和笔记本级延迟读取
- 图片/音频二进制从 SQLite 分离到 App Data 内容寻址文件库
- 笔记本、题库和学习记忆进入 FTS5 本机索引，并可从资料库直接搜索

### Phase 2：AI 对话本地运行时（纵向切片已完成）

- 已完成 Rust 侧 OpenAI Responses transport、SSE 流与 Apple Keychain
- 已完成用户消息先落 SQLite、助教回复完成后再落 SQLite
- 已完成断网/模型失败不回滚用户消息，界面显示可读错误
- 待完成：抽取完整教学决策和 tool contract
- 待确认隐私授权后：按当前问题从本地记忆、题库和笔记本拼装证据；默认不会把
  本机搜索结果自动发送给模型

### Phase 3：内容导入与 notebook

- `.syntara` 导入/导出包
- PDF/DOCX 本地解析
- 已完成图片、音频和生成资产内容寻址文件仓库
- notebook 页面/Markdown 编辑与课堂播放

### Phase 4：可选同步

- 先支持 iCloud Drive 文档包备份
- 如需多人协作，再增加显式账户与增量同步协议
- 不恢复“每次打开都依赖远程数据库”的路径

## 验收门槛

- 冷启动后无需网络即可看到课程、题库、笔记本和历史对话。
- 本地列表/详情 P95 读取目标小于 50 ms（不含首次数据库 migration）。
- 断网创建的课程、消息和作答重启后仍存在。
- macOS 与 iPadOS 使用同一份 migration 和 repository contract。
- macOS 与 iPadOS 使用同一份 Keychain 与 AI transport contract。
- 开启同步后，网络失败不会回滚已成功的本地写入。
