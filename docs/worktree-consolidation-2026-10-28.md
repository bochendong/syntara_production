# 工作树整理（2026-10-28）

审查基准为远端 `codex/staging-next` 的 `ce721660`。用户授权清理工作树并合并适用改动；没有把旧工作树的完整文件覆盖到当前应用。

## 合并结果

- 合并 `codex/cross-computer-sync`：跨电脑交接说明、PR 模板与 CI 首次分支比较起点、Next.js 类型生成。更新了旧文档中的测试服分支，状态入口指向 `docs/branch-state.md`。
- 合并 `codex/staging-code-question-import`：保留新版发布文档，并合入本地数据库隧道退出清理修复。
- 对齐手写、MAT102 系列筛选与新手指引任务的合并历史。这些应用源码已存在于 `ce721660`，没有重复添加功能。
- 本地 `codex/staging-next` 快进到已存在的远端 `ce721660`。本次工具整理保存在 `codex/worktree-consolidation`，不直接更新发布分支。

## 清理范围

以下 12 个工作树先备份并校验，再移除工作目录；原分支保留：

| 工作树目录 | 处置依据 |
| --- | --- |
| admin-bulk-materials | 6 项未提交文件作为待审查旧稿归档 |
| chat-visual-hierarchy | 原提交已合入发布分支，工作目录干净 |
| cross-computer-sync | 已合并交接与 CI 规则 |
| markdown-math-rendering | 原提交已合入发布分支，工作目录干净 |
| mat102-paper-series-tags | 已确认应用源码相同并对齐合并历史 |
| mat102-readings | 原提交已合入发布分支，工作目录干净 |
| native-google-staging | 原提交已合入；本地 QA 素材一并备份 |
| preview-problem-banks | 4 项未提交文件作为待审查旧稿归档 |
| pull-latest | 84 项未提交文件作为待审查旧稿归档 |
| staging-course-crud | 7 项未提交文件作为待审查旧稿归档 |
| staging-work | 169 项未提交文件作为待审查旧稿归档 |
| store-responsive-cards | 1 项未提交文件作为待审查旧稿归档 |

## 保留的工作树

- 原始共享目录：940 项混合未提交文件，继续原地保留。
- 当前 `ipad-handwriting` 目录：本地预览及当前整理工作仍在使用，现使用 `codex/worktree-consolidation` 分支。
- `lecture-language-switch`：有 7 项尚未合并的数学排版改动，保留供继续审查。
- `staging-code-question-import`：本地 Node/Railway 进程仍在使用。
- `restore-onboarding`：Codex 会话进程仍在使用。

## 恢复与验证

本机私有备份目录：`~/.config/syntara/worktree-archives/2026-10-28-consolidation/`。`summary.json` 记录实际完成的清理；各工作树保存 HEAD、暂存/未暂存二进制补丁、完整文件归档、逐文件 SHA-256 及恢复说明。忽略的本地配置和素材也纳入归档，权限受限，不进入 Git。仅排除可重建的 `node_modules`、`.next`、`target`、`.turbo`、`.vite`。

17 项工作树、检查工具及 staging-admin 离线检查通过；修改文件的 Prettier、隧道脚本语法及 Git 差异空白检查通过。没有连接数据库测试隧道启停，没有执行真实 GitHub Actions；本次不改变应用评分逻辑或触发测试服部署。
