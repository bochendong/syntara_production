# 分支与测试服状态

核对日期：2026-10-26（America/Toronto）。当前测试服已更新，源码基线与实际部署对应。

MAT102 题库内容已更新至桌面上的 TT2 真题优先修订版：新增 60 道题（34 道选择、16 道分小问题、10 道证明），其中分小问共 39 问。原有 252 道题全部保留，现在共 312 道；网页可搜索“修订版”。新版 20 份 PDF 和 1 份 LaTeX 源码 ZIP 已归档并逐份下载核对哈希，原有 24 本讲义和 22 份原始资料未改。此次仅发布课程内容，应用源码与数据库结构不变。见 [TT2 修订版内容记录](releases/staging-2026-10-26-mat102-tt2-refresh.json)。

最新应用源码为 `1c290206`，Railway 发布 `15c5dc5a` 已成功。MAT135 的 48 道原题已原地整理为分小问；20 问极限拆成两道各 10 问，15 问相关变化率拆成三道各 5 问，两道原题归档保留完整内容及作答历史。现在共 163 道可见题，其中 53 个题组、232 个小问。其余 110 道题、11 本讲义、20 份原始资料和章节定义保持不变。实际测试服已验证范围标题、10 问/5 问卡片、双语题干、图片表格与答案确认。见 [MAT135 小问发布记录](releases/staging-2026-10-26-mat135-multipart.json)。本次不增加数据库迁移，也未改动原生 UI 或 Mac 下载包。

此前 MAT102 小问功能源码为 `e4ab470a`，Railway 发布 `8da11be7` 已成功，`multipart` 题型迁移已执行。MAT102 已原地整理 48 道大题为 112 个独立小问，题目总数仍为 252；原有 24 本讲义、22 份原始资料及其他 204 道题保持不变。分小问的宽窄屏布局、独立提交判分、中英文切换及原有重置/答案确认已验证。见 [本次小问发布记录](releases/staging-2026-10-26-multipart.json)。此前答案功能记录仍见 [题目答案发布记录](releases/staging-2026-10-26-problem-solutions.json)。基线附带发布文档，应用代码与上述运行提交相同。

## 以后从哪里继续

| 用途 | 分支或标签 | 内容 |
| --- | --- | --- |
| 测试服源码基线 | `codex/staging-baseline` | `1c290206` 的应用源码及发布记录，对应 Railway 发布 `15c5dc5a` |
| 上一次发布标记 | `staging/2026-10-25-b8d0b5c6` | 布局修复前的发布，继续保留 |
| 测试服主要发布分支 | `codex/staging-next` | GitHub 是发布源；已授权目标仓库并启用自动部署 |
| 主分支 | `main` | 仍为 `88de1691`，不是当前测试服源码 |

本次题库改动使用 `lecture-language-switch/syntara_production` 工作树与
`codex/mat135-multipart` 任务分支（此前为 `codex/mat102-multipart`），再发布到 `codex/staging-next`。
此前 `chat-visual-hierarchy/syntara_production` 工作目录及其他聊天的未提交工作保持原样。

