# 上传整理好的课程题库

复用已有结构化 draft schema、`createCourseProblemsFromDraftsWithSummary`、课程章节与 import-batch store。新入口 `POST /api/native/v1/course-problem-imports` 接收已审查的题目，无须重新 AI 提取，不创建或修改任何讲义。普通日常上传通过 HTTPS 和当前账号完成，不依赖 Railway SSH。

## 日常操作

账号必须是课程真实所有者、已有全站管理员，或具有明确未到期的本课程题库导入授权。管理员规则与原 `requireAdmin` 相同：数据库 `role: ADMIN`，或已有 `ADMIN_EMAILS` / `ADMIN_USER_IDS`。服务器仅从已认证 principal 的用户 ID 读取数据库身份；请求正文不能指定 owner、管理员身份、grant 或维护身份。单纯 enrolled 学生返回 403；上传不修改角色或 allowlist。

认证复用 [Native device authorization](./native-staging.md) 的登录、浏览器确认、token/refresh 流程。将 access token 保存到仅本人可读的 UTF-8 文件，或明确指定的环境变量。不要在命令行、manifest、聊天或收据中放 token。CLI 不加载环境文件。

```sh
# 默认只读服务器预览；核对私有 receipt 的章节、数量、难度和题型。
node scripts/learn/import-course-problems.mjs \
  --origin https://native-api-staging-staging-95a1.up.railway.app \
  --manifest /absolute/private/questions.json \
  --token-file /absolute/private/native-access-token \
  --receipt /absolute/private/questions.preview.json

# 同一文件显式提交。提交前重新预览，提交后核对保存的题面、答案、评分、来源和章节。
node scripts/learn/import-course-problems.mjs \
  --origin https://native-api-staging-staging-95a1.up.railway.app \
  --manifest /absolute/private/questions.json \
  --token-file /absolute/private/native-access-token \
  --receipt /absolute/private/questions.commit.json \
  --apply
```

可用 `--token-env SYNTARA_IMPORT_TOKEN` 代替 `--token-file`。CLI 限制 HTTPS（本地测试可 loopback HTTP），不跟随重定向，不打印 token、请求头或服务器原始错误。收据含完整 grading 和来源，按 0600 保存，应放在私有目录。401 需要重新登录/刷新 token；403 应由课程所有者、已有管理员或已获本课程导入授权者上传。

## 后台凭据与课程导入授权（默认禁用）

服务器支持受管环境变量 `SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS`。没有配置时完全禁用；配置应由实际授权者审查、批准后按目标环境部署，开发代码不会自动启用或修改环境。每条绑定一个真实 userId 和 courseId；`courseId:"*"` 是已明确授权的全课程后台范围。可用 `keyId` 精确绑定 native device session（刷新 access token 后 session ID 保持不变）；客户端不能通过请求正文指定此身份。capability 可为仅题库的 `append-reviewed-problems`，或同时追加题库和 Markdown 讲义的 `append-reviewed-course-materials`。必须有唯一 grantId 和明确 UTC 到期时间。

本机后台推荐绑定设备 session；浏览器如需单门课程上传，可配置另一条只绑定 `browser-session` 与该课程 ID 的记录。下面仅为配置结构示例，实际身份和一年期限由受管部署配置提供：

```json
[
  {"grantId":"BACKEND_DEVICE_OPERATION","userId":"EXACT_AUTHENTICATED_USER_ID","keyId":"EXACT_NATIVE_DEVICE_SESSION_ID","courseId":"*","capability":"append-reviewed-course-materials","expiresAt":"2027-10-26T00:00:00Z"},
  {"grantId":"BROWSER_ONE_COURSE_OPERATION","userId":"EXACT_AUTHENTICATED_USER_ID","keyId":"browser-session","courseId":"EXACT_COURSE_ID","capability":"append-reviewed-problems","expiresAt":"2027-10-26T00:00:00Z"}
]
```

