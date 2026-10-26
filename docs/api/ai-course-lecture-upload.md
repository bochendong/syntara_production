# AI 整理讲义后上传到指定课程

复用现有 `POST /api/native/v1/materials`：AI 在本地完成 Markdown 和内容验收后直接提交，服务器保存为一本 Markdown 笔记，无须再次 AI 提取。每份源讲义对应一本笔记，完整 Markdown 保存在一个 section 中。CLI 不生成内容，也不上传原始 PDF、题库或图片附件。

测试平台 origin：`https://native-api-staging-staging-95a1.up.railway.app`。该平台 middleware 只放行 native API 等入口，不能使用普通 `/api/notebooks` 接口。部署及登录说明见 [Native App staging](./native-staging.md)。

## 认证和课程权限

使用当前账号通过 native device authorization 获得的 bearer access token，复用现有 `auth/device/start` → 浏览器登录并确认设备 → `auth/device/token` 流程。token 到期后通过现有 refresh 流程更新。CLI 不创建账号、不修改权限、不读取数据库或环境文件。

CLI 的 `--token-file` 读取只包含 bearer token 的私有 UTF-8 文件，`--token-env` 读取明确指定的环境变量，两者选一。不要把 token 值写在命令行、版本库、manifest 或聊天中。CLI 不记录 token、响应正文或请求头；网络重定向会失败，认证信息不会跟随到其他 origin。

`GET /api/native/v1/courses` 返回当前账号可访问课程；CLI 使用完整 `courseId` 精确匹配，不能只按 MAT102 名称猜测。默认仅接受 `accessRole: "owner"`。上传至 `enrolled` 课程时保存为当前账号自己的私有笔记，必须显式使用 `--allow-private`，不能将其称为全班可见讲义。该选项不会扩大账号权限。

## Manifest 与预览

先将已验收的讲义和 provenance/quality 文件保存在 Git 外的私有目录。示例 manifest：

```json
{
  "version": 1,
  "materials": [
    {
      "clientId": "03106b08-2a26-5be3-8a3a-97df2bb168fe",
      "name": "01 How to Read",
      "markdownFile": "drafts/01-how-to-read.md"
    }
  ]
}
```

每项 `text` 和 `markdownFile` 严格二选一；文件路径相对 manifest 所在目录解析。`clientId` 是预先保存、重复运行保持不变的 UUID。名称为 1–200 字符，不带首尾空白；正文为非空且最多 1,000,000 字符的 Markdown。不要在重试时生成新 UUID。

默认仅在本地验证 manifest、文件、目标 origin 和内容长度，并输出每项 SHA-256，不联网、不认证、不上传：

```sh
node scripts/learn/import-course-lectures.mjs \
  --origin https://native-api-staging-staging-95a1.up.railway.app \
  --course-id EXACT_COURSE_ID \
  --manifest /absolute/private/path/lecture-import.json
```

Origin 必须是 HTTPS，或 loopback 的 HTTP；不能包含账号密码、路径、query 或 fragment。dry-run 仅证明本地输入可用，不证明账号、课程权限或线上显示已验收。

## 提交与读回

用户要求上传即已授权提交该范围内内容。完成来源、数学公式、图片和讲义 JSON 验收后，使用同一 manifest 提交：

```sh
node scripts/learn/import-course-lectures.mjs \
  --origin https://native-api-staging-staging-95a1.up.railway.app \
  --course-id EXACT_COURSE_ID \
  --manifest /absolute/private/path/lecture-import.json \
  --token-file /absolute/private/path/native-access-token \
  --receipt /absolute/private/path/lecture-import.receipt.json \
  --apply
```

也可将 `--token-file ...` 替换为 `--token-env SYNTARA_IMPORT_TOKEN`；CLI 不载入 `.env`。`--receipt` 默认是 manifest 绝对路径加 `.receipt.json`，逐项更新，保存目标、范围、名称、ID、内容哈希和验证状态，不保存正文、认证信息或 API 响应正文。失败会保存已完成项后以非零状态退出；重跑同一 manifest 会逐项重新检查。

CLI 按顺序执行：

1. 读取精确课程及其账号权限。认证失败或课程未匹配时不上传。
2. `GET /api/native/v1/notebooks?id=CLIENT_ID` 检查既有记录。课程、名称、类型、单个 section 的课程与正文完全相同时跳过；不同则报告冲突，绝不覆盖。
3. 对不存在的 ID 提交下面的 payload。
4. 再次 GET notebook archive，精确核对保存的课程、名称和正文。
5. POST 网络异常、429 或 5xx 时先 GET 查结果；已保存且相同就完成。确认不存在时才以相同 payload 和 clientId 重试，最多三次。读回不可用时停止，保留同一个 ID 待后续重跑。

```json
{
  "courseId": "EXACT_COURSE_ID",
  "kind": "notes",
  "clientId": "03106b08-2a26-5be3-8a3a-97df2bb168fe",
  "name": "01 How to Read",
  "text": "# How to Read\n\nAccepted Markdown content.\n"
}
```

服务器现有幂等行为仅按 `clientId + 当前账号 + 课程` 判断既有笔记，既有内容不同也会返回 saved，并不会更新或比较正文。因此必须保留 CLI 的提交前检查和提交后读回。服务器创建笔记和 section 在同一事务中；同时导入相同 ID 可能遇到唯一键冲突，CLI 串行导入并在不确定结果后检查实际记录。

这是新增讲义导入，不是讲义编辑接口；已有不同内容需要另行明确的版本更新工作流。上传成功和 JSON 读回不等于浏览器呈现、数学内容或课程规范验收。原始来源、逐段保真审查、公式/图示审查和内容质量 manifest 由材料制作流程保留。

## 实现与离线验证

- 路由：[native/v1/materials](../../app/api/native/v1/materials/route.ts)
- 课程权限、事务及现有 ID 行为：[native-materials.ts](../../lib/server/native-materials.ts)
- 完整读回：[native/v1/notebooks](../../app/api/native/v1/notebooks/route.ts)
- CLI：[import-course-lectures.mjs](../../scripts/learn/import-course-lectures.mjs)

```sh
node --test scripts/learn/import-course-lectures.test.mjs
```

测试只启动 loopback mock HTTP server，覆盖认证失败、精确课程权限、私有笔记选择、既有内容冲突、相同内容跳过、POST 结果不确定后的检查、相同 ID 重试及读回不符。它不调用真实平台、不写数据库，也不表示已完成实际上传。

## 中英文 Markdown 内容准备

每份 reading 分别准备英文正文和完整中文译文，使用独立固定 UUID 与明确的语言版标题，例如 `[EN] 01 How to Read`、`[中文] 01 如何阅读数学`。两版分别作为 manifest 的一个 material；语言版不能互相覆盖。

正文使用真正的 Markdown 文本、`$...$` / `$$...$$` LaTeX 公式和 Markdown 表格。按原文顺序保留定义、定理、证明、例题与练习；仅必要教学示意图采用已持久化的资产引用。整页截图或整页 data URI 不能代替文本整理。原 PDF 保留本机，来源、翻译对应关系、数学渲染与私人问题清单独立保存，不混进学生讲义。

当前 CLI 只创建新材料；已有讲义的版本更新应通过受授权的管理流程完成，读取并校验当前版本与正文，保存恢复快照，再提交完整 section 列表并读回。不得把 `enrolled` 账号私有笔记误称为课程共享讲义，也不得为了上传提升账号权限。
