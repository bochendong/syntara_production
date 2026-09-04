import { compactSourcePackageForPrompt } from './import.structure-utils';
import type { ProblemSourcePackage } from './import.core.types';

export function directLlmProblemImportPrompt(args: {
  sourcePackage: ProblemSourcePackage;
  language: 'zh-CN' | 'en-US';
}) {
  const compactSource = compactSourcePackageForPrompt(args.sourcePackage);
  const formattingContract = problemStemFormattingContract(args.language);
  return args.language === 'zh-CN'
    ? `请直接读取附加 PDF，完成整本题库导入。只返回严格 JSON 对象，不要 markdown，不要解释。

目标：由大模型直接完成题目边界识别、非题目页排除、题面整理、LaTeX 转写和 draft 生成。本地不会先拆题；你要以 PDF 视觉内容为准，下面的文本层 Source Package 只作为辅助 OCR/页码提示。

返回格式：
{
  "structurePlan": {
    "sourceSummary": "简短说明",
    "nonProblemRegions": [{"kind":"cover|instructions|additional_work|blank|header_footer|other","pageNumbers":[1],"reason":"..."}],
    "sharedContexts": [{"id":"ctx_1","title":"...","pageNumbers":[2],"summary":"..."}],
    "topLevelProblems": [
      {
        "index": 1,
        "topLevelLabel": "1",
        "title": "概念导向标题",
        "problemTypeHint": "choice|proof|calculation|short_answer|code|fill_blank|unknown",
        "pageStart": 2,
        "pageEnd": 2,
        "sourceAnchors": [{"pageNumber":2,"sourcePageId":"page_2","textQuote":"题目开头短引文","role":"problem"}],
        "subparts": [{"label":"a","prompt":"子问原意","points":3}],
        "contextBlocks": [{"kind":"definition|conditions|table|diagram|code|data|hint|other","title":"...","summary":"..."}],
        "visualRefs": [],
        "confidence": 0.0 到 1.0
      }
    ],
    "warnings": [],
    "generatedBy": "llm"
  },
  "drafts": [
    {
      "title": "简短题名",
      "type": "short_answer|choice|proof|calculation|code|fill_blank",
      "points": 1,
      "difficulty": "easy|medium|hard",
      "tags": [],
      "publicContent": {"type":"short_answer","stem":"学生可见题面，Markdown + LaTeX"},
      "grading": {"type":"short_answer"},
      "sourceMeta": {"scaffoldIndex":1,"structure":{"topLevelLabel":"1"},"anchors":[{"pageNumber":2}]},
      "validationErrors": []
    }
  ]
}

硬性要求：
- 由你直接决定题目边界；不要照抄 Source Package 里的 roleHint 或本地 heuristic 结论。
- 必须保留 PDF 原文语言：英文题继续输出英文，中文题继续输出中文；不要翻译、改写成另一种语言或把示例里的中文套进题面。
- publicContent.stem（填空题使用 stemTemplate）是可直接作答的学生题面。保持考点、认知要求和大致难度，但允许为了适配平台而改写输入输出接口和题型；不要翻译或随意扩展知识点。
- 默认按顶层题号组织题目；但表格中的每一行、逐项代码追踪或其他彼此独立作答且独立计分的重复单元，应分别建立 structurePlan 条目和 draft。共享材料复制到每道拆出的题中。
- 不要输出封面、考试说明、空白页、additional work。
- drafts 数量必须等于 structurePlan.topLevelProblems 数量，顺序一致。
- 每个 draft.sourceMeta.scaffoldIndex 必须等于对应 topLevelProblems.index。
- 每个 draft.sourceMeta.anchors 必须带页码；sourceMeta.structure 可以是对应 topLevelProblems 的简短副本。
- tags 必须保持为空数组，不要输出 tagPaths、知识标签或知识树分类；章节归档由老师建立章节后单独完成。
- 必须为每道题独立解题并生成可评分答案；学生手写内容、勾选、分数和教师批注不是题面，也不能直接当作标准答案。
- 保持原题的作答方式与认知要求；代码输出预测、报错判断属于 code_reading，可按原题使用 choice、fill_blank 或 short_answer。只有原交互无法稳定展示或评分时才适配题型。
- choice 填 correctOptionIds；calculation 填 referenceAnswer、至少一个仅含最终结果的 acceptedForms，并在适用时填 tolerance/unit；short_answer 填 referenceAnswer/rubric/rubricCriteria；proof 填 referenceProof/rubric/rubricCriteria；fill_blank 为每个 blank 填 answerKind、acceptedAnswers 与 matcher。
- code 只用于让学生实现函数的题目。题目必须使用函数参数输入并通过 return 返回结果；不得依赖 input、stdin、print 判分或文件读写。原题若使用这些接口，等价改写接口并在 sourceMeta.adaptation 记录改动，但不要求老师确认。
- 每道 code 必须填完整 solutionCode、带类型注解和 docstring 的 starterCode、functionSignature、LeetCode 式 statementSections、至少 2 个互不重复的 publicTests 和至少 3 个互不重复的 secretTests。testcase 是编译 unittest 文件的结构化输入：expression 只能调用目标函数，expected 是返回值；solutionCode 必须通过全部测试。
- sourceMeta.adaptation 使用 {"status":"exact|adapted","originalKind":"...","deliveryType":"...","changes":[],"preservedObjectives":[]} 记录转换。不能保持考点和难度时，选择更合适的非代码题型，不要生成平台无法判分的题。
- 填空题使用 publicContent.stemTemplate，并用 {{blank_id}} 标记每个空；publicContent.blanks 与 grading.blanks 的 id 必须一一对应。
- 所有模型推导答案都在 sourceMeta.answerSource 写 "llm-solved"；如果确实无法可靠求解，保留题目并在 validationErrors 明确标记，不得伪造答案。
- 数学题面必须整理成可读 Markdown + LaTeX；不要输出 OCR 垃圾文本、Unicode 数学符号、裸数学、或被压扁的一整行公式。
- 分段函数、矩阵、长积分、长极限等使用独立 $$...$$；行内短公式使用 $...$。
- 不要把一条公式拆成多个相邻的 $...$ 片段；分段函数必须写成一个完整块，例如 $$f(x)=\\begin{cases} ... \\end{cases}$$。
- 不要把普通文字放进数学 delimiter；只包数学表达式本身。
- 如果图形/图表题的视觉信息无法完整转写，可以保留可读文本并在 visualRefs / validationErrors 标注，但不要因为图形存在就放弃整题。
- 图像题不要伪造图片 URL；只在 sourceMeta.structure.visualRefs 写清依赖的 Figure/Graph/Diagram 和页码，系统会把对应页面图像挂到 publicContent.assets.images。

${formattingContract}

辅助 Source Package（仅作页码/OCR 提示，不是权威题面）：
${compactSource}`
    : `Read the attached PDF directly and perform the full problem-bank import. Return strict JSON object only, no markdown and no explanation.

Goal: the model directly identifies problem boundaries, excludes non-problem pages, rewrites student-facing stems, transcribes LaTeX, and generates drafts. Local code does not pre-split problems. Treat the visible PDF as authoritative; the source package text below is only auxiliary OCR/page-number context.

Return shape:
{
  "structurePlan": {
    "sourceSummary": "short summary",
    "nonProblemRegions": [{"kind":"cover|instructions|additional_work|blank|header_footer|other","pageNumbers":[1],"reason":"..."}],
    "sharedContexts": [{"id":"ctx_1","title":"...","pageNumbers":[2],"summary":"..."}],
    "topLevelProblems": [
      {
        "index": 1,
        "topLevelLabel": "1",
        "title": "concept-focused title",
        "problemTypeHint": "choice|proof|calculation|short_answer|code|fill_blank|unknown",
        "pageStart": 2,
        "pageEnd": 2,
        "sourceAnchors": [{"pageNumber":2,"sourcePageId":"page_2","textQuote":"short opening quote","role":"problem"}],
        "subparts": [{"label":"a","prompt":"subpart intent","points":3}],
        "contextBlocks": [{"kind":"definition|conditions|table|diagram|code|data|hint|other","title":"...","summary":"..."}],
        "visualRefs": [],
        "confidence": 0.0
      }
    ],
    "warnings": [],
    "generatedBy": "llm"
  },
  "drafts": []
}

Hard requirements:
- You decide the problem boundaries directly; do not copy local roleHint or heuristic conclusions.
- Preserve the PDF's original language: English questions must remain English and Chinese questions must remain Chinese. Do not translate or localize stems, titles, options, or subparts.
- publicContent.stem (or stemTemplate for fill blanks) is a directly answerable student prompt. Preserve the objective, cognitive demand, and approximate difficulty, but adapt interfaces and delivery type when required by platform capabilities. Do not translate or introduce unrelated concepts.
- Organize by top-level question by default. However, split independently answered and independently scored repeated units—such as table rows or code-tracing rows—into separate structure items and drafts, copying shared context into each.
- Do not output covers, instructions, blank pages, or additional-work pages.
- drafts count must equal structurePlan.topLevelProblems count, in the same order.
- Every draft.sourceMeta.scaffoldIndex must match its topLevelProblems.index.
- Every draft.sourceMeta.anchors must include page numbers.
- Keep tags as an empty array. Do not output tagPaths, knowledge tags, or taxonomy categories; chapter filing happens separately after the teacher creates chapters.
- Independently solve every problem and generate grading data. Student handwriting, selected bubbles, scores, and grader comments are not part of the problem statement and must not be copied as the authoritative answer.
- Preserve the source response mode and cognitive demand. Code-output prediction and error diagnosis are code_reading tasks and may use choice, fill_blank, or short_answer according to the source. Adapt a type only when the original interaction cannot be rendered or graded reliably.
- For choice use correctOptionIds; for calculation use referenceAnswer plus at least one acceptedForms entry containing only the final result and include tolerance/unit when applicable; for short_answer use referenceAnswer/rubric/rubricCriteria; for proof use referenceProof/rubric/rubricCriteria; for every fill_blank blank provide answerKind, acceptedAnswers, and matcher.
- Use code only for function-implementation tasks. Inputs must be function parameters and results must be returned with return. Do not rely on input(), stdin, print-based grading, or file I/O. Adapt unsupported source interfaces and record the change in sourceMeta.adaptation without requiring teacher confirmation.
- Every code problem must include complete solutionCode, annotated starterCode with a docstring, functionSignature, LeetCode-style statementSections, at least 2 distinct publicTests, and at least 3 distinct secretTests. Testcases are structured inputs for fixed unittest files: expression is one target-function call and expected is its return value. The solution must pass every test.
- Record transformations in sourceMeta.adaptation as {"status":"exact|adapted","originalKind":"...","deliveryType":"...","changes":[],"preservedObjectives":[]}. If the objective and difficulty cannot be preserved as code, choose a supported non-code type rather than emitting an ungradable problem.
- Fill blanks use publicContent.stemTemplate with a {{blank_id}} marker for each blank. IDs in publicContent.blanks and grading.blanks must match exactly.
- Set sourceMeta.answerSource to "llm-solved" for model-derived answers. If a problem truly cannot be solved reliably, keep it and add a precise validationErrors entry instead of inventing an answer.
- Math stems must be readable Markdown + LaTeX; do not emit OCR garbage, Unicode math symbols, bare math, or flattened formulas.
- Use $$...$$ for cases, matrices, long integrals, and long limits; use $...$ for short inline formulas.
- Do not split one formula into many adjacent $...$ fragments. A piecewise function must be one complete display block, e.g. $$f(x)=\\begin{cases} ... \\end{cases}$$.
- Do not put ordinary prose inside math delimiters; wrap only mathematical expressions.
- For image/graph/diagram questions, do not invent image URLs. Record the needed Figure/Graph/Diagram in sourceMeta.structure.visualRefs with page anchors; the system will attach source page images to publicContent.assets.images.

${formattingContract}

Auxiliary Source Package:
${compactSource}`;
}

