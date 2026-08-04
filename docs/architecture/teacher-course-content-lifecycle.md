# 教师课程内容与任课交接设计

状态：Local-first phase 1 implemented; production persistence and replace workflow pending

本文定义教育机构在一个学期内变更任课教师后平台如何同步权限和延续课程内容，以及教师上传资料、从往届课程迁移内容和课程内容假删除时的产品与领域契约。本文先固定业务语义，不绑定 PostgreSQL、IndexedDB、对象存储或具体队列实现。

## 1. 已确认的产品规则

1. 教育机构是任课关系的唯一决定方。老师登录时，平台按该老师查询其当前学期正在教授的课程；平台教师端、管理员端和内部业务 API 都不提供手动换老师能力。
2. 一门学期课程同一时间只有一位任课教师，但机构可能在学期中把当前教师从 A 变更为 B。
3. 课程内容属于该学期课程，不属于当前任课教师。教师身份保留为创建者和操作者来源。
4. 当前任课教师负责上传、迁移、隐藏、替换和恢复本学期课程内容。机构改派 B 后，B 立即看到并接管 A 在同一 CourseOffering 中上传、迁移和生成的所有当前有效内容。
5. 平台不根据文件内容替教师判断是否重复。相同文件可以被多次上传，且不提示、不阻止、不自动合并业务记录。
6. 删除是课程级假删除：当前课程和学生视图不再显示，但底层资产、历史学期原版和审计记录不被物理删除。
7. 往届内容按同一机构、同一稳定课程身份共享。迁移只增加目标课程的内容项，不修改来源学期。
8. AI 只使用当前学期课程中仍然有效的内容；隐藏当前课程内容不得影响往届课程或其他课程的知识索引。

## 2. 术语

### InstitutionCourse

机构内稳定的课程身份，例如 University of Toronto 的 `CSC108`。它不代表某一个学期，也不保存当前任课教师。

### CourseOffering

某门课程在一个具体学期的教学实例，例如 `CSC108 · 2026 Winter`。学生名单、任课交接、课程内容清单和 AI 知识范围都挂在 CourseOffering 下。

### InstructorAssignment

一段有起止时间的任课关系。CourseOffering 同一时间最多有一条未结束的 InstructorAssignment。

### ContentAsset

一项课程内容的长期业务身份，例如一份讲义、题库或笔记本。ContentAsset 记录来源和创建者，不负责表示某个学期是否正在使用它。

### ContentAssetVersion

ContentAsset 的不可变内容版本。迁移必须锁定一个明确版本，避免来源教师后来更新资料时静默改变已经开课的目标课程。

### CourseContentItem

CourseOffering 内容清单中的一项。上传、迁移和替换最终都产生 CourseContentItem；隐藏只改变这一项在当前 CourseOffering 中的状态。

## 3. 领域关系

```text
InstitutionCourse
└── CourseOffering
    ├── InstructorAssignment[]
    ├── CourseContentItem[]
    │   └── ContentAssetVersion
    │       └── ContentAsset
    │           └── SourceBlob
    ├── ContentMigrationBatch[]
    ├── CourseContentEvent[]
    └── CourseKnowledgeProjection
```

## 4. 核心模型

以下字段表达业务契约，不要求数据库字段名完全相同。

### 4.1 InstitutionCourse

```ts
type InstitutionCourse = {
  id: string;
  institutionId: string;
  externalCourseKey: string;
  code: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};
```

不变量：

- `institutionId + externalCourseKey` 唯一。
- 课程代码可以展示和搜索，但不能代替机构提供的稳定课程标识。

### 4.2 CourseOffering

```ts
type CourseOffering = {
  id: string;
  institutionCourseId: string;
  externalOfferingId: string;
  academicYear: number;
  term: 'winter' | 'summer' | 'fall';
  status: 'active' | 'completed' | 'archived';
  currentInstructorId: string | null;
  rosterObservedAt: string;
  createdAt: string;
  updatedAt: string;
};
```

不变量：

- `institutionId + externalOfferingId` 唯一。
- 机构变更任课教师不得创建新的 CourseOffering。
- `currentInstructorId` 是快速读取字段；真实历史由 InstructorAssignment 保存，两者必须在同一个事务中更新。

### 4.3 InstructorAssignment

```ts
type InstructorAssignment = {
  id: string;
  offeringId: string;
  teacherId: string;
  source: 'institution';
  startedAt: string;
  endedAt: string | null;
  observedAt: string;
  createdAt: string;
};
```

不变量：

