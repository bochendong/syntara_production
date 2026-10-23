# 跨电脑接续基线

核对日期：2026-10-22（America/Toronto）。这是一次状态快照，接续前必须重新核对 GitHub 分支和提交。任务交接时更新此表，并在对应 PR 中保存记录。

| 对象                          | 已核对状态                                                 | 接续含义                                                                                                 |
| ----------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GitHub 仓库                   | `bochendong/syntara_production`，默认分支 `main`           | 两台电脑使用同一远端                                                                                     |
| `main`                        | `b8f38fa847d74f53182929c1eb9adb5448926bd4`                 | 现有正式基线，尚不包含下面的 App 测试整合                                                                |
| `codex/native-google-staging` | 首页提交 `dcfeff184ad887ea63af2c9303273e1e0d700ad7` 已推送 | 已包含 App 整合与新版 Web 首页，另一台电脑可直接拉取                                                     |
| 同步规则与 CI                 | 本 PR 分支 `codex/cross-computer-sync` 从上述首页提交继续  | 已包含新版首页，并增加本次接续规范、模板和 CI                                                            |
| Railway staging               | 部署 `3a34f568-e221-49e4-85b9-26aaa8f275a4`                | 创建时从 `27f25104` 加首页快照发布；该首页产品源文件和素材已完整纳入 `dcfeff18`，本次 Git 发布不重新部署 |

测试首页：<https://native-api-staging-staging-95a1.up.railway.app/>；Google 登录入口 `/test`；登录后新版 App `/test/app`。测试用户初始没有课程。

## 已发布首页与本 PR 范围

首页提交只包含 `app/page.tsx`、`middleware.ts`、`components/home/landing/` 的 9 个文件、两张 `public/home/backgrounds-v2/shared.webp` / `backgrounds-v3/hero-starry.webp` 及 `docs/api/native-web-homepage.md`。已有未跟踪 QA 图片保留在本机，没有混入源码提交。首页产品文件与已验收部署快照的哈希一致；生产构建、类型检查、匿名鉴权、现有 Google 会话跳转和桌面/手机页面已验收。

本 PR 仅新增或更新 6 个协作/CI 文件：`CONTRIBUTING.md`、`CURRENT_STATE.md`、README 入口、AGENTS 接续要求、PR 模板以及 CI。覆盖所有分支推送及面向测试整合分支的 PR，并修正新分支首次推送的比较起点；在类型检查前显式生成 Next.js 声明，支持全新拉取后的图片与路由类型。未修改部署工作流、数据库或环境文件。

## 另一台电脑从哪里继续

- 只需要已发布的首页与 App：从 `origin/codex/native-google-staging` 接续。
- 要同时拿到本 PR 的同步规则和 CI：从 `origin/codex/cross-computer-sync` 接续；PR 合入后回到测试整合分支。
- 当前机器停止同任务写入，另一台先保留未提交工作，再 fetch / switch / fast-forward pull。具体流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

在另一台电脑全新克隆并从本 PR 开始：

```bash
git clone --branch codex/cross-computer-sync https://github.com/bochendong/syntara_production.git
cd syntara_production
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm exec next typegen
```

使用 Node.js 22、pnpm 10.28.0；按 `.env.example` 单独配置本机环境。生产数据库和密钥不会通过 Git 同步。开始具体新任务时仍按 AGENTS 创建任务 worktree 和分支。

## 当前限制

- 用户已授权本轮首页提交推送及同步规则/CI 的 PR；该授权没有把其他共享工作区改动纳入提交范围。
- 仓库中仍有其他历史开发分支和待合并 PR，不根据名称推断已废弃，也不自动整合。
- 本次核对时 `main` 与测试分支均未标记为 protected。本文是流程约定，不代表 GitHub 已强制保护分支。
- 原共享工作区仍有独立待归属改动，不作为另一台电脑的已同步基线。
- 本地已验证格式、YAML、5 种 CI 比较起点场景，以及独立新工作区安装依赖、生成 Prisma / Next.js 声明后的完整根类型检查。GitHub Actions 结果以本 PR 检查页为准，不能把本地验证当成远端检查成功。
- 正式部署仍保留原触发方式。不要把 `main` 当作两台电脑随手同步的中转站。