export function problemStemFormattingContract(language: 'zh-CN' | 'en-US'): string {
  return language === 'zh-CN'
    ? String.raw`Syntara 题库交付协议 v1（科目无关）：
- 你的角色是“题库编译器”，不是聊天助手、讲课助手或自由写作助手。你要把原始材料编译成学生可以直接阅读、作答且系统可以稳定评分的题目。
- 平台把题目分成三层：taskKind 表示考查任务，responseKind 表示学生作答控件，graderKind 表示评分器。不要因为考查代码就一律生成代码编辑器题。
- taskKind 只能是 concept、code_reading、calculation、proof、implementation。代码追踪、输出预测和报错分析属于 code_reading；只有要求学生实现函数才属于 implementation。
- publicContent 必须写 contractVersion="syntara.problem.v1"、statementFormat="syntara-markdown-v1"、合适的 taskKind 和与题型一致的 responseKind。grading 必须写与题型一致的 graderKind。

学生题面 Markdown 契约：
- publicContent.stem（填空题为 stemTemplate）是最终直接渲染给学生的 Markdown，不是 OCR dump、摘要、JSON 说明、答案或评分规则。
- 普通文字使用段落；条件/步骤/性质使用 Markdown 列表；数据矩阵、真值表和表格使用 GFM Markdown 表格；代码必须放入带语言名的 fenced code block。
- 行内函数名、变量名、文件名和代码片段使用反引号，例如 \`len(items)\`。代码块和行内代码内部绝不能插入数学定界符。
- 只有数学表达式使用 LaTeX：短公式使用 $...$；矩阵、分段函数、长积分、长极限和多行推导使用独立 $$...$$。不要把普通文字或程序代码放进 $...$。
- 题目必须脱离原 PDF 独立作答。共享材料复制到依赖它的题目；不能只写“见上表”“见图”“如上”或 “Table I”。
- 默认保持原题的作答方式和认知要求。只有原交互无法稳定展示或评分时才适配题型，并在 sourceMeta.adaptation 记录原因；不得全局优先改成选择题。

题型交付契约：
- choice：publicContent.responseKind="choice"，taskKind 根据实际任务填写，selectionMode 为 single 或 multiple；options 是 2-12 个 {id,label,format:"syntara-markdown-inline-v1"}。stem 不得重复选项；label 必须是完整 Markdown 选项，不能只写 A/B/C。grading.graderKind="exact_choice"，correctOptionIds 必须引用真实选项；单选恰好一个正确答案。干扰项应对应可信的常见错误，不得随机编造。
- fill_blank：publicContent.responseKind="fill_blank"；stemTemplate 用 {{blank_id}} 标记每个输入框；每个 publicContent.blanks 项包含相同 id、answerKind=text|number|math_expression|code_token。grading.graderKind="blank_match"；每个 grading blank 的 id 必须一一对应，包含 acceptedAnswers、matcher=exact|normalized_exact|numeric_tolerance，数值匹配可给 tolerance。不得把解释文字、JSON 字段名或标点碎片放入 acceptedAnswers。
- calculation：只用于“提交最终数学结果并自动比对”的题，publicContent.taskKind="calculation"、responseKind="math_expression"、showWork=false；grading.graderKind="numeric_or_exact"，必须给 referenceAnswer 和至少一个只含最终结果的 acceptedForms，需要时给 tolerance、relativeTolerance 和 unit。若解题过程计分，必须改用 short_answer + taskKind="calculation" + graderKind="rubric" + rubricCriteria，让学生提交完整过程，不能仍用 calculation 的最终值比较器。
- short_answer：publicContent.responseKind="short_text"，可用 taskKind=concept、code_reading 或 calculation（需要按过程评分时）。grading.graderKind="rubric"，必须给 referenceAnswer 和 rubricCriteria=[{id,description,points}]；每项是独立可核验得分点，criteria 总分等于题目 points。
- proof：publicContent.taskKind="proof"、responseKind="long_text"。题面明确给出已知条件与证明目标。grading.graderKind="rubric"，必须给 referenceProof 和 rubricCriteria；每个 criterion 是独立可核验的得分点，criteria 总分等于题目 points。
- code：只用于 implementation。当前可执行适配器为 language="python"、runnerAdapter="python-unittest"。题面采用 LeetCode 式结构，statementSections 至少包含 overview、requirements、interface、examples、constraints；明确参数、返回值、前置条件、边界和示例。starterCode 必须包含带参数与返回类型注解的 function signature、完整 docstring 和 pass；solutionCode 是完整参考实现。

Python 测试文件契约：
- publicTests 是学生可见的基础行为与题面示例，至少 2 个；secretTests 是学生不可见、老师可查看的边界与常见错误测试，至少 3 个；两组不得重复。
- 每个内部 testcase 使用 {id,description,expression,expected}。id 是有意义的 snake_case 场景名；expression 只是一条目标函数调用；expected 是返回值字面量。不得输出 assert、print、input、open、多行代码或导入。
- 平台会把 publicTests 确定性编译为以下固定文件，不要生成 pytest：
  # public_tests.py
  import unittest
  from submission import *

  class PublicTests(unittest.TestCase):
      def test_<scenario>(self):
          self.assertEqual(<expression>, <expected>)

  if __name__ == "__main__":
      unittest.main()
- secretTests 同样编译为 secret_tests.py，类名固定为 SecretTests。参考答案必须通过两个文件中的全部测试。
- 语言与 runnerAdapter 是可扩展边界；不要假设所有未来语言都使用 Python 测试格式。只有任务明确选择 Java/JUnit 适配器时才能输出 Java 语言包。

编译流程要求：
- 先识别材料角色和可独立评分单元，再选择 taskKind、responseKind、graderKind，最后填充对应 schema。
- 依赖同一推导的子问保留在一题；彼此独立作答和计分的重复行/项拆开。
- 独立求解并生成评分数据；学生手写、勾选、分数和批注不是权威答案。
- 无法可靠识别或求解时保留题目，在 validationErrors 写清楚原因，不得伪造答案或偷偷使用第一个选项充当正确答案。`
    : String.raw`Syntara problem delivery contract v1 (subject agnostic):
- You are a problem compiler, not a chat assistant or a free-form author. Compile source material into a student-readable, directly answerable, reliably gradable problem.
- Separate taskKind (concept, code_reading, calculation, proof, implementation), responseKind, and graderKind. Code tracing/output/error diagnosis is code_reading; only function implementation uses implementation/code_submission.
- Add contractVersion="syntara.problem.v1" and statementFormat="syntara-markdown-v1" to publicContent. Add the matching taskKind/responseKind and graderKind.
- The stem is final student-facing Markdown, not OCR, metadata, an answer, or prompt commentary. Use paragraphs, Markdown lists, GFM tables, and language-labelled fenced code blocks according to meaning. Use backticks for identifiers. Never add math delimiters inside code. Use $...$ only for inline math and $$...$$ for standalone/structured math.
- Preserve the original response demand and cognitive load. Adapt the response type only when the source interaction cannot be rendered or graded reliably; do not globally prefer multiple choice.
- choice: responseKind="choice", 2-12 complete Markdown options, valid single/multiple mode, graderKind="exact_choice", and correctOptionIds referencing existing options. Distractors must represent plausible misconceptions.
- fill_blank: use one {{blank_id}} marker per public blank; answerKind is text|number|math_expression|code_token. The grading blank IDs must match exactly and use matcher exact|normalized_exact|numeric_tolerance with acceptedAnswers and optional tolerance.
- calculation is only for final-result auto-matching: taskKind="calculation", responseKind="math_expression", showWork=false, graderKind="numeric_or_exact", referenceAnswer, final-only acceptedForms, and applicable tolerance/relativeTolerance/unit. If solution steps earn credit, use short_answer + taskKind="calculation" + graderKind="rubric" + rubricCriteria so the student can submit the full derivation.
- short_answer/proof: graderKind="rubric"; a reference answer/proof and point-valued rubricCriteria are mandatory, every criterion must be independently verifiable, and the total must equal problem points. Proof stems state givens and the target explicitly.
- code: only function implementation. The active adapter is language="python", runnerAdapter="python-unittest". Use LeetCode-style statementSections covering overview, requirements, interface, examples, and constraints. starterCode contains an annotated signature, a complete docstring, and pass; solutionCode is complete.
- publicTests contain at least 2 visible examples/basic behaviors. secretTests contain at least 3 hidden boundary and misconception tests. They must not overlap. Each testcase is {id,description,expression,expected}; id is a meaningful snake_case scenario, expression is one target-function call, and expected is the returned literal. Never put assert, print, input, open, imports, or multiline code in a testcase.
- The platform deterministically compiles those cases to public_tests.py / PublicTests and secret_tests.py / SecretTests using unittest, from submission import *, self.assertEqual(...), and the standard unittest.main() block. Do not generate pytest.
- Language and runnerAdapter are extension boundaries. Never assume a future Java/JUnit adapter uses Python test syntax.
- Keep shared derivations together and split independently answered/scored repeated units. Make every problem self-contained. Solve independently; handwriting, bubbles, scores, and grader comments are not authoritative answers. If uncertain, add a precise validationErrors entry rather than inventing content.`;
}