示例时间必须换成实际批准的期限。过期、跨课程、跨用户、keyId 不匹配、非法 JSON、未知能力或重复/歧义匹配都拒绝。HTTP 不能提供 grant；服务器以 native principal、服务器受管配置和当前课程 owner 构造内部 authority，写入事务前再次检查到期时间。只能追加已审查内容，既有内容冲突仍拒绝；不能编辑/删除旧题或旧讲义。题库入口不允许绑定 notebook 或调用 legacy backfill。Course.ownerId、enrollment 和用户 role 保持原值，不授予全站 ADMIN。审计保留真实 actor userId/keyId、实际 courseId、scopeCourseId、原 dataOwnerId、grantId、能力和到期时间。撤去环境配置、撤销设备 session 或到期即停止后续导入，不影响已保存内容的原所有者。未配置 keyId 的旧单课程授权仍按显式 user/course 规则工作。

后台 CLI 可使用本机 0600 credential-file 自动刷新 token；题库命令新增 `--credential-file FILE` 与 `--list-courses`。`GET /api/native/v1/course-problem-imports?limit=100&cursor=...` 仅对有匹配 keyId 的 wildcard grant 或已有管理员开放，返回 `{courses,nextCursor,actor,capabilities}`。每门课含 `id,name,organization:{id,name}|null,notebookCount,problemCount,publishedProblemCount,updatedAt`，不含学生、用户或 owner 身份数据。普通 owner/enrolled 的单课权限不开放全部目录。后台可据目录精确选择 courseId，再调用原题库预览/提交。共享讲义见 [后台共享讲义上传](./ai-course-shared-material-upload.md)。

## Manifest 与章节

```json
{
  "version": 1,
  "courseId": "EXACT_COURSE_ID",
  "idempotencyKey": "mat102-reviewed-midterm-a-v1",
  "chapters": [{ "ref": "sets", "name": "Sets" }],
  "items": [{
    "chapterRef": "sets",
    "draft": {
      "draftId": "mock-a-q1",
      "title": "Mock A · Question 1",
      "type": "proof",
      "status": "published",
      "source": "pdf",
      "points": 100,
      "tags": ["Mock A", "sets"],
      "difficulty": "medium",
      "publicContent": {
        "type": "proof",
        "taskKind": "proof",
        "responseKind": "long_text",
        "stem": "Prove that $A \\cap B \\subseteq A$."
      },
      "grading": {
        "type": "proof",
        "referenceProof": "Let $x \\in A \\cap B$. Then $x \\in A$.",
        "rubric": "Use the definition of intersection and conclude the inclusion.",
        "rubricCriteria": [{ "id": "argument", "description": "Correct element argument and conclusion.", "points": 100 }]
      },
      "sourceMeta": { "file": "MockA.pdf", "page": 1, "question": "1", "sourceSha256": "SOURCE_SHA256" },
      "validationErrors": []
    }
  }]
}
```

每个 item 必须显式引用一个声明的章节 ref；所有 draftId 唯一。章节可给 `id` 精确选现有记录，并同时核对 courseId 与 name；未给 id 时按当前课程内相同 name 复用，否则提交时创建。现有章节不改名、不移动、不覆盖说明。章节数量最多 100。

单个 API 批次最多 100 题、正文最多 2 MB。CLI 可接收更大 manifest，按原顺序稳定拆为 100 题一批，key 后加 `:part:1`、`:part:2`；CLI 的基础 key 限 8–130 字符。重试必须保持文件顺序、内容和 key 不变。全部批次先完成只读预览，再逐批事务提交；多个批次不是一个跨批事务。也可为每套模拟题各准备一个 manifest/key。