- 一个 CourseOffering 同一时刻最多存在一条 `endedAt = null` 的记录。
- 机构权威同步把教师从 A 改为 B 时，平台必须原子地结束 A、创建 B、更新 `currentInstructorId`。平台不能主动发起这一变化。
- A 的任课关系结束后立即失去课程内容写权限；A 创建的内容不被删除或隐藏。
- B 接手后获得当前 CourseOffering 全部内容的管理权，包括 A 上传和迁移的内容。
- 历史 assignment 不覆盖、不复用；同一位教师离开后再次回来，应创建新的一段 assignment。

### 4.4 SourceBlob

```ts
type SourceBlob = {
  id: string;
  contentHash: string;
  storageKey: string;
  byteSize: number;
  mimeType: string;
  createdAt: string;
};
```

`contentHash` 只用于底层完整性校验和物理存储优化。它不能触发上传提示，不能阻止重复上传，也不能自动把两次上传合成同一条课程内容。

### 4.5 ContentAsset

```ts
type ContentAsset = {
  id: string;
  institutionCourseId: string;
  originOfferingId: string;
  createdByTeacherId: string;
  kind: 'source' | 'notebook' | 'problem_bank';
  createdAt: string;
};
```

`createdByTeacherId` 是署名和来源，不授予永久管理权。当前管理权限只由目标 CourseOffering 的 active InstructorAssignment 决定。

### 4.6 ContentAssetVersion

```ts
type ContentAssetVersion = {
  id: string;
  assetId: string;
  version: number;
  sourceBlobId: string | null;
  title: string;
  description: string | null;
  contentMetadata: Record<string, unknown>;
  createdByTeacherId: string;
  createdAt: string;
};
```

不变量：

- 已创建的版本不可原地改写。
- 更新资料创建新版本；历史 CourseContentItem 继续指向原版本，除非当前教师明确执行替换。
- 两次内容完全相同的上传仍可创建两项独立 ContentAsset/ContentAssetVersion；SourceBlob 是否复用对产品不可见。

### 4.7 CourseContentItem

```ts
type CourseContentItem = {
  id: string;
  offeringId: string;
  assetId: string;
  assetVersionId: string;
  mode: 'uploaded' | 'migrated' | 'generated';
  status: 'active' | 'hidden' | 'superseded';
  createdByTeacherId: string;
  sourceOfferingId: string | null;
  migrationBatchId: string | null;
  replacesItemId: string | null;
  hiddenAt: string | null;
  hiddenByTeacherId: string | null;
  hiddenReason: string | null;
  createdAt: string;
  updatedAt: string;
};
```

不变量：

- 不对 `offeringId + assetVersionId` 建业务唯一约束。老师可以多次上传或多次添加相同内容。
- HTTP 重试通过独立的 `idempotencyKey` 防止同一次命令重复执行，不能用文件哈希做幂等键。
- `hidden` 和 `superseded` 都不删除 ContentAsset、ContentAssetVersion 或 SourceBlob。
- 对当前课程隐藏迁移内容，不改变来源 CourseOffering 的任何 CourseContentItem。

### 4.8 CourseContentEvent

```ts
type CourseContentEvent = {
  id: string;
  offeringId: string;
  contentItemId: string | null;
  actorTeacherId: string | null;
  actorType: 'teacher' | 'institution_sync' | 'system';
  action:
    | 'teacher_assigned'
    | 'teacher_unassigned'
    | 'uploaded'
    | 'migrated'
    | 'generated'
    | 'hidden'
    | 'restored'
    | 'permanently_deleted'
    | 'superseded';
  metadata: Record<string, unknown>;
  createdAt: string;
};
```

审计的目的不是多人同时编辑，而是教师交接、恢复误操作和管理员排查。

## 5. 机构同步契约

老师登录成功后，平台向机构发起一次“这位老师当前开哪些课”的查询。该响应只对这位老师是完整的，不要求平台在登录时拉取整个机构的所有课程：

```ts
type InstitutionTeacherCourseSnapshot = {
  institutionId: string;
  teacherUserId: string;
  academicYear: number;
  term: 'winter' | 'summer' | 'fall';
  scope: 'teacher_current_courses';
  observedAt: string;
  courses: Array<{
    institutionCourseId: string;
    code: string;
    name: string;
  }>;
};
```

同步规则：

