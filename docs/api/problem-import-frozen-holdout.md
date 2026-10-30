# 冻结说明后的全新 Agent 盲测

日期：2026-10-29。目的：检验最终版[独立说明](./ai-course-problem-upload.md)能否迁移到新原题，不向生成 agent 提供题型建议、预期答案或上一轮的修复经验。

## 输入与隔离

说明冻结在提交 `ee227fa2`；SHA-256 为 `060dded8b4c571c916e41e5ac77659c76bb8a845b81139002a1ef928f74db46f`。本轮不修改说明。原件从固定 staging 数据库只读导出，字节哈希与 CourseSource.sourceHash 一致；课程 context 通过 staging HTTPS 只读接口取得。

正式启动使用 `fork_turns:"none"` 的全新子 agent `clean_fresh_holdout`。白名单资料包共 18 个文件：冻结说明、范围表、5 份真实 context、9 份原始 PDF、2 份来源清单；启动前不存在 output 目录。不给仓库、已有 manifest、检查器实现、历史对话、参考输出或凭据。生成期间不发送任何补充提示或校验反馈。通用本地工具可用于提取、渲染和验算；这是一轮输入隔离实验，不声称操作系统级沙箱隔离。

任务 prompt 原文如下，只有路径和工作范围，没有解题或格式提示：

> 请依据 /Users/dongbochen/.codex/syntara-import-audit/clean-holdout/bundle/guide.md 和 scope.md，把该包中的课程资料整理为所要求的交付文件。仅使用该 bundle 中的说明、范围、课程 context 与原件，不读取本项目、其他目录的历史材料或既有输出。输出保存在 bundle/output/ 下。不要上传。完成后报告交付路径及未完成项。

范围表只指定课程、原件、题号和 PDF 页码；各课程单独交付，不指定题型、答案或实现方法。

| 课程 | 新原件与范围 |
| --- | --- |
| UBC-CHEM233 | Problem Set 2：Q2、Q10、Q12；真实分子图、共振构造、共轭与芳香性 |
| UTSC-MATA29/A30 | Fall 2023 Final Practice 1：Q4、Q9；连续性与优化 |
| UTSC-MGFC10 | Assignment 1 Winter 2021：Q3；资本结构与自制去杠杆 |
| UTSG-ACT240 | Fall 2025 Practice Final：Q5、Q8；变力利息与周期现金流 |
| UTSG-CSC110 | 2023 Test 1：Q1(a)、Q2(a)、Q5；表达式追踪、函数实现与整除证明 |

五门课中四门未参加之前的扩展盲测；化学改用另一份练习及新题。现有章节复用和无章节课程的知识点建章都在范围内。本包五门课 context 的 hardRules/rulePacks 均为空；仍须遵守原卷中的编程方法、推导与精度要求，不能将本轮结果说成非空 Hard Rules 的新增覆盖。

正式启动之前废弃了两次启动：首次发现 PS02 Q1 的分子刺激图与旧 PS01 Q3 重复，换成未测 Q12；第二次发现复制资料时夹入首次启动的渲染缓存，停止并按白名单重建。第二个 agent 报告只看到缓存文件名、未读取内容。这两次均未验收、未计为通过，也没有据其产物修改说明；正式 agent 完全重新启动。

## 验收

**正式运行的首次完整交付通过，零反馈、零返工，说明未修改。** Agent 独立生成五套 manifest/coverage/preflight-inputs，共 11 条题目、52 行原小问／单元格／选项覆盖记录，内容阻塞为零。验收前冻结原交付及 SHA-256；完成后再次核对，输入和原 manifest 均未变化。

顶层为 multipart 4、choice 1、table 1、short_answer 2、calculation 2、code 1；加上子题中的 fill_blank 和 proof，覆盖全部八种合法题型。没有预先向 agent 指定这个分布。

| 独立验收层次 | 实际结果 |
| --- | --- |
| 真实服务端 parser 与附加离线门禁 | 五份 manifest 首次均 valid，unknown field、课程章节对应、图片头和请求大小无错误 |
| 来源与内容审查 | 11 个所选原题单元均有映射；原图标号、原题目标、公共限制、答案与评分依据逐题核对 |
| 条件图 | 三张 PNG 完整 base64 解码、Pillow verify、像素尺寸与哈希检查、逐张和原 PDF 对照通过 |
| 代码真实 staging 预检 | valid/referencePassed/starterRejected/incorrectRejected 全部 true，errors 为空；2 公开＋5 私有 unittest |
| 代码负例 | pass 空实现被拒绝；未排序、把无大小写字符误判成大写两个可加载算法均被真实测试断言拒绝，非语法或加载错误 |
| 真实自动判分器 | 84 个额外正反例断言通过，未调用模型或创建学生作答 |
| HTTPS 只读预览 | 五份均首次通过，共 11 条，createsNotebooks 全为 0 |

三个条件图分别是 nicotine 标号结构、六个共轭候选结构、五种杂环及 A/B 氮原子标签，全部从无答案的原题 PDF 裁切。所有键级、标号、空间关系都保留，没有把 KEY 中圈选或手写答案公开。Q2(F) 仍要求学生实际绘制共振结构与弯箭头，没有降成描述题；私有参考与评分标准完整。

具体迁移检查包括：Q12 保留五种杂环的四类属性以及双氮标签；微积分连续性保留正式极限推导，优化题保留全局最大值论证；金融题保留四位金额／六位利率精度与自制去杠杆论证；ACT240 从整页图识别提取文本丢失的根号，以逐笔月现金流复核季有效贴现率换算；CSC110 保留连续控制台状态、ERROR 原因解释、原函数头／docstring／doctest、comprehension 方法限制，以及包含 n=0 的整除定义证明。

84 个实际 evaluator 断言使用验收端独立核对的原题答案：共轭选择题全部 64 个选项子集；五组 nicotine 填空的正确／错误输入；化学属性表和 Python 控制台表的正确／错误整表；两道 ACT240 数值题的四位精度与更高精度接受、精度不足拒绝。开放题参考答案与 rubric 经来源／推导审查，但没有调用模型评估主观判分效果。

主执行端未手改生成题目。代码题只按说明执行正常交接：调用真实预检，将服务器返回的 validatedDraft 原样放入另存的 manifest-ready，并附真实 proof；随后最终预览通过。这不是给 agent 的修复反馈，也不修改冻结原交付。其余四份直接使用原交付预览。

本轮只验证“冻结说明＋新资料能够独立生成符合当前导入结构的文件”。没有实际 apply／持久化读回、学生作答 UI、真实手写设备、主观文本／图片语义评分或精确 rubric 权重效果验收；一次成功也不是任意 agent／任意未来资料均必然成功的保证。仍须保留说明中的逐题检查、真实预检与导入预览门禁。

完整证据留在 Git 外的 `~/.codex/syntara-import-audit/clean-holdout/`：input-inventory、guide-freeze、agent-dispatch、submitted 原交付及哈希、offline-results、image-results、independent-expectations、automatic-grading、真实预检／五份预览收据和 final-verification-summary。源题、答案、data URL、凭据和签名不提交到仓库。本轮未调用 `--apply`，未新增题目、笔记或学生作答。
