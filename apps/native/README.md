# Syntara Native

这是 Syntara 的本地优先应用壳。它使用同一套 React 界面同时生成 macOS 与 iOS/iPadOS
应用包，核心业务数据写入设备内的 SQLite，不经过 Next.js API 或 PostgreSQL。

## 当前客户端入口

当前客户端入口是 `src/App.tsx`，课程界面在 `src/components/CourseWorkspace.tsx`，
手机页面和个人中心在 `src/components/PhonePages.tsx`。以当前开发版本为准；
`main` 的旧桌面主屏实现已删除。

## 当前纵向切片

- 课程列表与创建
- 课程下的笔记本列表
- 课程题库列表
- 本地图片笔记本 / Markdown 阅读器
- 本地题目详情、作答记录与进度读取
- SQLite FTS5 课程内搜索，可在设备内定位笔记本、题目与学习记忆
- 页面资源随迁移包导入 App Data 内容寻址文件库，并按当前页面延迟读取
- 本地会话与用户/助教消息写入
- 课程日程写入 SQLite；旧版 localStorage 日程在打开课程时一次性迁移
- 课堂讲解 deck/page/action 写入 SQLite，Image2 PNG 与 OpenAI 语音写入 App Data
- 教学回合、复习计划、批改、课程表解析和图片课堂统一通过 Rust 平台网关调用
- OpenAI 等供应商密钥只存在于平台服务端，不进入安装包、React、SQLite 或迁移包
- 启动后直接进入当前账号的课程聊天；课程入口由账号可访问的课程决定
- macOS 三栏布局与 iPadOS 原生侧滑课程工具/会话面板
- 使用 `CourseWorkspace` 与 `PhonePages` 提供桌面、平板和手机布局；个人中心在当前界面内打开
- 浏览器开发态使用独立 IndexedDB，Tauri 应用使用 SQLite

浏览器预览和原生应用使用相同的 `LocalRepository` 接口。浏览器预览库只用于快速开发；
发布的 macOS/iPadOS 应用由 `SqliteLocalRepository` 提供数据。

## 安装包与本机数据边界

| 位置 | 保存内容 |
| --- | --- |
| App 安装包 | React/Rust 程序、数据库 migration、图标/字体/头像素材、版本化公开题库快照、MAT136 参考对话及其示范 PNG/MP3 |
| SQLite / IndexedDB | 用户课程、会话与消息 metadata、笔记本结构、题目进度与作答、学习记忆、日历、课堂 deck/page/action 与资源索引 |
| App Data 内容寻址文件库 | 用户导入的文件、生成或迁移得到的 Image2 PNG、OpenAI MP3；SQLite 只存 hash、路径和校验信息 |
| WebView localStorage | 折叠状态、模型选择等轻量设备 UI 偏好；不保存课程正文或供应商密钥 |
| 平台服务端 | 模型供应商配置与密钥；App 每次仅发送当前教学回合需要的有界课程上下文 |

内置 MAT136 参考资源随版本发布，但首次启动后也会按版本与 hash 幂等安装到 App Data，
之后播放器统一走本机资源读取。用户生成内容不会反写安装包，升级 App 也不会覆盖 SQLite
和 App Data 中的个人数据。

## 内置课程题库

App 包内包含一份带版本与 SHA-256 校验的生产题库快照，首次启动会写入本机 SQLite，
已有安装也会按快照版本幂等升级：

- MAT136：227 道已发布题目
- CSC148：298 道已发布题目
- MAT102：412 道已发布题目
- CSC108：286 道已发布题目

合计 1,223 道。快照只包含课程元数据、公开题面和本地自检所需的 grading JSON；
不会打包 `NotebookProblemSecret`、账号、对话或个人学习进度。需要从生产库刷新时运行：

```bash
pnpm native:snapshot:export
pnpm native:verify
```

## 开发

```bash
pnpm install
pnpm --filter @syntara/native dev
```

安装 Rust 工具链后可运行 macOS 应用：

```bash
pnpm --filter @syntara/native desktop:dev
```

iPadOS 初始化与运行需要完整 Xcode，并先在 Terminal 接受 Apple Xcode 许可：