1. 使用机构提供的稳定 `institutionCourseId` upsert 同一个 CourseOffering；不能把老师 ID 拼入课程 ID。
2. 响应中出现的课程授予当前登录老师管理权。若该 CourseOffering 仍记录 A 为当前老师，则在同一事务中结束 A 的 assignment、撤销 A 的访问、创建 B 的 assignment、把 `currentInstructorId` 改为 B，并写入交接事件。
3. 响应中没有出现、但此前仍分配给当前登录老师的课程，只撤销这位老师的任课关系。它不删除课程、不隐藏课程内容，也不据此猜测下一位老师是谁。
4. B 第一次登录时直接读取同一个 CourseOffering 的 active CourseContentItem，因此可以看到 A 已上传、迁移或生成的有效内容，不需要执行内容转移或重新迁移。
5. A 的权限失效后，其新的课程写请求必须失败；B 对旧内容的操作仍记录 B 为操作者，原创建者署名不变。
6. 学生名单不是教师交接的附带结果。若机构在同一响应返回学生授权，只更新响应所包含课程的学生数据，不能因老师被调离而撤销该课程学生。
7. 每次登录响应只能撤销该 `teacherUserId` 自己缺失的课程，不能撤销其他老师的课程。

请求时序允许短暂的“尚无当前老师”：A 登录后机构响应不再含该课时，平台可先撤销 A；待 B 登录并返回该课时再授予 B。若 B 先登录，B 的返回也可以直接原子替换尚未失效的 A。

## 6. 教师内容命令

### 6.1 上传

```text
POST /teacher/course-offerings/:offeringId/content/uploads
```

行为：

1. 校验请求者是当前 active 任课教师。
2. 校验文件类型、单文件大小和请求数量。
3. 接收每一个文件，不做业务重复判断，不返回重复提示。
4. 每次上传创建独立的 ContentAsset、ContentAssetVersion 和 CourseContentItem。
5. 底层可以按 contentHash 静默复用 SourceBlob。
6. 写入 `uploaded` 审计事件。

上传和 AI 入库仍然是两个动作。上传成功不代表文件已经进入 AI 知识库。

### 6.2 从往届课程迁移

```text
POST /teacher/course-offerings/:offeringId/content/migrations
```

请求包含来源 CourseOffering 和老师明确勾选的 source item IDs。系统只校验：

- 请求者是目标 CourseOffering 当前教师；
- 来源和目标属于同一机构、同一 InstitutionCourse；
- 来源是更早的学期；
- 每个 source item 确实属于来源 CourseOffering。

每个选择项创建新的目标 CourseContentItem，并锁定来源 item 当时指向的 assetVersionId。迁移不复制 SourceBlob，不修改来源 item，不根据内容哈希提示或阻止老师。

同一次 HTTP 命令使用 idempotencyKey 保证网络重试安全；老师之后再次主动迁移相同内容是新的业务操作，应被允许。

### 6.3 从当前课程隐藏

```text
POST /teacher/course-offerings/:offeringId/content/:itemId/hide
```

老师端文案使用“从本学期课程中移除”，不使用“永久删除”。行为：

- `status = hidden`；
- 写入 `hiddenAt`、`hiddenByTeacherId` 和可选原因；
- 从教师默认列表、学生列表和当前课程 AI 检索范围中移除；
- 保留底层资产、版本、文件、来源学期内容和审计事件。

### 6.4 恢复

```text
POST /teacher/course-offerings/:offeringId/content/:itemId/restore
```

恢复只修改当前 CourseContentItem。隐藏内容不出现在老师默认列表中；可从独立的“已移除内容”入口恢复，或者仅由管理员/支持工具恢复，最终可见范围由产品界面决定。

### 6.5 彻底删除

教师只能从“已移除内容”入口执行，并且必须经过不可恢复的二次确认。系统先删除当前 CourseContentItem；仅当底层资产不再被任何课程内容项引用时，才继续清理资产版本。仅当源文件也不再被其他资产使用时，才清理文件、知识记录和处理任务。`permanently_deleted` 审计事件始终保留。

### 6.6 替换

替换是“新增一项 + 旧项 superseded”的原子操作：

1. 上传或选择新版本，创建新的 active CourseContentItem。
2. 旧 CourseContentItem 标记为 `superseded`。
3. 新 item 的 `replacesItemId` 指向旧 item。
4. 不删除旧版本和旧文件。

## 7. 读取范围

### 教师默认内容列表

只返回当前 CourseOffering 的 `active` 内容。`hidden` 和 `superseded` 不在默认结果中。

### 学生课程内容

只返回学生仍有有效机构授权、且目标 CourseOffering 中状态为 `active` 的内容。

### 往届迁移选择器

默认展示来源 CourseOffering 当时仍为 `active` 的内容，并明确显示来源学期、创建者和版本。它不推断老师应不应该迁移某项内容。

### 管理和恢复视图

可以读取 `hidden`、`superseded` 及其审计事件，但不得把它们重新加入学生或 AI 读取范围，除非当前教师明确恢复。

## 8. AI 知识投影

