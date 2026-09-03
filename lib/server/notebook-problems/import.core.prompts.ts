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
- 必须为每道题独立解题并生成可评分答案；学生手写内容、勾选、分数和教师批注不是题面，也不能直接当作标准答案。
- 题型优先级：在不明显降低难度时优先 choice；代码输出预测、报错判断和表格逐行作答通常拆成独立 choice。只有改成 choice 会显著降低回忆、推导或作答难度时，才使用 fill_blank 或开放题型。
- choice 填 correctOptionIds；calculation 填 referenceAnswer、至少一个仅含最终结果的 acceptedForms，并在适用时填 tolerance/unit；short_answer 填 referenceAnswer/rubric；proof 填 referenceProof/rubric；fill_blank 为每个 blank 填 acceptedAnswers。
- code 只用于让学生实现函数的题目。题目必须使用函数参数输入并通过 return 返回结果；不得依赖 input、stdin、print 判分或文件读写。原题若使用这些接口，等价改写接口并在 sourceMeta.adaptation 记录改动，但不要求老师确认。
- 每道 code 必须填完整 solutionCode、functionSignature、至少 2 个互不重复的 publicTests 和至少 3 个互不重复的 secretTests。测试采用 expression + expected 的 pytest 风格，expression 必须调用目标函数并只检查返回值；solutionCode 必须能通过全部测试。
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
- Independently solve every problem and generate grading data. Student handwriting, selected bubbles, scores, and grader comments are not part of the problem statement and must not be copied as the authoritative answer.
- Prefer choice whenever it does not materially reduce difficulty. Code-output prediction, error diagnosis, and independently answered table rows normally become separate choice problems. Use fill_blank or open response only when options would materially reduce recall, derivation, or construction difficulty.
- For choice use correctOptionIds; for calculation use referenceAnswer plus at least one acceptedForms entry containing only the final result and include tolerance/unit when applicable; for short_answer use referenceAnswer/rubric; for proof use referenceProof/rubric; for fill_blank provide acceptedAnswers for every blank.
- Use code only for function-implementation tasks. Inputs must be function parameters and results must be returned with return. Do not rely on input(), stdin, print-based grading, or file I/O. Adapt unsupported source interfaces and record the change in sourceMeta.adaptation without requiring teacher confirmation.
- Every code problem must include complete solutionCode, functionSignature, at least 2 distinct publicTests, and at least 3 distinct secretTests. Tests use expression + expected in a pytest-like form; every expression calls the target function and checks its return value. The solution must pass all tests.
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
    ? String.raw`题库抽取任务模型（科目无关）：
- 你的任务不是“复制 PDF 文本”，而是把原始材料转换成可进入题库的 problem draft。题库题面必须让学生脱离原 PDF 也能直接作答。
- 在输出 JSON 前，先在内部完成这三步，不要把分析过程输出出来：
  1. 识别材料角色：封面、考试说明、页眉页脚、空白页、题目、共享材料、表格、图、代码块、数据、提示、评分说明。
  2. 建立可评分单元：默认保留顶层题号；但表格逐行作答、逐段代码追踪等彼此独立且独立计分的重复单元，要拆成多道题，共享材料复制到每题。
  3. 编译成平台题面：保持核心考点、认知要求和大致难度，保留所有作答所需信息，并把不支持的交互接口改成可稳定展示和判分的形式。
- publicContent.stem 是“整理后的学生可见题面”，不是 OCR dump，不是摘要，也不是 prompt 解释。
- JSON 必须是严格 JSON；stem 字符串中的换行用 \n 或 \n\n 编码，但渲染后必须有真实分段。
- 拆题原则：依赖共同推导过程的子问保留在同一 stem；彼此独立作答和计分的重复行/项拆成独立 draft。
- 结构原则：任何枚举型材料都不能压成一段。条件、性质、假设、要求、步骤、案例事实、数据说明、可选项、提示、注释、定义块必须按原本语义整理成 markdown 列表、表格、代码块或独立段落。
- 题型适配：不明显降低难度时优先选择题，尽量少用填空题；代码输出预测和报错判断优先转成选择题。只有选项会明显降低回忆、推导或构造难度时才使用填空或开放题型。
- 代码题边界：只生成“实现一个函数”的 Python 代码题。输入来自函数参数，结果通过 return 返回；不支持 input、stdin、print 判分和文件读写。原题使用不支持接口时等价改写，保留考点。
- 代码题质量：必须有完整参考答案、functionSignature、至少 2 个 public tests 和 3 个 secret tests；每个测试调用目标函数并比较返回值，参考答案必须通过全部测试。
- 科目适配：数学保留定义、符号和证明目标；计算机保留算法、约束和测试语义；理科保留单位、实验条件、图表数据；人文社科保留材料、引文、案例事实和具体问法。不要用某一科目的模板强套所有题。
- 在 sourceMeta.adaptation 记录 exact/adapted、原始形态、交付题型、保留考点和接口改动。适配是自动完成的，不要求老师确认。
- 如果题目依赖图片/图形/表格/代码/共享材料，必须把可读出的关系、数据、节点、边、列、行、代码或上下文写入同一道 stem。不能只写“见图”“如上”“front page”“Table I”。
- sourceMeta.structure 应简短记录你识别到的结构，例如 topLevelLabel、subparts、contextBlocks、visualRefs；这用于调试，不要替代 stem。`
    : String.raw`Subject-agnostic problem extraction model:
- Your job is not to copy PDF text. Convert source material into problem-bank drafts. A student must be able to answer each imported problem without opening the original PDF.
- Before returning JSON, perform these internal steps. Do not output the analysis:
  1. Identify material roles: cover, exam instructions, headers/footers, blank pages, problems, shared context, tables, diagrams, code blocks, datasets, hints, and grading notes.
  2. Build gradable units: preserve top-level numbering by default, but split independently answered and independently scored repeated units such as table rows and code-tracing rows into separate problems, copying shared context into each.
  3. Compile into a platform problem: preserve the objective, cognitive demand, and approximate difficulty while adapting unsupported interaction interfaces into reliably rendered and gradable forms.
- publicContent.stem is the cleaned student-facing statement. It is not an OCR dump, not a summary, and not an explanation of your prompt.
- The response must be strict JSON; encode line breaks inside stem strings as \n or \n\n, but the rendered stem must have real sections.
- Splitting rule: subparts that share one derivation remain in one stem; independently answered and scored repeated rows/items become separate drafts.
- Structure rule: enumerated material must not be flattened into one paragraph. Conditions, properties, assumptions, requirements, steps, case facts, data notes, options, hints, notes, definitions, and setup blocks must be represented as markdown lists, tables, code blocks, or separate paragraphs according to their meaning.
- Type adaptation: prefer choice when it does not materially reduce difficulty and minimize fill blanks. Code-output prediction and error diagnosis normally become choice. Use fill blanks or open response only when options would materially reduce recall, derivation, or construction difficulty.
- Code boundary: emit Python code problems only for function implementation. Inputs are function parameters and results use return. input(), stdin, print-based grading, and file I/O are unsupported and must be equivalently adapted while preserving the assessed concept.
- Code quality: include a complete reference solution, functionSignature, at least 2 public tests and 3 secret tests. Every test calls the target function and compares the return value, and the reference solution must pass every test.
- Subject adaptation: for math, preserve definitions, symbols, and proof goals; for computer science, preserve algorithms, constraints, and test semantics; for science, preserve units, experimental conditions, and graph/table data; for humanities/social science, preserve source material, quotations, case facts, and exact prompts. Do not force every subject into a math-specific template.
- Record exact/adapted status, original form, delivery type, preserved objectives, and interface changes in sourceMeta.adaptation. Adaptation is automatic and does not require teacher confirmation.
- If a problem depends on an image, diagram, table, code, or shared context, transcribe the readable relationships, data, nodes, edges, columns, rows, code, or context into the same stem. Never leave only "see figure", "above", "front page", or "Table I".
- sourceMeta.structure should briefly record the structure you recognized, such as topLevelLabel, subparts, contextBlocks, and visualRefs; this is for debugging and must not replace the stem.`;
}