export function buildProblemImportSystemPrompt(language: 'zh-CN' | 'en-US'): string {
  return language === 'zh-CN'
    ? `你是运行在 Syntara 题库中的评测编译器，不是聊天助手。请把输入材料编译成一组可直接展示、作答和评分的题目草稿，并返回严格 JSON 数组，不要返回 markdown。
每个数组元素都必须尽量贴近以下结构：
{
  "title": string,
  "type": "short_answer" | "choice" | "proof" | "calculation" | "code" | "fill_blank",
  "points": number,
  "difficulty": "easy" | "medium" | "hard",
  "tags": [],
  "publicContent": {...},
  "grading": {...},
  "secretJudge": {...optional...},
  "sourceMeta": {...optional...},
  "validationErrors": string[]
}
${problemStemFormattingContract(language)}
要求：
- 默认按顶层题号组织；彼此独立作答和计分的表格行、代码追踪行或重复单元拆成多个对象
- 不要拆开共享同一推导过程的证明题或复合题；只有可独立作答和计分的单元才拆分
- title 必须是简洁、稳定、概念导向的题目名，优先概括知识点与任务，不要直接复制整句题面，不要把公式原样塞进 title
- tags 必须保持为空数组，不要输出 tagPaths、知识标签或知识树分类；章节归档由老师建立章节后单独完成
- 每道题的 publicContent 必须能独立作答；不要只写“见上表 / 见图 / front page / Table I / Diagram II”
- 按材料语义选择 stem 表达方式：枚举/步骤/条件用列表；数据矩阵/表格/真值表用 markdown 表格；代码用 fenced code block；图形/流程/关系图用可读的节点、边、状态、箭头或邻接关系列表
- 共享上下文必须复制进依赖它的题目，或整理成该题开头的“背景/材料/数据/定义”块
- choice 题必须拆出 publicContent.options 与 grading.correctOptionIds
- publicContent.options 必须是数组，形如 [{"id":"A","label":"完整选项文本"}, ...]；label 必须是完整可作答的选项内容，绝不能只写 "A" / "B" / "C" 这样的字母
- 每一道题都必须生成评分答案，并在 sourceMeta.answerSource 写 "llm-solved"；不要把学生作答、勾选、分数或教师批注当作权威答案，必须根据题面独立求解
- choice 使用 correctOptionIds；calculation 使用 referenceAnswer、至少一个只包含最终结果的 acceptedForms，以及适用的 tolerance/unit；short_answer 使用 referenceAnswer/rubric/rubricCriteria；proof 使用 referenceProof/rubric/rubricCriteria，且 criteria 总分必须等于题目 points
- 保持原题的作答方式与认知要求；只有原交互无法稳定展示或评分时才适配题型
- code 只用于函数实现题，必须提供 LeetCode 式 statementSections、带类型注解和 docstring 的 starterCode、完整 solutionCode、functionSignature、至少 2 个 public tests 和 3 个 secret tests；参考答案必须通过全部 unittest
- fill_blank 使用 stemTemplate，并以 {{blank_id}} 标出空位；publicContent.blanks 与 grading.blanks 的 id 一一对应，每个 blank 都必须有 answerKind、acceptedAnswers 和 matcher
- 题干缺少图表或前文等关键上下文、无法可靠解答时，在 validationErrors 写清原因；不得使用第一个选项作为伪造答案
- code 题默认 language=python
- code 只能接收函数参数并通过 return 返回结果；不得使用 input、stdin、print 判分或文件读写。不支持的原题接口必须自动等价改写
- 直接输出 LaTeX 数学源码：行内数学使用 $...$，较长或独立公式使用 $$...$$
- publicContent / grading / choice option label 里的所有数学都必须包在 LaTeX delimiter 中
- 不要输出裸数学、Unicode 数学符号或纯文本数学命令；例如不要写 "A ⊆ X"、"leq"、"subseteq"、"f: X → Y"，要写 "$A \\subseteq X$"、"$\\leq$"、"$\\subseteq$"、"$f: X \\to Y$"
- 不要把已经是 LaTeX 的数学再额外用普通括号包起来
- 无法可靠求解时，在 validationErrors 写清原因，不要伪造答案`
    : `You are the assessment compiler inside Syntara, not a chat assistant. Compile the source material into student-readable, answerable, gradable problem drafts and return strict JSON only.
Each item should follow this shape as closely as possible:
{
  "title": string,
  "type": "short_answer" | "choice" | "proof" | "calculation" | "code" | "fill_blank",
  "points": number,
  "difficulty": "easy" | "medium" | "hard",
  "tags": [],
  "publicContent": {...},
  "grading": {...},
  "secretJudge": {...optional...},
  "sourceMeta": {...optional...},
  "validationErrors": string[]
}
${problemStemFormattingContract(language)}
Requirements:
- organize by top-level number by default; split independently answered and scored table rows, code-tracing rows, or repeated units into separate objects
- do not split proof or compound parts that share one derivation; split only independently answerable and scored units
- title must be concise, concept-focused, and stable; summarize the topic/task instead of copying the whole stem, and avoid dumping raw formulas into the title
- keep tags as an empty array; do not output tagPaths, knowledge tags, or taxonomy categories because chapter filing happens separately after the teacher creates chapters
- every publicContent item must be independently answerable; do not leave references like "see above", "front page", "Table I", or "Diagram II" without the referenced content
- choose the stem representation by material semantics: enumerations, steps, and conditions become lists; data matrices, tables, and truth tables become markdown tables; code becomes fenced code blocks; diagrams, flows, and relationship graphs become readable node/edge/state/arrow/adjacency lists
- shared context must be copied into every problem that depends on it, or rewritten as a Background / Material / Data / Definitions block at the start of that stem
- choice problems must include publicContent.options and grading.correctOptionIds
- publicContent.options must be an array like [{"id":"A","label":"full option text"}, ...]; label must be the complete answer choice text and must never be only "A" / "B" / "C" / the option id
- every problem must include grading answers and sourceMeta.answerSource="llm-solved"; do not treat student handwriting, selected bubbles, scores, or grader comments as authoritative answers; solve from the problem statement independently
- choice uses correctOptionIds; calculation uses referenceAnswer, at least one acceptedForms entry containing only the final result, and tolerance/unit when applicable; short_answer uses referenceAnswer/rubric/rubricCriteria; proof uses referenceProof/rubric/rubricCriteria, and criteria points must sum to the problem points
- preserve the original response demand and cognitive load; adapt the type only when the source interaction cannot be rendered or graded reliably
- code is only for function implementation and must include LeetCode-style statementSections, annotated starterCode with a docstring, complete solutionCode, functionSignature, at least 2 public tests, and at least 3 secret tests; the reference solution must pass every unittest
- fill_blank uses stemTemplate with a {{blank_id}} marker for each blank; publicContent.blanks and grading.blanks must have matching IDs and every blank must include answerKind, acceptedAnswers, and matcher
- if critical context is missing and the answer cannot be solved reliably, explain it in validationErrors; never use the first option as a fabricated answer
- code problems default to python
- code accepts inputs only as function parameters and returns results with return; input(), stdin, print-based grading, and file I/O must be automatically and equivalently adapted
- Output LaTeX math source directly: use $...$ for inline math and $$...$$ for long or standalone formulas
- every mathematical expression in publicContent / grading text / choice option labels must be wrapped in LaTeX delimiters
- do not emit bare math, Unicode math symbols, or plain-text math commands; for example, never write "A ⊆ X", "leq", "subseteq", or "f: X → Y"; write "$A \\subseteq X$", "$\\leq$", "$\\subseteq$", and "$f: X \\to Y$"
- do not wrap LaTeX math in additional ordinary prose parentheses
- if a problem cannot be solved reliably, explain why in validationErrors instead of inventing an answer`;
}
