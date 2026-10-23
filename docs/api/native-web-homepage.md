# 测试站新版首页

## 来源与范围

从 `27f251045d7149cabd60dcd4dae5fa6a9a771c9d` 继续。依据用户要求，显式迁入共享工作区中已设计完成的 Web landing：`app/page.tsx`、`components/home/landing/` 的 9 个源文件、`public/home/backgrounds-v2/shared.webp` 和 `public/home/backgrounds-v3/hero-starry.webp`。来源线程为「更新首页落地页」和「修复首页旋转星图玻璃珠贴图」；具体文件采用迁入时的共享工作区内容，不依据文件名或时间推定历史作者。

来源逐文件 SHA-256 和修改前的目标入口文件保存在本地 Git 公共元数据 `codex/checkpoints/native-web-homepage-20261022/`。未整体复制共享工作区，未修改其文件、环境配置、依赖清单或原生认证。已有未跟踪 QA 图片保留。

## 入口

- 测试站 `/` 显示星空、玻璃弹珠与分屏介绍的新首页，不再直接跳转登录。
- 测试站首页三个按钮均指向 `/test`，文案为 Google 登录体验；登录成功仍进入现行 `/test/app`。
- 正式模式组件保留已有 SpeedUp 登录文案和 `/login` 目标。此次仅部署 Railway staging。
- `/test/app` 继续使用当前聊天、总日历和新版我的；不恢复已退役的旧侧栏、旧首页或安装包。
- 只公开首页，原生 API 的 Google 账号、同源写入及账号隔离要求保持不变。

## 验证

已通过迁入文件的格式与 ESLint 检查、素材和相对导入检查、staging 源码守卫及 3 项浏览器访问/传输/存储离线测试。staging 浏览器包、Next.js 生产构建（含完整 TypeScript）和 Python 构建追踪检查通过。

本地生产 HTTP：`/`、`/test`、`/test/app` 和两张背景均为 200；首页三个 CTA 全部指向 `/test`；未登录原生账号和课程接口为 401，旧 Web 入口继续 404。桌面首屏、笔记分屏和 390×844 手机首屏已检查，手机没有横向溢出；首页 CTA 实际进入 Google 登录页，浏览器无 error 日志。

Railway staging 部署 `3a34f568-e221-49e4-85b9-26aaa8f275a4` 已于 `2026-10-23T00:31:08.212Z` 成功；API 与独立 staging 数据库各 1 个运行副本，均无崩溃，待处理部署为空。该部署创建时基于已整合的 `27f25104` 加当时尚未提交的首页快照；后续首页提交保留相同的产品源文件与素材。

线上匿名 HTTP 复核与本地结果一致，根地址返回新首页的 200，而不是重定向；三处 CTA 均为 `/test`。浏览器实际打开新首页，点击 Google 登录体验后，已有 Google 会话经 `/test` 正常进入 `/test/app`，账号仍为 0 门课程。此轮没有新建 Google 身份或调用真实 AI。

线上 1280×900 和 390×844 的首页均已保存证据；手机 `scrollWidth === innerWidth`。浏览器 error 日志为空，临时尺寸已恢复，最终停留网站根地址。

验收截图保存于本机 `Downloads/Syntara-Web-Homepage-20261022/`，含线上桌面首页、手机首页、登录后 App 及本地分屏预览。用户现已授权按上述明确范围提交并推送首页；截图继续保留在本机，不纳入源码。此次 Git 发布不重新部署服务。