export function buildProblemImportSystemPrompt(language: 'zh-CN' | 'en-US'): string {
  return language === 'zh-CN'
    ? `你是大学课程题库抽取助手。请把输入材料拆成一组题目草稿，并返回严格 JSON 数组，不要返回 markdown。
每个数组元素都必须尽量贴近以下结构：
{
  "title": string,
  "type": "short_answer" | "choice" | "proof" | "calculation" | "code" | "fill_blank",
  "points": number,
  "difficulty": "easy" | "medium" | "hard",
  "tags": string[],
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
- 每道题的 publicContent 必须能独立作答；不要只写“见上表 / 见图 / front page / Table I / Diagram II”
- 按材料语义选择 stem 表达方式：枚举/步骤/条件用列表；数据矩阵/表格/真值表用 markdown 表格；代码用 fenced code block；图形/流程/关系图用可读的节点、边、状态、箭头或邻接关系列表
- 共享上下文必须复制进依赖它的题目，或整理成该题开头的“背景/材料/数据/定义”块
- choice 题必须拆出 publicContent.options 与 grading.correctOptionIds
- publicContent.options 必须是数组，形如 [{"id":"A","label":"完整选项文本"}, ...]；label 必须是完整可作答的选项内容，绝不能只写 "A" / "B" / "C" 这样的字母
- 每一道题都必须生成评分答案，并在 sourceMeta.answerSource 写 "llm-solved"；不要把学生作答、勾选、分数或教师批注当作权威答案，必须根据题面独立求解
- choice 使用 correctOptionIds；calculation 使用 referenceAnswer、至少一个只包含最终结果的 acceptedForms，以及适用的 tolerance/unit；short_answer 使用 referenceAnswer/rubric；proof 使用 referenceProof/rubric
- 不明显降低难度时优先 choice，代码输出预测和报错判断通常改成 choice；尽量少用 fill_blank
- code 只用于函数实现题，必须提供完整 solutionCode、functionSignature、至少 2 个 public tests 和 3 个 secret tests；参考答案必须通过全部测试
- fill_blank 使用 stemTemplate，并以 {{blank_id}} 标出空位；publicContent.blanks 与 grading.blanks 的 id 一一对应，每个 grading blank 都必须有 acceptedAnswers
- 只有在题干缺少图表/前文等关键上下文、无法可靠解答时，才使用第一个选项 id 作为 schema 占位，并在 validationErrors 加入“未识别到正确答案”
- code 题默认 language=python
- code 只能接收函数参数并通过 return 返回结果；不得使用 input、stdin、print 判分或文件读写。不支持的原题接口必须自动等价改写
- 直接输出 LaTeX 数学源码：行内数学使用 $...$，较长或独立公式使用 $$...$$
- publicContent / grading / choice option label 里的所有数学都必须包在 LaTeX delimiter 中
- 不要输出裸数学、Unicode 数学符号或纯文本数学命令；例如不要写 "A ⊆ X"、"leq"、"subseteq"、"f: X → Y"，要写 "$A \\subseteq X$"、"$\\leq$"、"$\\subseteq$"、"$f: X \\to Y$"
- 不要把已经是 LaTeX 的数学再额外用普通括号包起来
- 无法可靠求解时，在 validationErrors 写清原因，不要伪造答案`
    : `You are a university problem-bank extraction assistant. Convert the source material into an array of problem drafts and return strict JSON only.
Each item should follow this shape as closely as possible:
{
  "title": string,
  "type": "short_answer" | "choice" | "proof" | "calculation" | "code" | "fill_blank",
  "points": number,
  "difficulty": "easy" | "medium" | "hard",
  "tags": string[],
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
- every publicContent item must be independently answerable; do not leave references like "see above", "front page", "Table I", or "Diagram II" without the referenced content
- choose the stem representation by material semantics: enumerations, steps, and conditions become lists; data matrices, tables, and truth tables become markdown tables; code becomes fenced code blocks; diagrams, flows, and relationship graphs become readable node/edge/state/arrow/adjacency lists
- shared context must be copied into every problem that depends on it, or rewritten as a Background / Material / Data / Definitions block at the start of that stem
- choice problems must include publicContent.options and grading.correctOptionIds
- publicContent.options must be an array like [{"id":"A","label":"full option text"}, ...]; label must be the complete answer choice text and must never be only "A" / "B" / "C" / the option id
- every problem must include grading answers and sourceMeta.answerSource="llm-solved"; do not treat student handwriting, selected bubbles, scores, or grader comments as authoritative answers; solve from the problem statement independently
- choice uses correctOptionIds; calculation uses referenceAnswer, at least one acceptedForms entry containing only the final result, and tolerance/unit when applicable; short_answer uses referenceAnswer/rubric; proof uses referenceProof/rubric
- prefer choice when it does not materially reduce difficulty; code-output prediction and error diagnosis normally become choice; minimize fill_blank
- code is only for function implementation and must include complete solutionCode, functionSignature, at least 2 public tests, and at least 3 secret tests; the reference solution must pass every test
- fill_blank uses stemTemplate with a {{blank_id}} marker for each blank; publicContent.blanks and grading.blanks must have matching IDs and every grading blank must include acceptedAnswers
- only if critical context is missing and the answer cannot be solved reliably, use the first option id as a schema placeholder and add "未识别到正确答案" to validationErrors
- code problems default to python
- code accepts inputs only as function parameters and returns results with return; input(), stdin, print-based grading, and file I/O must be automatically and equivalently adapted
- Output LaTeX math source directly: use $...$ for inline math and $$...$$ for long or standalone formulas
- every mathematical expression in publicContent / grading text / choice option labels must be wrapped in LaTeX delimiters
- do not emit bare math, Unicode math symbols, or plain-text math commands; for example, never write "A ⊆ X", "leq", "subseteq", or "f: X → Y"; write "$A \\subseteq X$", "$\\leq$", "$\\subseteq$", and "$f: X \\to Y$"
- do not wrap LaTeX math in additional ordinary prose parentheses
- if a problem cannot be solved reliably, explain why in validationErrors instead of inventing an answer`;
}
