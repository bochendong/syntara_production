# 原生导航与旧聊天清理：测试分支整合

> 历史验收快照：下文的未提交状态、测试账号和部署号描述当时的验收。当前整合范围见 [测试分支整合清单](./native-staging-release.md)。

2026-10-22（America/Toronto）。已完成 macOS 测试 App 验收和 staging 后端部署；未暂存、未提交。

## 来源与保留

- 目标：`codex/native-google-staging`，HEAD 仍为 `4a460a62998c549fbcb6921003df1b4bdb62f533`。修复存在于未提交工作区，不能只用该 commit 重现安装包。
- 来源：`codex/native-home-restore`，基线 `b8f38fa8`，按迁移清单的 69 项任务差异逐文件整合，没有复制整个共享工作区。
- 与「迁移应用到 Railway」线程对齐后，本线程负责写入、部署和打包，对方只读复核。保留目标的 Google 登录、verified-email/device auth、账号专属 TEST101 和 staging 禁用测试员密码的条件。
- 保留 `com.syntara.staging`、独立 SQLite/Keychain、`Syntara-Native-Preview-Staging`、migration 0009、仓库事务串行化；保留目标 package/lock 和现有 QA 文档。README 与 UI 清单逐项合并，未把未验收项目改成 verified。
- 原共享工作区与来源 worktree 未回写功能改动。目标整合前 3055 项文件的哈希检查未发现范围外修改；index 为空。
- 检查点、逐文件决策、整合补丁与未跟踪文件备份保存在 Git 公共元数据 `codex/tasks/native-home-restore/staging-integration/`。`verify-native-repository-serialization.mjs` 从原工作区按单文件补入，来源与哈希记录在清单。

## 产品与聊天入口

- 历史首页保持弃用，启动恢复可访问课程的聊天；显式空课程账号不会启动旧缓存。
- 总日历、新版“我的”、课程内日历保留；修复嵌套返回、手机窄屏星图和多课程选择滚动。
- 删除旧 Web `/chat` 及专属组件、旧原生 v1 turn/review-plan 链路；保留 Web Learn `/api/chat`、现行课程功能和历史计划卡片渲染。详见 [退役范围](./retired-chat.md)。
- 原生实际链路为 `CourseWorkspace → streamNativeChat → runNativeChatTurn → native_chat → /api/native/v2/chat`，客户端与服务端共同使用 `capabilities.chat`。
- 打包前新增源码守卫，检查新版入口、v2 链路、退役文件与 staging 隔离，避免打出旧 App。

## macOS 原生验收与本轮补修

在真实 Tauri 窗口、现有 Google 会话及 TEST101 上验证。资料编辑只打开和返回，没有保存个人资料或修改偏好；新增一个独立验收聊天，发送两条算术问题。

| 项目 | 实测结果 |
| --- | --- |
| 启动/重启 | 直接进入新版聊天；现有账号、课程和历史对话保留，重启恢复验收聊天 |
| 总日历 | 实际画面显示；选择课程弹窗可打开/取消，返回聊天，按钮避开 macOS 标题栏 |
| 新版我的 | 实际画面显示；真实本周用量可读取；编辑返回我的、我的返回聊天 |
| v2 对话 | “7 加 8”收到“7 加 8 等于 15。”；最终构建“9 + 6”收到“15” |
| 后端请求 | 两次 POST `/api/native/v2/chat` 均 200，最终构建请求时间为 `2026-10-22T19:12:37.973175071Z` |

验收中发现：AX 内容已出现但 WKWebView 滑入页不可见；关闭页进入动画后，总日历恢复显示，课程工作区仍有半透明残留。最终禁用原生页面/工作区的进入动画与原生 ViewTransition，保留浏览器动画和交互边缘手势。重建后上述画面正常。另修复 macOS 总日历标题栏重叠和编辑“完成”按钮换行。

新版“我的”、编辑页和修复前动画截图同目录留档。手机/平板 320×568、390×844、820×1180、1180×820 及桌面浏览器验收来自 [来源任务记录](./native-navigation-qa.md)。本轮原生实测为 macOS；没有把浏览器视口验收当成 iPhone/iPad 真机或系统返回手势验收。

## 测试后端与安装包

- Railway staging API：`native-api-staging`；部署 `fdb48275-c2f3-4070-a524-ab69ab07693f` 为 SUCCESS。
- Origin：`https://native-api-staging-staging-95a1.up.railway.app`。只上传显式未提交源码快照到 staging，未修改生产服务或环境变量。
- 服务端快照清单另存检查点。最终原生动画/标题栏/按钮修复发生在上传之后，属于客户端改动；服务端 capability/v2 路由的源码与已部署快照一致。
- 最终分发包：`/Users/dongbochen/Downloads/Syntara-Integrated-Test-20261022-Final/Syntara-Test-integrated-macOS-arm64.zip`。
- ZIP SHA-256：`2e32953a42d6588a3a4c38d40ef45bc90189f5e2d2feedccd8502ef486fcfba7`。
- 可执行文件 SHA-256：`2212768bebc0a0099027320f102bf12ab40af17868fdc3d460218e07cffa2cec`。
- 同目录 `build-manifest.json` 记录未提交源码、删除文件、构建与部署信息。架构 arm64，最低 macOS 14.0，ad-hoc 签名验证通过，未公证。
- 原 `Syntara-Current-Test-20261022` 保留。无 `-Final` 的 `Syntara-Integrated-Test-20261022` 是视觉修复前候选，分发请使用上述最终包。

## 工程验证与限制

- 通过：退役聊天 handler 的离线鉴权/能力测试、返回层/启动筛选/SQLite 聊天数据、平台访问契约及 6 项访问策略、事务串行化、UI 清单。
- 通过：根 Next.js 生产构建、根 TypeScript、原生和 QA TypeScript、定向 ESLint/Prettier、`git diff --check`、最终 Tauri staging 构建和签名校验。
- 首次根 TypeScript 遇到已删除路由的 `.next/types` 缓存；Next 构建重新生成后复验通过。构建仍提示 unpdf 动态依赖、middleware 命名和原生大分块。
- 既有原生 bundled snapshot hash 失败在来源任务中已有对照记录，本轮未修改快照或用完整 `native:verify` 宣称通过。
- 未验证：iOS/Android 原生包、真机安全区/键盘/旋转、实际退出登录、完整无障碍合规。没有执行手动数据迁移、删除会话或清理用户数据。

验收截图保留在本地工作区和安装包 evidence 目录，未随源码上传 GitHub。
