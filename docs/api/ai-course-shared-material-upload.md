# 后台 AI 追加共享 Markdown 讲义

复用 `POST /api/native/v1/materials` 与原 `uploadNativeMaterial` 事务业务，显式使用 `scope:"shared"`。服务器从真实 native principal 的 userId/keyId、课程真实 owner 和受管授权构造内部权限；无需伪造 owner 登录、提升角色或通过 SSH 写库。

有权共享上传的身份为课程真实 owner、已有管理员，或匹配的 `append-reviewed-course-materials` grant。全课程后台 grant 使用 `courseId:"*"` 并绑定本机 native device session keyId；服务器审计实际目标 courseId。授权配置、设备绑定、目录与到期行为见 [题库上传授权](./ai-course-problem-upload.md)。仅题库 `append-reviewed-problems` 授权不能上传共享讲义。

不传 `scope` 的旧 App 上传路径保持不变：普通 enrolled 用户仍写自己的私有笔记，不能因本后台设备获得授权而改变其他浏览器身份的权限。

## 日常 CLI

```sh
# 目录仅允许 wildcard 后台凭据或已有管理员。私有 receipt 保存 ID/名称/机构及公有统计。
node scripts/learn/import-course-shared-lectures.mjs \
  --credential-file /absolute/private/backend-device.json \
  --list-courses --receipt /absolute/private/course-catalog.json

# 准备内容前读取课程语言、章节、全部公有 HardRules 和 active RulePacks。
node scripts/learn/import-course-shared-lectures.mjs \
  --credential-file /absolute/private/backend-device.json \
  --course-context EXACT_COURSE_ID --receipt /absolute/private/course-context.json

# 默认全量只读预览；从 credential 中读取限定 origin，并在每次请求前自动刷新 token。
node scripts/learn/import-course-shared-lectures.mjs \
  --credential-file /absolute/private/backend-device.json \
  --manifest /absolute/private/lectures.json

# 人工或 AI 内容验收通过后显式提交，核对完整正文和语言读回。
node scripts/learn/import-course-shared-lectures.mjs \
  --credential-file /absolute/private/backend-device.json \
  --manifest /absolute/private/lectures.json --apply
```

兼容 `--origin URL --token-file FILE` 或 `--token-env NAME`。不要在命令行传 token 值；credential 文件及完整正文收据均仅本人可读，不放版本库或公开日志。没有逐课程 SSH、数据库维护或账号提权步骤。

课程约束由 `GET /api/native/v1/course-problem-imports?courseId=ID` 提供：data 为 `{course,actor}`，course 含 name/language/description/tags/organization、公有数量、chapters、按 position 排序的原课程 owner HardRules 和 active RulePacks（含 contractJson、sourceRefs、contentHash）。不包含学生学习数据；需要实际课程的 owner/admin/匹配 grant，单课授权不能查询其他课程。先读取并遵守这些约束，再整理、审查和预览。此只读接口不创建或修改规则。

```json
{
  "version": 1,
  "courseId": "EXACT_COURSE_ID",
  "materials": [
    {"clientId":"102c1a77-2937-52e4-8f7d-2e4501dbce79","name":"[EN] Sets","language":"en-US","markdownFile":"en/sets.md"},
    {"clientId":"202c1a77-2937-52e4-8f7d-2e4501dbce79","name":"[中文] 集合","language":"zh-CN","markdownFile":"zh/sets.md"}
  ]
}
```

每份材料必须有稳定 UUID、1–200 字标题和 `text` 或相对 manifest 的 `markdownFile` 二选一。两种语言使用各自 ID、标题及真实文本。language 支持 `zh-CN` / `en-US`；不指定时默认使用当前课程 language，再回退 `zh-CN`。语言参与 hash 和严格读回。每份材料保存为一本 Markdown 笔记、一个 section；公式使用真实 LaTeX/Markdown，不把整页截图作为正文，不上传原 PDF。

## API 预览与提交

```json
{
  "courseId": "EXACT_COURSE_ID",
  "kind": "notes",
  "scope": "shared",
  "mode": "preview",
  "clientId": "102c1a77-2937-52e4-8f7d-2e4501dbce79",
  "name": "[EN] Sets",
  "language": "en-US",
  "text": "# Sets\n\nReviewed Markdown.\n"
}
```

preview 完全只读，返回标准 `{success:true,request_id,data}`，data 含 `status:"preview"`、`scope:"shared"`、notebookId、courseId、name、language、text、payloadHash、actor、replayed。提交传相同正文、`mode:"commit"` 及 `expectedHash:PREVIEW_HASH`。服务器再次校验授权与 hash，并在事务内创建 notebook/section、刷新公有汇总、递增 course.contentVersion；保存的 notebook.ownerId 为真实课程 owner，sourceMeta 记录实际 actor/grant。提交后从数据库读回，返回 `status:"saved"` 的完整同形收据。

固定 ID 已存在时，owner、课程、名称、语言、Markdown 类型、未删除状态、唯一 section 和全文必须完全一致才复用；不同则 409。没有 upsert、删除旧 section、覆盖、恢复已删除讲义或自动改版本的开关。重放不会增加课程版本。并发相同 ID 依赖数据库 create 唯一约束；失败后只在严格读回相同内容时视为重放。

CLI 先预览全部材料，再逐份提交；网络瞬时失败用相同 payload/ID 重试。每次响应都核对 ID、课程、标题、语言、完整正文与 hash，提交收据还必须对应接受的 preview hash。不能以旧私人笔记 ID 冒充公共讲义，也不放宽普通 notebook GET 的访问权限。401 需合法刷新凭据；403 表示当前账号/设备无匹配授权；409 必须检查内容差异，不能靠重试覆盖。

此接口只新增讲义，不改已经发布的双语材料或题库。内容质量、来源对照与双语对应关系仍须在上传前单独验收。

```sh
node --test scripts/learn/import-course-shared-lectures.test.mjs scripts/learn/import-course-problems.test.mjs
```

测试使用假库和本地响应，覆盖设备绑定、浏览器隔离、目录最小投影、语言元数据、只读 preview、真实课程 owner、固定 ID 重放与正文冲突、严格 CLI 读回；不写真实平台。