题目复用 [现有 draft schema](../../lib/problem-bank/schema.ts)，难度为 `easy|medium|hard`，类型支持 `choice|proof|short_answer|calculation|fill_blank`。未经预检的 code、secretJudge 和 code_token 填空拒绝导入；测试服执行题的独立 runner 验证流程见文末。课程题目沿用统一 100 分制；原卷分数应保存在 sourceMeta。证明/简答必须有完整参考答案及任务专属 rubric，结构化 rubricCriteria 总和必须为 100。题面、grading、draft 类型必须一致，validationErrors 必须为空。已审查内容按 schema 和实际 Markdown 结构校验，不再运行 AI 抽取启发式清理，保留真值表构造任务、题内定义和合法 Markdown 表格。批量持久化使用仅服务器内部的 preservePreparedContent 模式，仍保留结构、评分与状态检查；原 AI 抽取导入路径保持原有清理规则。请求不能设置该内部模式。

题目去重沿用现有课程题面内容 key。相同 key 仅在题名、题型、状态、难度、标签、题面、grading、来源和章节完全一致时复用；不同则 409，不覆盖任何题目。仅改变来源或新建 idempotencyKey 不会绕过内容冲突。源文件及审查证据保留本机，manifest 记录其 SHA-256；本接口不上传原 PDF。

## HTTP 预览与提交

请求为 `{mode:"preview",data:MANIFEST}`；成功返回标准 `{success:true,request_id,data}`。preview 完全只读，包含 `batchId`、schema 校验后内容的 `payloadHash`、`course`、真实 `actor`、章节 create/reuse 计划、`itemCount`、`difficultyCounts:{easy,medium,hard}`、`typeCounts` 与 `createsNotebooks:0`。

提交为 `{mode:"commit",data:MANIFEST,expectedHash:PREVIEW_HASH}`。hash 不符返回 409。成功返回持久化收据、insert/reuse ID、完整逐题读回和 `replayed`。相同 key 绑定相同规范化 manifest；不同内容同 key 返回 409。批次租约和写入结果由已有 batch store 记录；若网络中断，以完全相同文件重跑会读回已提交结果，不重复创建。运行中请求返回 409，等待原请求完成后再用同一文件核对。已有不同内容需要独立审查的编辑流程，本接口没有 overwrite 开关。

curl 可从仅本人可读的 config 文件读取授权头，避免 token 出现在命令参数；该 config 使用 curl 的 `header = "Authorization: Bearer TOKEN"` 格式，应由本机认证流程安全写入并设为 0600。下面命令不含 token 值：

```sh
jq '{mode:"preview",data:.}' /absolute/private/questions.json > /absolute/private/preview-request.json
curl --fail-with-body --silent --show-error \
  --config /absolute/private/curl-auth.conf \
  --header 'Content-Type: application/json' \
  --data-binary @/absolute/private/preview-request.json \
  https://native-api-staging-staging-95a1.up.railway.app/api/native/v1/course-problem-imports \
  > /absolute/private/preview-response.json

jq --slurpfile preview /absolute/private/preview-response.json \
  '{mode:"commit",data:.,expectedHash:$preview[0].data.payloadHash}' \
  /absolute/private/questions.json > /absolute/private/commit-request.json
curl --fail-with-body --silent --show-error \
  --config /absolute/private/curl-auth.conf \
  --header 'Content-Type: application/json' \
  --data-binary @/absolute/private/commit-request.json \
  https://native-api-staging-staging-95a1.up.railway.app/api/native/v1/course-problem-imports \
  > /absolute/private/commit-response.json
```

浏览器上传入口可复用相同 native API 和既有 browser authentication cookie。不要把答案、rubric 或 token 输出到公开日志。内容上传成功不等于题目质量验收；来源逐题对照、答案证明、评分标准和数学呈现由准备阶段单独验收。

## 明确授权的 staging 运维

`import-course-problems-operator.mjs` 是一次明确授权运维的入口，日常使用上面的 native API。它校验固定 Railway project/environment/service ID、`staging` 环境名、`native-api-staging` 服务名、deployment ID 和 `staging-postgres.railway.internal` 数据库主机。数据 owner 保持原 Course.ownerId；operator 记录为 Railway 管理身份，与用户身份分开。它不伪造登录、不提升角色，不直接创建 question，所有题目业务仍经同一导入 service、批次租约与原批量写入服务。

