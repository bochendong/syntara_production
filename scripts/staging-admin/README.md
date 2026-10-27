# 测试服课程题目和笔记的本地接口

此工具固定连接 Railway 项目 `syntara-app` 的 `staging` 环境和 `staging-postgres`，不会读取 `.env.local` 中的数据库连接。它在本机通过 Railway SSH 隧道工作，不修改或部署测试服代码。需要 Node 22、pnpm、项目依赖、Prisma client、已登录 Railway CLI 和已注册 Railway SSH 公钥。第一次安装后运行 `pnpm install` 和 `pnpm exec prisma generate`。

在仓库根目录运行：

```sh
pnpm staging:admin
```

保持进程运行。服务只监听 `127.0.0.1:8766`；Railway 隧道监听 `127.0.0.1:15433`。启动器会拒绝占用中的端口，创建权限为 600 的本地随机令牌文件，并在正常退出时删除。若异常终止留下旧令牌，确认服务已停止后删除 `~/.codex/syntara-staging-admin/token`。不要分享令牌；令牌能读取答案及执行写入。不要把服务通过代理暴露到外网。

新终端执行命令行，例如：

```sh
pnpm -s staging:course GET /v1/courses
pnpm -s staging:course GET /v1/courses/COURSE_ID/problems
pnpm -s staging:course GET /v1/courses/COURSE_ID/chapters
pnpm -s staging:course PATCH /v1/courses/COURSE_ID/chapters/CHAPTER_ID chapter.json
pnpm -s staging:course GET /v1/courses/COURSE_ID/notebooks
pnpm -s staging:course GET /v1/courses/COURSE_ID/problems/PROBLEM_ID
pnpm -s staging:course GET /v1/courses/COURSE_ID/notebooks/NOTEBOOK_ID
pnpm -s staging:course POST /v1/courses/COURSE_ID/problems problem.json
pnpm -s staging:course PATCH /v1/courses/COURSE_ID/problems/PROBLEM_ID patch.json
pnpm -s staging:course DELETE /v1/courses/COURSE_ID/problems/PROBLEM_ID delete.json
pnpm -s staging:course POST /v1/courses/COURSE_ID/notebooks notebook.json
pnpm -s staging:course PATCH /v1/courses/COURSE_ID/notebooks/NOTEBOOK_ID patch.json
pnpm -s staging:course DELETE /v1/courses/COURSE_ID/notebooks/NOTEBOOK_ID delete.json
pnpm -s staging:course PUT /v1/courses/COURSE_ID/notebooks/NOTEBOOK_ID/sections sections.json
pnpm -s staging:course PUT /v1/courses/COURSE_ID/notebooks/NOTEBOOK_ID/scenes scenes.json
```

路径中的 ID 必须 URL 编码，例如 `teacher-notebook:abc` 写为 `teacher-notebook%3Aabc`。CLI 以 JSON 输出响应，HTTP 非成功状态会返回非零退出码。CLI 在进程内读取本地凭据；不要把令牌展开到命令行参数。

所有请求必须带本地令牌；带 `Origin` 的浏览器请求会被拒绝。操作范围是课程公有题和课程所有者的笔记，不包含学员私有题或学员私有笔记。题目读取包括参考答案和隐藏测试，妥善保管导出数据。

## 请求体

章节读取返回当前 `updatedAt` 和题目数量。章节改名使用 `{ "expectedUpdatedAt": "读到的 updatedAt", "patch": { "name": "循环与累加器", "description": "章节说明" } }`。它在事务中核对课程和版本，拒绝同课程重名，并推进关联题目的同步时间；不重建章节或题目。

这些工具从 `staging-course-crud` 工作树中已有的本机管理工具逐文件迁入，保留其连接目标和原有 CRUD 行为，补充章节读取、改名和错误响应。未复制该工作树的其他未提交内容。

新增题目使用 `{ "draft": { ... }, "chapterId": null }`，`draft` 使用 [题目 schema](../../lib/problem-bank/schema.ts) 中 `notebookProblemImportDraftSchema`，完整题型要求参照项目的题目上传指南。服务使用现有手动创建逻辑校验题型、内容、答案、去重和发布状态；新题默认草稿。

修改题目使用 `{ "expectedUpdatedAt": "读到的 updatedAt", "patch": { "title": "新标题" } }`。支持 `title`、`status`、`points`、`order`、`difficulty`、`type`（仅支持转成 `multipart`）、`sourceMeta`、`notebookId`、`chapterId`、`publicContent`、`grading`、`secretJudge`；删除题目使用 `{ "expectedUpdatedAt": "读到的 updatedAt" }`。有学生作答的题目会拒绝修改或删除。

本机后台按已审查内容提交，保留 Markdown 的空行、代码和私有答案原文；仍执行 schema、发布要求和参考程序测试。常规应用编辑接口继续沿用原来的格式规范化行为。

新增笔记使用 `{ "name": "标题", "notebookKind": "markdown", "tags": [] }`；也可选择 `image`。笔记元信息修改和删除的请求格式与题目相同，`patch` 支持 `name`、`description`、`tags`、`language`、`style`。

替换 Markdown 章节使用 `{ "expectedUpdatedAt": "读到的 updatedAt", "sections": [{ "title": "标题", "order": 0, "markdown": "正文" }] }`。替换 image 场景使用 `{ "expectedUpdatedAt": "读到的 updatedAt", "scenes": [{ "title": "标题", "type": "slide", "order": 0, "content": {} }] }`。这两个 PUT 是**完整替换**，遗漏的章节或场景会被删除；需要保留原条目时请先 GET 并逐项保留 ID 和内容。已有独立 page 数据的笔记会拒绝替换，以免内容不一致；本工具不提供 page、附件二进制或图片资产的写接口。

写入前检查 `expectedUpdatedAt`，但检查和现有业务函数的写入不是同一个原子操作；**不能防止其他客户端在检查后同时修改**。请避免多人同时编辑，重要修改前备份。笔记替换和删除可能连带删除内容或关联数据，删除操作不可撤销。每次只处理一项；大批量操作需要调用方自行处理错误和重试，不能假设跨请求事务。

写入后会尝试刷新知识投影，如果响应中 `warning` 非空，主要变更已保存但投影未刷新，不要直接重复新增。课程商城的内容发布版本遵循现有应用发布流程，本工具不会替你发布新版或自动将题目草稿设为已发布。
