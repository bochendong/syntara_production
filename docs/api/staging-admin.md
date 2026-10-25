# 测试服管理员后台

入口：[测试服管理中心](https://native-api-staging-staging-95a1.up.railway.app/admin)。

使用与正式服相同的管理员邮箱和密码。此次已按用户确认复用既有凭据，
但测试服拥有自己的会话签名密钥；两个环境的管理员会话不能互相替代。
密码后续如有修改，需要在各环境分别更新，不会自动同步。

## 环境和权限

- 服务：`native-api-staging`，环境：`staging`。
- 数据库：已核对服务的 `DATABASE_URL` 指向 `staging-postgres`。
- 页面、登录和管理 API 都使用测试服同一域名，不转发到正式服。
- 登录页和管理中心显示“测试服”，并提供返回 `/test/app` 的入口。
- 管理接口继续由 `requireAdmin` 校验。普通 Google 测试账号不会因此自动获得管理员权限。
- `/admin/mock` 在测试服仍被关闭。

Railway 环境配置需要保留 `ADMIN_LOGIN_EMAIL`、`ADMIN_LOGIN_PASSWORD`、
`ADMIN_LOGIN_SECRET` 和 `ADMIN_EMAILS`。密钥和密码只保存在环境配置中，
不能写入源码、发布 JSON、日志或安装包。

## 已验证

- 原管理员邮箱和密码登录成功，错误密码被拒绝。
- 登录 Cookie 设置了 HttpOnly、Secure 和 SameSite=Lax。
- 未登录访问模型、课程、学生、用量和服务商管理接口均被拒绝。
- 管理员登录后，模型配置、课程、老师、学生、用量、服务商、限额和激活码读取正常。
- 浏览器实际打开模型设置、课程管理、用量明细，并验证返回测试版入口。
- 当前 API Key 配置可读取，来源为测试服环境变量；验证中没有更改模型配置。
- 聊天布局资源和现有 Mac 下载包继续保留。

版本与证据见 [staging-2026-10-25-admin.json](../releases/staging-2026-10-25-admin.json)。