可将受审源码放在独立临时目录，使用 `/app` 已部署依赖，不覆盖 live 源码：

```sh
node /tmp/reviewed-import/scripts/learn/import-course-problems-operator.mjs \
  --workspace /app --library-root /tmp/reviewed-import \
  --manifest /tmp/reviewed-import/private/mock-a.json \
  --expected-owner-id EXACT_REVIEWED_OWNER_ID \
  --receipt /tmp/private-receipts/mock-a.json
# 核对只读 preview 后，在同一明确选定的运维环境增加 --apply。
```

临时包必须包含两个 CLI 和以下八个 TS 文件，按仓库相对路径摆放：`course-problem-import.ts`、`course-problem-import-operator.ts`、`course-problem-import-admin.ts`、`course-problem-import-grant.ts`、`admin-identity.ts`、`course-code-preflight.ts`（均位于 `lib/server`），以及 `lib/server/notebook-problems/service.ts`、`import-batch-store.ts`。jiti 为这八个模块设精确 overlay，原 bulk service 的 judge/normalize 依赖回退 `/app`；不复制整个 working tree、原 PDF、token 或 SSH 私钥。

CLI 保存这些源码和 manifest 的哈希、操作者、数据 owner、全量私有前后读回；核对原全部 notebook 正文/版本哈希和旧 question 哈希不变。新题写入后刷新课程汇总并增加课程 contentVersion；同批次重放不增加版本。现有讲义不创建、不修改。native API 日常入口需要将该路由与服务正常集成部署；独立运维包可提前调用同一受审业务，无须覆盖其他正在部署的工作。

## 离线验证

```sh
node --test scripts/learn/import-course-problems.test.mjs
```

覆盖 owner/admin/enrolled 授权、默认关闭/过期/跨课程/伪造 grant 拒绝、跨课程章节、同批重放、不同内容冲突、证明字段和来源/难度/章节读回、真实 native handler 鉴权分支、HTTP 认证失败/瞬时重试，以及独立八文件 source overlay 加载。测试只使用内存假库和 loopback HTTP，不写真实数据库，不代表实际 staging 上传已经完成。

## 测试服代码题预检与写入

`POST /api/native/v1/course-code-preflight` 在 staging 接受 `{courseId,draft,counterexamples:[{id,code,reason}]}`。调用者必须有该课程的现有导入授权；请求不能自定 owner、身份或授权。只支持 Python，至少 1、最多 2 个有代表性的错误实现。服务端用隔离 Python 判题器验证参考答案、样例、空实现及错误实现，不写题目、作答、学生进度或计费记录。参考答案必须通过；空实现和错误实现必须因测试失败而被拒绝，运行器故障不算成功预检。

```sh
node scripts/learn/course-code-preflight.mjs \
  /absolute/private/code-question-input.json \
  ~/.config/syntara/staging-backend.json \
  /absolute/private/code-question-preflight.json
```

结果含 `valid`、`checkedBy:python-runner`、`courseId`、`draftFingerprint`、`referencePassed`、`starterRejected`、`incorrectRejected`、`validatedDraft` 和成功时的 `proof`。保存完整私有收据，使用返回的 `validatedDraft` 原样填入 import manifest 的 item.draft，并将 proof 填入该 item 的 `codePreflight`。之后仍使用本文的只读预览与 `--apply`，章节、去重、幂等与逐题读回流程保持相同。

预检证明由服务端签名，绑定题目全部内容（包括隐藏测试）、课程、用户及设备 session，有效 24 小时。任何内容更改、跨课程或跨设备都需要重新预检；proof 不能替代登录和当前课程授权。不要把证明或私有收据公开。当前只有 staging 接受执行题，production 的预检路由关闭；未通过预检的 code、secretJudge 仍拒绝写入。公开读取接口不会因此获得隐藏测试。
