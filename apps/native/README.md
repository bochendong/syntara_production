# Syntara Native

这是 Syntara 的本地优先应用壳。它使用同一套 React 界面同时生成 macOS 与 iOS/iPadOS
应用包，并为 Google 测试服生成网页版。学习资料优先写入设备内的 SQLite 或浏览器 IndexedDB；
账号、课程清单、会话同步与 AI 由平台后端提供。

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
- v2 助教聊天、批改、课程表解析和图片课堂统一通过 Rust 平台网关调用
- OpenAI 等供应商密钥只存在于平台服务端，不进入安装包、React、SQLite 或迁移包
- App 与桌面版启动均直接进入课程聊天；历史首页与四项底栏已弃用
- macOS 三栏布局与 iPadOS 原生侧滑课程工具/会话面板
- 启动恢复上次可访问课程和已有聊天；课程切换与工具入口放在聊天侧栏/手机抽屉
- 聊天导航提供总日历与课程日历；总日历汇总账号课程安排并跳到对应课程日期
- “我的”沿用新版资料、偏好和记忆星图；原生端已移除 Live2D，Web 端保持现状
- 使用 `CourseWorkspace` 与 `PhonePages`，只展示账号可访问课程。
- 浏览器开发态使用独立 IndexedDB，Tauri 应用使用 SQLite

浏览器开发预览、发布网页版和原生应用使用相同的 `LocalRepository` 接口。
发布网页版使用按账号隔离的 IndexedDB，从空数据开始；开发预览可使用独立演示数据。
发布的 macOS/iPadOS 应用由 `SqliteLocalRepository` 提供数据。

## 安装包与本机数据边界

| 位置 | 保存内容 |
| --- | --- |
| App 安装包 | React/Rust 程序、数据库 migration、图标/字体/静态图片、版本化公开题库快照、MAT136 参考对话及其示范 PNG/MP3 |
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

当前新版导航尚未提供手动迁移包导入入口；导出工具仍保留，账号课程与会话使用现有同步链路。迁移包字段范围和隐私边界见
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
- 原生 AI 请求从 Rust 核心发往 Syntara 平台 API；发布网页版使用登录 Cookie 调用同源 API。
  供应商 Key 和 Base URL 只由服务端配置。
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

## 聊天入口与返回链验证

```bash
node scripts/maintenance/verify-retired-chat.mjs
node --experimental-strip-types scripts/maintenance/verify-native-chat-launch.mjs
node --experimental-strip-types scripts/maintenance/verify-native-back-dismiss.mjs
node --experimental-strip-types scripts/maintenance/verify-native-chat-data.mjs
pnpm --dir apps/native exec tsc --noEmit -p tsconfig.qa.json
pnpm --dir apps/native build
```

浏览器交互验收在独立 loopback 端口运行 `pnpm --dir apps/native dev --host 127.0.0.1 --port 1474 --strictPort`，
打开 `http://127.0.0.1:1474/qa/chat.html`。这是仅开发态可用的隔离浏览器数据夹具，不连接原生 SQLite、账号或 AI；
请使用新的浏览器 origin，避免覆盖同一 origin 下的其他预览数据。`?count=0`、`?count=1`、默认 12 门及
`?count=20` 覆盖空账号与多课程目录。夹具不进入生产 dist。主应用仍从 `http://127.0.0.1:1474/` 打开。

必须检查：启动直达已有聊天、侧栏课程切换、跨课程日历归属与新增、
手机菜单 → 我的 → 返回（重复操作）、浏览器后退按层关闭，以及手机/平板/桌面尺寸。
浏览器检查不代替原生软键盘、安全区、系统返回或真实账号同步验收。

## Google 测试服网页版

测试服 `/test` 登录后会进入 `/test/app`，使用当前 App 的同一套界面。
构建命令是 `SYNTARA_APP_ENV=staging SYNTARA_NATIVE_ACCESS_POLICY=google-test node scripts/deploy/build-native-web.mjs`，
生成的 `public/native-web/` 不进入 Git。普通浏览器开发预览保持隔离；
只有该构建启用 Google 会话和同源平台 API，账号浏览器数据库从空状态开始。
网页版通过平台后端调用 AI，供应商密钥仍只保存在服务端。课程和聊天通过现有
账号接口同步，学习工具及偏好继续使用浏览器本地缓存。详见
[网页版测试部署](../../docs/api/native-web-staging.md)。

### 本机手写 / 图片真实评分预览

正式浏览器版使用登录后的同源 `/api/native/v1/grade`；评分不要求 Tauri。
未启用 `VITE_SYNTARA_WEB_APP` 的独立开发预览也可以调用该接口，仍由服务端认证。
小问只有图片时会发送非空的图片作答说明，保留实际图片内容。

本机离线题面需要真实评分时，可显式连接现有测试服设备凭据：

```bash
SYNTARA_QA_GRADING_CREDENTIAL_FILE=/absolute/path/to/private-device-session.json \
  pnpm --filter @syntara/native exec vite --host 127.0.0.1 --port 1432
```

打开 `http://localhost:1432/handwriting-preview.html`。该开发连接只接受本机同源的
评分 POST，沿用凭据文件中已校验的 API origin 和设备会话；密钥不会发送到浏览器。
它不代理登录、课程或写入接口，不参与生产构建。凭据刷新复用现有带文件锁的后端认证工具。
不设置该变量时不会启用此连接；不要把设备凭据放入 `VITE_` 变量或前端源码。

`?grading-check=1` 使用独立本机题目、草稿和作答记录，可用“2+2”及答案“4”验证图片
直接评分、手写提交评分和小问评分，不改动原手写试用的题目及草稿。真实评分会使用平台
现有模型和账户额度，但 QA 题目与作答不会上传到课程题库。
