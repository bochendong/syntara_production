# 两台电脑共同开发 Syntara

同一仓库：<https://github.com/bochendong/syntara_production>。两台电脑都以 GitHub 上的分支和提交为接续依据。本地文件、聊天记录和已经上线的网站，不能代替已推送的代码。

## 开工前

先看 [当前基线和未同步事项](CURRENT_STATE.md)，再查看对应任务的 Issue 或 PR，确认这次要做什么、验收标准和目标分支。不要仅凭分支名包含 test、production 或 automatic-deploy 来判断版本。

```bash
git status --short
git branch --show-current
git fetch origin
```

- 当前目录有未提交内容时，先确认来源并保留，不直接切换或覆盖它。
- 使用已确认的任务分支；按 `AGENTS.md` 为新任务创建独立 worktree 和 `codex/<task>` 分支。不要在旧共享工作区开始新功能。
- 从另一台电脑继续同一任务时，使用同一个已推送的任务分支；切换前确认前一台已停止写入。
- 若两台电脑需要同时工作，为两个任务分别建分支，通过 PR 整合。不要同时向同一任务分支推送。

在没有本地改动、且已切到正确任务分支后，使用快进同步：

```bash
git pull --ff-only
```

遇到不能快进时，先比较双方提交，再明确合并方案；不使用强制推送、`reset --hard` 或自动清理来消除差异。

## 每个任务先写清楚

用一个 Issue 或草稿 PR 记录：目标、范围、验收标准、目标分支、正在使用的电脑、当前提交。使用 GitHub 记录接续状态，不依赖某台电脑里的聊天。

一个任务可以跨电脑接续，但同一时刻只由一台电脑负责写入同一任务分支。公共接口、Prisma schema、登录策略和共享组件的变化，应先写明影响范围再并行开发。

## 换电脑前

1. 检查任务差异，只提交本次任务的明确文件；保留其他未完成改动。
2. 运行相关检查。通常使用 `pnpm verify:local` 和实际受影响的功能检查；未验证的行为写清楚。
3. 在获得当前会话的提交授权后提交并推送任务分支。若用户要求先别提交，先保全检查点，并明确说明另一台电脑仍拿不到这些改动。
4. 核对 GitHub 上的提交号等于本机任务提交号。上传成功、工作区干净、网站能打开是三个不同条件，不能混为一谈。
5. 在 Issue 或 PR 中补充以下交接记录，停止这台电脑上的同任务写入，再到另一台继续。

```text
目标：
任务分支：
GitHub 最新提交：
目标整合分支：
已完成：
验证结果和未验证项：
待处理事项：
本机独有、尚未推送的文件：
数据库迁移 / 新增环境变量名（不含值）：
部署环境、部署编号及对应提交：
下一台电脑先做什么：
```

GitHub Desktop 的 Fetch / Pull / Push 也可以完成相同交接；操作后仍要核对分支和提交号。

## 合并与发布

- `main` 是现有默认分支，推送或合并到它可能触发正式部署，不作为随手同步两台电脑的中转站。
- 当前 App / Google 测试站的整合分支为 `codex/staging-next`。任务通过 PR 整合到它；改变整合分支前先更新当前基线文档。
- 同一个 GitHub 用户无法充当自己的另一位审批人。可以用 PR 保留差异、检查和合并记录，不要求虚构第二位审批人。
- 合并前确认 CI、相关运行验证及部署目标。CI 通过不等于真实 Google、数据库和 AI 流程均已验证。
- 发布优先来自已推送的明确提交，记录提交与部署编号。紧急从本地快照部署时，必须标明与远端的差异，并后续补齐提交。
- 旧分支先确认是否已整合以及有没有独有提交，再决定归档；不批量删除或强行覆盖。

环境文件和密钥在两台电脑分别配置，按 `.env.example` 记录变量名。不要提交 `.env.local`、复制生产数据库用于日常开发，或把密钥贴到 Issue / PR。

## 本地工具版本

使用 Node.js 22（`.nvmrc`）和 pnpm 10.28.0（`packageManager`）。新拉取后，在类型检查前运行 `pnpm exec prisma generate` 和 `pnpm exec next typegen`，避免依赖另一台电脑的构建缓存。完整设置与隔离规则见 [AGENTS.md](AGENTS.md) 和 [WORKTREES.md](WORKTREES.md)。

参考：[GitHub 远端同步说明](https://docs.github.com/en/get-started/using-git/getting-changes-from-a-remote-repository)、[工作流触发与分支筛选](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。
