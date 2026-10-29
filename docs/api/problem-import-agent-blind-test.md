# 题库导入说明盲测验收

日期：2026-10-29（America/Toronto）。本任务修改独立整理说明和本地校验工具，没有发布测试服代码，也没有重复写入课程题库。

## 结论

旧说明不能独立支持 agent 产出符合平台协议的题目。补齐格式并经实际失败迭代后，无仓库上下文的 agent 已产出 11 条可通过当前 schema 与测试服只读预览的题目，覆盖两门真实课程；其中 4 个函数实现均通过真实服务器预检。这个结果证明所列样本与当前协议的可用性，不是对任意模型、任意新资料零错误的保证。后续导入仍需执行说明中的校验、预检、预览及提交后读回。

主入口：[给 Agent 的课程题库整理与导入说明](./ai-course-problem-upload.md)。认证和运维细节移至 [上传接口参考](./course-problem-import-transport.md)。

## 基线和真实资料

工作分支 `codex/question-import-guide`，从已成功部署的 `f75e3bacf9fe44aff38259075d862c180fbb32e0` 创建独立 managed worktree。验证期间测试服更新到 `aeb8aafce71e69001b4e4b7bc9c66afe544efbbe`，Railway deployment `366207e9-8d2c-4e35-94a6-ba6cb5fc3cb4` 成功；核对两提交的 schema、题库导入、代码预检及判题模块无差异。

只读查询固定 `syntara-app / staging / staging-postgres`。按原始 CourseSource 记录导出原件字节，SHA-256 与数据库 sourceHash 相同；目标课程的真实章节 ID、名称、hardRules、rulePacks 由当前授权接口导出。没有把预先整理的题库答案或既有 manifest 给子 agent。

| 课程与原件 | SHA-256 | 本次范围 |
| --- | --- | --- |
| UTSG-CSC108Y：CSC108_UT_Midterm_Practice_01.pdf | `7f625abd44b6306122455e096c2cf595e539e94deecba069cf190f952d9019f9` | 分两组覆盖 Q1–Q8，包含全部原小问 |
| UTM-MAT102：MAT102_TT2_模拟卷_A_答案版_真题优先修订版.pdf | `0d1f3d490d25dcc01ae6fd0d005a3fd1245cec9e253f561f2c77735ea1559625` | MC5、长答1、长答2(a,b)；其他题明确范围外 |

CSC108 原件的 Fall 2026 与目标课程 Summer 2026 不同，agent 在来源审计中保留差异，没有伪称同学期或官方试卷。原件及私有答案、收据均保存在 Git 外的 `~/.codex/syntara-import-audit/`，目录权限 0700；凭据没有交给子 agent，也不进入证据包。

## 盲测方法和失败迭代

各子 agent 使用 `fork_turns:"none"`，不继承主对话。给定输入只有该轮说明、真实原 PDF、course-context.json 和 provenance.json；明确禁止读取仓库、技能、其他 agent 输出和其他审计目录，禁止联网和数据库访问。可使用通用本地 PDF/Python 工具。此处是独立上下文和访问范围约束，不是声称操作系统沙箱隔离。

1. **旧版对照**：CSC108 Q2/Q3/Q4/Q6/Q7，共 5 条候选。原件图像与答案推导基本正确，但不知道 taskKind/responseKind、multipart.content 和代码测试的实际字段；实际 parser 报错，agent 自己也声明说明不足。没有将去掉 validationErrors 当作修复。
2. **新版数学组**：3 条候选通过 schema，但把需要欧几里得过程和任一合法特解的任务放进 calculation。查实际 evaluate.ts 证实它只比较最终字符串/数值，showWork 不会开启过程评分。说明明确改为 short_answer + 专属 rubric，agent 重新整理后通过。
3. **新版代码组**：5 条候选通过 schema；首次服务器预检暴露新版说明写错测试模块名，导入 solution 而平台实际加载 submission.py。修正说明并由 agent 重生成，参考程序、空实现和错误实现均按真实 runner 验证。
4. **预检到导入的接合**：含代码的 multipart 省略 notebookId 时，预检签名与导入补入 null 后的整题指纹不同，预览拒绝 403。将“预检前显式 notebookId:null”写入说明和本地校验，agent 修订输入后重新预检及预览通过。没有改写签名或绕过认证。
5. **最终冷启动留出组**：新 agent 只看修订说明和同一原件，整理此前未参与修订的 Q1/Q5/Q8。首次即通过 schema、真实代码预检和只读导入预览；保留 Q5 的错误原因说明目标，没有把它降为单格 ERROR。