原始文件提取结果可以按 ContentAssetVersion 复用；课程 AI 的可检索投影必须按 CourseOffering 隔离。

```text
ContentAssetVersion
  → 可复用的提取正文

CourseContentItem(active)
  → 当前 CourseOffering 的 KnowledgeProjection
```

状态变化规则：

- 上传：不自动进入 AI；教师明确触发后才建立投影。
- 迁移：是否继承已有提取正文可以由系统优化，但目标课程投影必须单独建立。
- 隐藏：立即停止在目标 CourseOffering 检索，不删除共享提取正文。
- 恢复：重新启用或重建目标 CourseOffering 投影。
- 替换：新 item 投影生效，旧 item 投影退出目标课程检索。

## 9. 老师端操作设计

每个 active 内容项提供与来源无关的一致操作：

- 查看；
- 加入 AI 知识库或查看处理状态；
- 从本学期课程中移除；
- 用新资料替换（后续命令；当前可通过上传新资料并移除旧条目完成）。

上传区域：

- 显示允许格式、大小限制和上传进度；
- 不显示重复文件判断；
- 上传成功后进入当前课程内容列表；
- AI 入库由老师另行触发。

迁移区域：

- 只允许选择同一 InstitutionCourse 的往届 CourseOffering；
- 按内容项勾选，不整门课程强制复制；
- 展示来源学期、创建者、类型和版本；
- 不对选择作教学建议，不因为相同文件已存在而阻止提交。

## 10. 权限矩阵

| 操作 | 当前任课教师 | 已结束任课教师 | 学生 | 管理员/支持 |
| --- | --- | --- | --- | --- |
| 查看当前 active 内容 | 是 | 否 | 有有效授权时是 | 是 |
| 上传 | 是 | 否 | 否 | 按运维策略 |
| 迁移往届内容 | 是 | 否 | 否 | 按运维策略 |
| 隐藏/替换/恢复 | 是 | 否 | 否 | 是 |
| 查看审计 | 可查看本课程交接摘要 | 否 | 否 | 是 |
| 从已移除列表彻底删除 | 是，仅限当前课程且需二次确认 | 否 | 否 | 是 |

## 11. 验收场景

### 场景 A：机构在学期中改派老师

1. A 是 CSC108 · 2026 Winter 当前教师，并上传资料 X。
2. B 登录时，机构返回 B 当前教授该课程；平台没有人工换老师操作。
3. A 的 assignment 结束，B 的 assignment 开始。
4. A 再次调用上传或隐藏接口得到无权限响应。
5. B 第一次进入同一课程实例时就可以看到并管理资料 X；X 不需要转移，创建者仍显示为 A。

### 场景 B：重复上传

1. 当前教师连续两次上传完全相同的 PDF。
2. 系统不提示重复，也不阻止。
3. 课程内容列表出现两条独立内容项。
4. 底层允许两条版本指向同一个 SourceBlob，但隐藏其中一条不影响另一条。

### 场景 C：隐藏迁移内容

1. B 从 2025 Fall 迁移资料 Y 到 2026 Winter。
2. B 将 2026 Winter 中的 Y 从本学期课程移除。
3. 2026 Winter 教师默认列表、学生列表和 AI 检索都不再包含 Y。
4. 2025 Fall 的 Y 及其历史知识仍然存在。

### 场景 D：替换内容

1. 当前课程正在使用 syllabus v1。
2. 教师上传 v2 并执行替换。
3. v2 成为 active，v1 成为 superseded。
4. 学生和 AI 只使用 v2；审计和历史读取仍可找到 v1。

### 场景 E：迁移命令重试

1. 同一次迁移请求因网络超时重试，携带相同 idempotencyKey。
2. 系统只创建一次目标内容项。
3. 教师稍后重新主动迁移相同来源项，使用新的 idempotencyKey，系统允许创建新的内容项。

## 12. 当前本地实现与后续工作

本地 IndexedDB 已实现：机构课程 ID、老师登录同步、任课时间段、A→B 原子交接、内容版本、可重复上传与迁移、课程条目隐藏/恢复/彻底删除、审计事件，以及教师/学生默认内容读取只返回 active 条目。

后续工作：

1. 在正式服务端 session 下接入学校已认证的教师课程接口，并把相同契约迁入正式数据库。
2. 增加显式 replace 命令，把“新条目 active + 旧条目 superseded”放在同一事务中。
3. 为课程知识投影保存明确的 content item/version 关联，使检索层直接按 active item 构建和撤销索引。
4. 增加命令级 idempotencyKey；保留“老师稍后再次主动执行相同迁移”这一合法业务操作。
5. 再选择对象存储和后台队列的正式实现，不改变上述课程与内容语义。
