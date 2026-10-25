# 分支与测试服状态

核对日期：2026-10-25（America/Toronto）。当前测试服已更新，源码基线与实际部署对应。

## 以后从哪里继续

| 用途 | 分支或标签 | 内容 |
| --- | --- | --- |
| 测试服源码基线 | `codex/staging-baseline` | `e1991eeb`，对应 Railway 发布 `46569731` |
| 上一次发布标记 | `staging/2026-10-25-b8d0b5c6` | 布局修复前的发布，继续保留 |
| 当前开发 | `codex/staging-next` | 当前发布代码 + 后续发布记录 |
| 主分支 | `main` | 仍为 `88de1691`，不是当前测试服源码 |

当前开发仍在本次聊天原来的 `chat-visual-hierarchy/syntara_production` 工作目录。
目录名未改变，分支已改名为 `codex/staging-next`，避免中断正在运行的本地预览。

这两条分支已同步到 GitHub：
[测试服基线](https://github.com/bochendong/syntara_production/tree/codex/staging-baseline)、
[当前开发](https://github.com/bochendong/syntara_production/tree/codex/staging-next)。
命令行没有写入凭据时，可以继续使用 GitHub Desktop 的登录推送；不要强推覆盖旧分支。
首页、下载页及本次课程头像、私有内容、隐藏恢复和版本发布改动已部署到测试服；后续提交仍需单独构建和验证。

本次从 `staging-work` 明确迁移了相关文件，并补齐权限、私有题号和增量同步边界；源工作区未重置，其他待办继续保留。`codex/course-layers-release` 保留本次发布的独立源码。此前的笔记三列、题库章节墙四列和右侧筛选面板保持在当前基线中。

本次格式、lint、根项目与 App 类型检查、完整构建、Mac 编译及独立数据库迁移/分层运行检查通过。旧 `pnpm native:verify` 仍因内置题库快照的完整性哈希不匹配而失败；该测试和快照与发布前基线相同，详见本次发布记录。新增的隐藏笔记 SQLite 检查已通过。

新任务使用独立工作树和任务分支。从测试服开始时，选择 `codex/staging-baseline`；
需要后续开发改动时，明确选择 `codex/staging-next`。不要因为某个旧目录更“新”就整体覆盖。

## 基线怎样确认

- Railway 服务：`native-api-staging`，环境：`staging`。
- 当前发布：`46569731-1777-401f-8a89-21f0f1fe664d`，源码提交：`e1991eeb`。
- 发布快照包含 3,139 个 Git 源码文件；线上原生 JS/CSS 与本地验证构建的 SHA-256 一致。
- 旧基线 `a5849b24` 和 `staging/2026-10-24-7dbd3393` 标签继续保留。
- `railway.toml` 没有上传，测试服构建、启动和迁移配置由 Railway 管理；临时资源恢复命令已恢复为正常构建命令。
- 本次课程头像、课程分层与版本发布：[staging-2026-10-25-course-layers.json](releases/staging-2026-10-25-course-layers.json)。
- 数据库第 48 个迁移已执行；测试服仍有 27 门课程、174 本笔记、2,532 道题，与发布前一致。
- Mac 测试包已重新编译，下载页当前提供 `20261025T202615Z` 构建。
- 前次学习页宽屏发布：[staging-2026-10-25-learning-wide.json](releases/staging-2026-10-25-learning-wide.json)。
- 前次管理员发布：[staging-2026-10-25-admin.json](releases/staging-2026-10-25-admin.json)。
- 前次布局修复：[staging-2026-10-25-layout.json](releases/staging-2026-10-25-layout.json)。
- 上一次功能发布：[staging-2026-10-25.json](releases/staging-2026-10-25.json)。
- 上一次整理记录：[staging-2026-10-24.json](releases/staging-2026-10-24.json)。

## 本次已部署

- 宽屏笔记三列、题库章节墙四列；章节内答题卡在左，统计和筛选在右侧 280px 玻璃面板。
- 测试服管理员后台 `/admin`，沿用经用户确认的正式服管理员邮箱和密码；独立的测试服数据库和会话签名。
- 修复多张动态学习卡片的宽屏比例和聊天区留白；1512px 窗口下卡片约 302px，正文与输入框保持对齐。

- 头像、首页文案、日历日期传递、笔记/题库上传入口及录音后转文字按钮。
- 新手引导、官方「使用教程」课程，以及课程的新聊天、编辑、删除菜单。
- 笔记书架与章节阅读，新题库章节墙、题号弹珠、筛选和答题页。
- 首页「下载桌面版」、`/download` 和实际 Mac 安装包下载接口。
- Mac Apple Silicon 测试包：44.8 MiB，macOS 14+，未经过 Apple 公证。

源码来自 `codex/staging-work` 的 `e96a603d` 及其 62 个工作文件，均先保存快照，
再按文件集成到 `codex/staging-next`；保留了原有下载入口和聊天布局修复。
源工作树及 `.claude-transfer/`、`Claude outputs/` 保留，不将临时归档作为发布源码。

Mac ZIP 和清单在当前目录的 `.data/desktop-releases/`，本次部署单独携带了这两项。
它们不进入 Git；后续部署必须继续携带安装包，或接入持久存储，不能只推送源码。
打包方法见 [desktop-downloads.md](api/desktop-downloads.md)。

真机麦克风授权及实际转写仍待验证。语音保留录音后转写，未切换 Realtime。

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
