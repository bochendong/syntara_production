# 测试分支整合清单

2026-10-22。目标分支 `codex/native-google-staging`，从原有四个本地提交的 HEAD `4a460a62` 继续；不合并 main，不包含 chatai 的五个待推送提交。

## 纳入内容及来源

| 范围 | 明确来源 | 最终行为 |
| --- | --- | --- |
| 新版 App 与原生 v2 | 已验收测试分支、native-home-restore 任务差异 | 启动聊天，保留总日历和新版我的，逐层返回；原生动画与标题栏修复 |
| 空账号和浏览器测试版 | 测试分支的 empty-onboarding / native-web-staging 验收 | Google 登录 /test 后进入 /test/app；0 门课程起步，显式创建课程；同源鉴权、账号存储隔离 |
| 旧聊天退役 | native-home-restore 的退役清单 | 删除旧 Web /chat 和旧原生 v1 turn/review-plan；现行 Web Learn /api/chat 和原生 /api/native/v2/chat 保留 |
| 旧界面与依赖 | retired-surface-cleanup 独立任务 | 删除旧登录/创作台、闲置首页动效和资源、10 项根依赖；原生 Live2D 已退役，Web 使用的依赖保留 |
| 积分与抽奖退役 | retire-learning-economy 独立任务 | 旧入口返回 410，取消积分结算和解锁条件，保留历史数据库数据和实际模型用量核算 |
| 开发工具 | workspace-isolation 独立任务 | 更新 AGENTS、增加 verify:local、worktree 状态和提交保护；原型/产物不参与根检查 |

三项独立清理/工具任务共逐文件核对 153 个路径：48 项内容已存在，旧侧栏另 1 项已退役，均未重复引入；5 项保留目标改动后合并，无冲突。锁文件从合并后的依赖清单离线重新生成，未复制另一工作区的整份依赖状态。

原共享工作区中的新 Web landing、Prisma schema、AI 配置、课程/笔记等其他待归属改动保持原样。来源 worktree、设计稿、截图、安装包和本地恢复检查点继续保留；源码提交不包含环境密钥、依赖目录、构建产物或 QA 截图。

## 验收依据

- macOS 新版 App：见 [导航整合验收](./native-navigation-integration.md)。已验证真实 v2 回复、总日历、我的和编辑返回，修复原生动画残留。
- 手机/平板/桌面浏览器布局：见 [跨尺寸验收](./native-navigation-qa.md)。这不是原生移动真机结论。
- 新账号空课程及头像：见 [空账号修正](./native-empty-onboarding.md)。旧 TEST101 是 QA 夹具，最终实现不自动创建它，也不删除原有数据库记录。
- 完整网页版：见 [浏览器测试版验收](./native-web-staging.md)。最新已验收部署为 `81b6abb7-fcf7-4ceb-9c8d-1d42081009e8`，测试入口为 https://native-api-staging-staging-95a1.up.railway.app/test。
- 本次 GitHub 整合额外包含依赖/积分清理和工具变化；此前安装包与已部署服务属于各自验收快照，不能把它们说成包含本次全部整合内容。本轮不额外部署或替换安装包。

## 整合后检查

- 23 项工具/访问控制/浏览器/空账号离线测试通过；积分退役与 45 项头像资源验证通过。
- 返回层、启动筛选、内存 SQLite 聊天/日历、仓库事务串行化、平台访问与打包源码守卫通过。
- UI 清单补登 CreateCourseDialog 后通过；needs-review 标记保留，不把清单通过等同于全面视觉一致。
- 合并后的锁文件离线 frozen install 通过；浏览器 staging 生产包、Next.js 生产构建、根 TypeScript、原生 Vite/TypeScript 及 QA TypeScript 通过。
- Rust cargo fmt --check 与 cargo check --offline 通过。
- 整个候选分支相对 origin/main：440 项格式检查、179 项 JS/TS lint 通过，零 lint 警告；git diff --check 通过。
- 本地生产 HTTP：/test、/test/app 及静态资源为 200；未登录课程/能力/v2 请求为 401；跨源 v2 写入为 403；四个旧聊天入口为 404。使用一次性本地认证配置，无真实数据库或 AI 请求。
- 首次 HTTP 运行因缺少生产认证 secret 返回 503，补入一次性本地测试配置后上述断言通过；没有放宽鉴权或改写环境文件。
- 其他五个 worktree 的文件哈希、状态和 HEAD 与整合前一致；目标 Prisma schema 与测试隔离配置保留。
- 已有 bundled native snapshot hash 失败保留历史记录，未修改或重跑，不据此声称完整 native:verify 通过。构建有既有 unpdf/middleware/分块体积提示。

本地整合前快照、每文件决策、锁文件生成和检查日志保存在 Git 公共元数据 `codex/tasks/publish-native-staging-20261022/`。这些是本地恢复证据，不是源码仓库中的凭据或审阅基线。