```bash
sudo xcodebuild -license
pnpm --filter @syntara/native ios:init
pnpm --filter @syntara/native ios:dev
```

仓库已经包含 iOS 17、iPhone/iPad 通用设备、四方向 iPad 旋转、多任务和触控安全区配置。
首次 `ios:init` 会生成 `src-tauri/gen/apple/syntara-native.xcodeproj`。

可指定模拟器启动开发版：`pnpm --filter @syntara/native ios:dev "iPhone 18 Pro"`。
Xcode 27 / iOS 27 使用 Tauri 2.12.4 及锁文件中的配套运行时，并通过
`Info.ios.plist` 声明 `TaoSceneDelegate` 场景生命周期。Swift 兼容库搜索路径必须包含
`usr/lib/swift/$(PLATFORM_NAME)`；修改 `project.ios.yml` 后需重新生成已有 Xcode 工程。
若已安装的模拟器运行时低于 Xcode 默认 SDK（例如运行时 27.0、SDK 27.1），Tauri CLI
可能提示 SDK 未安装并打开 Xcode。此时运行 `pnpm --filter @syntara/native ios:dev --open`，
在 Xcode 中选择已安装的 iPhone 模拟器并 Run；前端开发服务器会继续提供热更新。

## 迁移现有网页版数据

先从当前 PostgreSQL 导出版本化迁移包：

```bash
pnpm native:archive:export -- --email your@email.com --output ~/Downloads/syntara.syntara.json
```

当前客户端从账号同步可访问课程；数据迁移包的完整字段范围和隐私边界见
[docs/migration.md](./docs/migration.md)。

本地数据链路可以独立验证：

```bash
pnpm native:verify
pnpm native:benchmark
```

## 约束

- 不在 WebView 中启动 Next.js 服务器。
- 不从原生应用读取 `DATABASE_URL`。
- 本地列表/详情读取不得回退到 `/api/courses`、`/api/notebooks`、
  `/api/learn/conversations` 或题库 API。
- AI 请求只从 Rust 核心发往 Syntara 平台 API；前端不能提交供应商 Key 或 Base URL。
- 教学请求只附带当前课程的有界对话、证据、题目候选与最近作答，不上传整库或其他课程。
- 课程与完整历史仍以本机 SQLite 为准；平台响应落为消息 metadata，生成资产落到 App Data。

### Tester login

macOS, iOS/iPadOS and Android share the native tester form. The web login and device-approval pages expose the same entry when the server enables it.

- Configure `SYNTARA_TESTER_LOGIN_ENABLED=1` and `SYNTARA_TESTER_EMAIL` on the server. Deployed environments are disabled by default.
- Credentials are verified against the existing active account password hash; passwords are neither prefilled nor bundled.
- Optional `SYNTARA_TESTER_ACCOUNT_USER_ID` selects the explicitly authorized account whose courses, memory and conversations should be loaded. The target must also be active. Keep this mapping in ignored local/server environment configuration.
- The test account may enter the App without an activation code while the tester feature is enabled. Disabling the feature restores normal activation checks.
- Native sessions use the regular revocable/refreshable tokens and system Keychain storage. Configure a server-only `SYNTARA_NATIVE_AUTH_SECRET` for signing.
- For this Mac's local UI testing, launch with `SYNTARA_NATIVE_API_BASE_URL=http://127.0.0.1:3000 pnpm --filter @syntara/native desktop:dev`; use the running local Next.js server.
- Verify auth policy with `node scripts/maintenance/verify-tester-login.mjs`.

### Local AI configuration repair

If a shared database contains encrypted administrator settings made with a different encryption key, set `SYNTARA_LOCAL_LLM_CONFIG_SOURCE=environment` in ignored `.env.local` to use the existing local `OPENAI_API_KEY`. This override applies only to development and does not rewrite the shared database. If the shell's proxy is unavailable, `SYNTARA_LOCAL_AI_PROXY=direct` explicitly selects a direct development connection; production retains its proxy settings.

The SQLite repository serializes complete operations and configures one persistent pool connection, so multi-command transactions stay on the same connection during background sync and chat writes. Verify with `node scripts/maintenance/verify-native-repository-serialization.mjs` and the Rust `local_database::tests` test.