准备 agent 的输出未经父 agent 手工改答案或字段来“凑通过”。执行端仅按说明将真实预检返回的 validatedDraft 原样替换，并将真实 proof 放进 item.codePreflight，另存 manifest-ready.json。

## 最终结果

| 组别 | 原大题数 / 覆盖记录 | 导入记录 | 结果 |
| --- | --- | --- | --- |
| CSC108 Q2/Q3/Q4/Q6/Q7 | 5 / 7 | 5：fill_blank ×2、table ×1、multipart ×1、code ×1 | 本地实际 parser、服务器预检、服务器预览通过 |
| MAT102 MC5、长答1、长答2 | 3 / 4 | 3：choice ×1、proof ×1、multipart ×1 | 本地实际 parser、来源/数学/评分结构审查、服务器预览通过 |
| CSC108 留出 Q1/Q5/Q8 | 3 / 5 | 3：multipart ×2、code ×1 | 首次本地 parser、服务器预检、服务器预览通过 |

共 11 条导入记录、16 行原题/小问覆盖记录。覆盖记录不是表格所有格子的计数。3 份只读预览全部返回正确课程、真实章节复用计划及 createsNotebooks=0。4 个函数实现（含两个代码小问）均满足 valid/referencePassed/starterRejected/incorrectRejected；7 个错误实现被真实 runner 拒绝。

主执行端另用实际 evaluateNotebookNonCodeProblem 做 12 个正反断言：原内存图命名与一致交换命名都满分，混用两组命名不能满分；返回值表、float 类型和选择题各选项正确/错误结果符合预期。数学部分独立重算 gcd、特解和整数组合，审查非存在性与解族完整性证明。相关 PDF 整页图、缩进、引号和对象 ID 已核对。

没有调用 --apply，没有新增题目、笔记或学生作答；没有对原题做修补来满足测试。没有执行主观题的大模型实判或实时做题 UI 验收，也没有声称已完成提交后读回。预检签名只用于本次当前授权会话，过期后需重新生成。

## 可重复的检查

新增 `scripts/learn/check-course-problem-manifest.mjs`：加载实际服务端 parser，阻断数据库、写入和 runner 依赖；检查未知字段静默丢弃、实际代码就绪要求、表格逐格覆盖/公开答案泄露、填空对应、multipart 依赖及签名 null 边界、过程计分题误用 calculation、错误 Python 测试模块名。它不会加载 .env、访问服务、执行题目代码或验证来源/数学正确性。

```sh
node scripts/learn/check-course-problem-manifest.mjs /private/manifest.json
node --test scripts/learn/check-course-problem-manifest.test.mjs scripts/learn/import-course-problems.test.mjs
pnpm verify:local
```

说明中的 8 个 JSON 示例由回归自动抽取，交给实际 parser/就绪检查，防止文档字段与代码悄悄分离。新增 8 项回归连同原 24 项导入回归共 32 项通过。完整类型检查先用 next typegen 生成新 worktree 必需的 Next 类型，再执行成功；初次未生成 Next 类型时的静态图片 .src 报错没有被当作代码通过。最终格式、lint、根类型检查及 git diff --check 通过。

额外尝试了已安装 syntara-teacher 0.1.14 的 check-question-quality.mjs：选择/证明样本接受，但它的 types 白名单只有六种题型，将当前合法 multipart 报为 type_mismatch；因此 fullyAccepted=false。此旧插件检查结果明确保留，不能用它否定当前已实测的 multipart，也不能声称它全通过。当前平台协议与新增实际 parser 校验是本次格式验收依据；没有为迎合旧脚本拆掉原题。

私有证据目录包含各轮 guide 快照、原件及哈希、子 agent 生成器/coverage/本地验算、失败和成功的预检收据、三份服务器预览、自动判题断言和回归日志。服务器收据含答案或签名，不能公开提交。仓库只保存通用说明、通用合成示例、工具、测试及本验收记录。