这两条分支已同步到 GitHub：
[测试服基线](https://github.com/bochendong/syntara_production/tree/codex/staging-baseline)、
[当前开发](https://github.com/bochendong/syntara_production/tree/codex/staging-next)。
`codex/staging-next` 是测试服的主要发布分支，Railway 已连接
`bochendong/syntara_production@codex/staging-next`。本次已从该分支成功部署。账号本人完成身份复核并批准后，已将目标仓库加入 Railway GitHub App
的选择名单，原有三个仓库保持不变；Railway 已显示“Auto deploys when pushed to GitHub”。
已用一次部署记录推送验证：Railway 收到 `c12c7a27`，部署事件 `65e6eec0` 按文档过滤规则
标为 `SKIPPED`，没有替换当前运行版本。构建配置已排除文档和发布记录更新。`codex/staging-baseline` 仍只记录验证通过的线上提交。
`main` 和正式服来源未更改。发布证据见
[staging-2026-10-26-github-source.json](releases/staging-2026-10-26-github-source.json)。
命令行没有写入凭据时，可以继续使用 GitHub Desktop 或 GitHub connector 推送；不要强推覆盖旧分支。
首页、下载页及本次课程头像、私有内容、隐藏恢复和版本发布改动已部署到测试服；后续提交仍需单独构建和验证。

此前课程分层发布从 `staging-work` 明确迁移了相关文件，并补齐权限、私有题号和增量同步边界；源工作区未重置，其他待办继续保留。`codex/course-layers-release` 保留本次发布的独立源码。此前的笔记三列、题库章节墙四列和右侧筛选面板保持在当前基线中。

本次格式、lint、根项目与 App 类型检查、完整构建、Mac 编译及独立数据库迁移/分层运行检查通过。旧 `pnpm native:verify` 仍因内置题库快照的完整性哈希不匹配而失败；该测试和快照与发布前基线相同，详见本次发布记录。新增的隐藏笔记 SQLite 检查已通过。

本次侧栏样式修复保存在 `codex/sidebar-action-alignment`：课程和聊天菜单的省略号共用一列，桌面侧栏调整为 248–320px；课程 hover/键盘聚焦时使用与头像对应的场景和 ImageGen 生成的透明玻璃光纹。手机抽屉宽度和 44px 聊天菜单点击范围保持原样。已检查 1456px、1024px、390px；线上资源哈希、Mac 下载包和菜单图标中心已核对。

新任务使用独立工作树和任务分支。从测试服开始时，选择 `codex/staging-baseline`；
需要后续开发改动时，明确选择 `codex/staging-next`。不要因为某个旧目录更“新”就整体覆盖。

2026-10-26 已整合 GitHub `codex/preview-style-parity` 的 `661d3243`（26 个文件），并删除聊天页右下角的金色星光及四处无用定位规则。
新版做题布局、可拖动分栏、Python 调试、代码草稿、公式参考和图片作答的校验、批改与同步已部署。
根项目和 App 类型、改动格式/lint、完整测试服构建、16 项 Python/草稿/缩进测试和两组图片作答回归通过；
隔离浏览器实际运行 Python 输出“调试验收 5”。线上 8 个资源 SHA-256 与本地构建一致，真实聊天页星光为 0。
图片批改使用模拟模型完成服务回归；本次未重复调用真实 AI 或重新打包 Mac，下载页保留已发布的桌面测试包。
发布记录：[staging-2026-10-26-integration.json](releases/staging-2026-10-26-integration.json)。

## 基线怎样确认

- Railway 服务：`native-api-staging`，环境：`staging`。
- 当前应用发布：`15c5dc5a-c902-4838-97bb-8227537f3f63`，源码提交：`1c290206`。
- 线上原生 JS/CSS 与本次本地验证构建的 SHA-256 一致；本次发布记录包含资源哈希。
- 旧基线 `a5849b24` 和 `staging/2026-10-24-7dbd3393` 标签继续保留。
- 测试服直接拉取 GitHub 的 `codex/staging-next`，使用 `railway.toml` 的 `staging` 覆盖配置；不再依赖本机源码快照上传。
- 前次侧栏菜单对齐、宽度和头像 hover 背景：[staging-2026-10-25-sidebar-hover.json](releases/staging-2026-10-25-sidebar-hover.json)。
- 前次课程头像、课程分层与版本发布：[staging-2026-10-25-course-layers.json](releases/staging-2026-10-25-course-layers.json)。
- 数据库已执行 48 个迁移；前次发布核对为 27 门课程、174 本笔记、2,532 道题。本次做题页整合与星光移除没有数据库结构迁移。
- Mac 测试包已重新编译，下载页当前提供 `20261026T000156Z` 构建（Toronto 10 月 25 日）。
- 前次学习页宽屏发布：[staging-2026-10-25-learning-wide.json](releases/staging-2026-10-25-learning-wide.json)。
- 前次管理员发布：[staging-2026-10-25-admin.json](releases/staging-2026-10-25-admin.json)。
- 前次布局修复：[staging-2026-10-25-layout.json](releases/staging-2026-10-25-layout.json)。
- 上一次功能发布：[staging-2026-10-25.json](releases/staging-2026-10-25.json)。
- 上一次整理记录：[staging-2026-10-24.json](releases/staging-2026-10-24.json)。

本次六组功能与增量发布记录：[staging-2026-10-25-daily.json](releases/staging-2026-10-25-daily.json)。
从保存的 `staging-work` 快照逐项迁入 33 个发布文件，并补了语音自动停止清理；原工作区的
49 个差异文件经哈希核对未变。保留此前权限、私有题号、发布锁、增量同步与侧栏样式修复。
公有题现在只读，学员不能隐藏、删除或复制；公有笔记继续支持隐藏、恢复和复制到私有层。
宽屏新增全屏做题弹窗，修复 Python `>>>`、公式、代码与小问；侧栏课程去校区，商城保留校区。

本次完整网页构建、根项目和 App 类型检查、改动文件格式/lint、Mac 编译签名、Rust 平台检查、
Realtime/渲染回归和独立数据库运行检查通过。填空题静态契约检查在未改动基线同样失败，
已保存对照证据；没有据此宣称所有历史测试通过。语音使用合成音频收到 13 次实时增量和最终文字，
另验证了两分钟自动停止与重复清理；真实麦克风授权及硬件 WebRTC 链路仍待真机验证。
本次没有数据库结构变更；独立测试 schema 和临时 TCP 代理已清理。

## 本次已部署

- 宽屏笔记三列、题库章节墙四列；章节内答题卡在左，统计和筛选在右侧 280px 玻璃面板。
- 测试服管理员后台 `/admin`，沿用经用户确认的正式服管理员邮箱和密码；独立的测试服数据库和会话签名。
- 修复多张动态学习卡片的宽屏比例和聊天区留白；1512px 窗口下卡片约 302px，正文与输入框保持对齐。

- 头像、首页文案、日历日期传递、笔记/题库上传入口及 Realtime 边说边出字（连接失败时回退录音后转文字）。
- 新手引导、官方「使用教程」课程，以及课程的新聊天、编辑、删除菜单。
- 笔记书架与章节阅读，新题库章节墙、题号弹珠、筛选和答题页。
- 首页「下载桌面版」、`/download` 和实际 Mac 安装包下载接口。
- Mac Apple Silicon 测试包：45.9 MiB，macOS 14+，未经过 Apple 公证。

源码来自 `codex/staging-work` 的 `e96a603d` 及其 62 个工作文件，均先保存快照，
再按文件集成到 `codex/staging-next`；保留了原有下载入口和聊天布局修复。
源工作树及 `.claude-transfer/`、`Claude outputs/` 保留，不将临时归档作为发布源码。

Mac ZIP 和清单仍在 `.data/desktop-releases/`，不进入 Git；安装包已保存到
[GitHub Release](https://github.com/bochendong/syntara_production/releases/tag/staging-desktop-20261026-000156)。
`scripts/deploy/desktop-release.json` 固定文件、下载地址、大小和 SHA-256，测试服构建会运行
`restore-desktop-release.mjs` 取回并验证，再构建网站；失败时终止构建，保留上个线上版本。
打包和更新清单的方法见 [desktop-downloads.md](api/desktop-downloads.md)。

Realtime 已接入并用合成语音验证服务端增量转写。实际设备麦克风授权与 WebRTC 音频采集仍待真机验证。

## 其他工作目录

下面的数量是 2026-10-24 整理开始时的历史状态，已先备份并校验。
原始目录只同步已验证的工作区状态工具和提交保护，具体文件与哈希记入本地 registry。

| 工作目录/分支 | 状态 | 后续处理 |
| --- | --- | --- |
| 原始 `codex/shared-wip-2026-10-21` | 268 个已跟踪改动、672 个新文件；来源混合 | 历史保留区，逐项审查，不能整体当作发布源 |
| `codex/pull-latest` | 82 个未提交文件；其中 73 个与测试服相同、7 个不同、2 个为临时归档 | 保留原件；7 个差异需要单独审查，远程跟踪已纠正为 `origin/codex/pull-latest` |
| `codex/store-responsive-cards` | 1 个未提交 CSS 文件 | 保留旧任务；卡片响应式和 hover 修复已在基线中，不整体覆盖 |
| `codex/native-google-staging` | 源码无未提交改动，28 个 QA 图片/记录 | 保留历史发布和验收证据 |
| `codex/cross-computer-sync` | 工作区干净，独立提交已在其远程分支 | 保留工具协作改动，未自动合并进测试服基线 |

`pull-latest` 的 7 个不同文件：

```text
app/store/courses/store.module.css
apps/native/src/components/CourseWorkspace.tsx
apps/native/src/components/LearningEmptyState.tsx
apps/native/src/components/StorePage.tsx
apps/native/src/components/store-page.css
apps/native/src/main.tsx
apps/native/src/styles.css
```

差异包含测试服已经修正的单处选中背景、学习记忆布局、商城分类和聊天样式。
“不同”不代表有应该合并的新功能。新增临时归档 `.claude-tmp/cal.tgz` 和
`.claude-tmp/native-src.tgz` 也已保存，不作为发布源码自动提交。

## 备份与检查

在 Git 公共目录下：

```text
codex/checkpoints/staging-reconcile-20261024/
  manifest.json
  verification.json
  refs-before.txt
  registry-before.json
  <工作目录>/manifest.json
  <工作目录>/staged.patch
  <工作目录>/unstaged.patch
  <工作目录>/untracked.tar.gz
  desktop-release/
  reconciled-branches.bundle
```

所有 6 个工作目录的已跟踪改动都用独立临时索引验证可重放，新文件归档逐项校验。
密钥、数据库、依赖及构建缓存不进入这些源码归档，留在原位置；本次没有清理或移动它们。
原分支起点另保存在 `refs/archive/staging-reconcile-20261024/chat-visual-hierarchy`。

`reconciled-branches.bundle` 保存本次基线、开发分支和发布标签的新提交；同一文件另存于
「下载」目录 `Syntara-branch-checkpoint-20261024.bundle`。它是以 `88de1691` 为前提的增量包，
导入前需要有该版本的仓库，不能作为完整仓库直接克隆。可以在已有仓库中先运行
`git bundle verify <文件路径>`，再按需要导入到新的分支，避免覆盖正在使用的工作区。

恢复时创建独立工作树，检出对应清单的 `baseCommit`，依次应用非空的
`staged.patch`（`git apply --index`）、`unstaged.patch`，再解压新文件归档并核对哈希。
不要覆盖正在使用的目录。

日常查看：`pnpm workspace:status`。源码比较：

```sh
git log --oneline codex/staging-baseline..codex/staging-next
git diff --stat codex/staging-baseline...codex/staging-next
```

发布后记录实际部署 ID、源码提交和验证结果，再更新基线。当前开发目录保持有提交可追踪，
不要再用未提交工作树直接代表一个没有记录的“线上版本”。

本次发布证据位于 Git 公共目录 `codex/tasks/staging-feature-release-20261025/`，
包含源工作树快照、合并说明、构建日志、线上核验、安装包元数据和验收截图。

2026-10-25 的比例修复在 `codex/learning-rail-proportions` 单独提交，再快进合入开发分支。
验证了 390、1024、1100、1280、1456、1920px 屏宽，以及复习计划卡片的出现与消失；
真实测试服 1512px 窗口的卡片从 216px 恢复为约 302px，无横向溢出。
这次只发布网页版 CSS；现有 Mac 安装包继续保留。证据位于 Git 公共目录
`codex/tasks/learning-rail-proportions-20261025/`。

测试服后台说明见 [staging-admin.md](api/staging-admin.md)。管理员发布在
`codex/staging-admin` 单独提交，再快进合入开发分支；正式服配置未更改。
发布证据位于 Git 公共目录 `codex/tasks/staging-admin-20261025/`，只记录验证结果，
不记录密码、签名密钥或完整 API Key。

学习页宽屏增量只从 `staging-work` 按三个文件迁入，保留当前题库的状态重置和回调修复，
其他未提交工作未混入。变更单独保存在 `codex/learning-pages-wide`，再快进合入开发分支。
在 1456px 本机多章节样例中验证三列笔记、四列章节墙、左右答题卡布局；
真实测试服 1512px 窗口下验证了三列笔记和 280px 右侧面板，空题库也正常。
当前真实 CSC108 题库只有一章，四列章节墙使用多章节本机样例验证；线上资源哈希与验证构建一致。
证据位于 Git 公共目录 `codex/tasks/learning-pages-wide-20261025/`。

本次 MAT102 小问整理按文件迁入 `staging-work` 中 43 个相关源文件，并补充了当前测试版答案快照、双语与图片作答的兼容。原工作区没有提交或覆盖。14 项相关离线测试、类型、格式/lint 和构建通过；既有导入编译器检查的代码题测试夹具缺少 sampleIO，在发布前同一实现上复现失败，详见发布记录。实际分批应用了 A/B/H 三套相关题及其余改动，回读校验完整，重放 48 项全部 unchanged。
