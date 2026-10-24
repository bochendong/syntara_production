# 分支与测试服状态

核对日期：2026-10-24（America/Toronto）。本次整理只保存源码和本地状态；测试服仍运行原发布。

## 以后从哪里继续

| 用途 | 分支或标签 | 内容 |
| --- | --- | --- |
| 测试服源码基线 | `codex/staging-baseline` | `a5849b24`，对应 Railway 发布 `7dbd3393` |
| 固定发布标记 | `staging/2026-10-24-7dbd3393` | 与基线相同，不移动已有标签 |
| 当前开发 | `codex/staging-next` | 基线 + 尚未部署的首页文案、下载页与整理工具 |
| 主分支 | `main` | 整理时为 `88de1691`，比测试服少本次集成的 83 个文件改动 |

当前开发仍在本次聊天原来的 `chat-visual-hierarchy/syntara_production` 工作目录。
目录名未改变，分支已改名为 `codex/staging-next`，避免中断正在运行的本地预览。

这两条分支和发布标签目前只在本机保存。Git 命令行没有可用的 GitHub HTTPS 写入登录，
SSH 也未获授权，本次远程同步未完成。完成登录后，用普通推送同步，不能强推覆盖旧分支：

```sh
git push --atomic origin codex/staging-baseline codex/staging-next staging/2026-10-24-7dbd3393
```

新任务使用独立工作树和任务分支。从测试服开始时，选择 `codex/staging-baseline`；
需要首页和下载页时，明确选择 `codex/staging-next`。不要因为某个旧目录更“新”就整体覆盖。

## 基线怎样确认

- Railway 服务：`native-api-staging`，环境：`staging`。
- 当前发布：`7dbd3393-7837-49cc-a85d-650cf02d8e64`。
- 发布上传快照中的 3,101 个源码文件均按 SHA-256 校验；线上原生 JS/CSS 和商城 CSS 也与发布记录一致。
- 将该快照相对 `88de1691` 的 83 个新增/修改文件单独提交，未混入后续首页和下载页。
- `railway.toml` 当时没有上传，Git 中保留原文件。测试服的构建、启动和迁移配置由 Railway 管理，不能直接用该文件替代。
- 机器可读记录：[staging-2026-10-24.json](releases/staging-2026-10-24.json)。

基线是对已发布集成源码的保存，不按文件名或修改时间推断历史作者。

## 已保存但未部署

- 首页文案和顶部「下载桌面版」入口。
- `/download`、Mac 安装包下载接口，以及安装包元数据、断点续传和校验测试。
- 当前 Mac Apple Silicon 测试包：44.8 MiB，macOS 14+，未经过 Apple 公证。
- 分支说明、工作区状态显示及基线提交保护。

Mac ZIP 和清单仍在当前目录的 `.data/desktop-releases/`，同时已复制到恢复检查点。
它们不进入 Git。后续发布下载页时，还必须提供安装包存储，单独推送源码不会让 ZIP 上线。
打包方法见 [desktop-downloads.md](api/desktop-downloads.md)。

## 其他工作目录

下面的数量是整理开始时的状态，已先备份并校验；业务源码保持不变。
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
