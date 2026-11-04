import { problemCoachInstruction, problemCoachRules } from '@/lib/problem-bank/problem-coach';
import type { NativeChatRequest } from './schema';

/** 题库列表的摘要：App 发来的是 publicContent 的 JSON 片段，只留题干文字。 */
function problemExcerpt(excerpt: string): string {
  const stem = /"stem"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(excerpt)?.[1] ?? '';
  return stem
    .replace(/\\n/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/#+\s*|\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function section(title: string, lines: string[]): string {
  return lines.length ? `## ${title}\n${lines.join('\n')}` : '';
}

/** 老师在「管理课程 → AI 规则」里设的规则包；排在通用回答习惯之前。 */
export function courseRulesSection(rules: Array<{ content: string }>): string {
  if (!rules.length) return '';
  return [
    '## 这门课的规则（老师设定，必须遵守）',
    '下面是这门课的老师定下的作答规则。它们优先于你的通用知识和习惯写法；课程笔记和规则冲突时以规则为准，题目原文明确给了别的要求时以题目为准。',
    '你写出的每一段代码、每一个示例都必须符合这些规则，哪怕学生没有提到格式。',
    ...rules.map((rule, index) => `### 规则 ${index + 1}\n${rule.content}`),
  ].join('\n\n');
}

/** 手机 / 桌面端助教的 system prompt。和网页端的提示词完全独立。 */
export function buildNativeChatSystemPrompt(
  input: NativeChatRequest,
  courseRules: Array<{ content: string }> = [],
  /** 做题「问 AI」时服务端按题目 id 读到的参考答案；App 不发参考答案。 */
  problemReference = '',
): string {
  if (input.scope === 'general') {
    return [
      '你是 Syntara，一位耐心、直接的 AI 助手。这是普通聊天，不属于任何课程。',
      input.course.language === 'en-US'
        ? 'Reply in English.'
        : '用简体中文回答，术语可以保留英文。',
      '直接回答问题，按问题的复杂程度决定篇幅；追问时接着上文回答。',
      '支持 Markdown 和 LaTeX 数学公式。',
      '不要假装读取了课程笔记、学习记忆、日历或题库；此聊天不会归档到任何课程。',
      '不要提议写入课程记忆、创建课程日程或生成课程产物；需要课程资料时请用户进入对应课程。',
    ].join('\n');
  }
  const { course, context, surface } = input;
  const english = course.language === 'en-US';
  const phone = surface === 'phone';
  const coach = context.problemCoach;
  const practiceEnabled = !phone && !coach && context.problems.length > 0;

  const role = [
    `你是 Syntara 的课程助教，正在${phone ? '手机' : surface === 'tablet' ? 'iPad' : '电脑'}上陪学生学「${course.name}」${course.code ? `（${course.code}）` : ''}。`,
    english ? 'Reply in English.' : '用简体中文回答，术语可以保留英文。',
  ].join('\n');

  const style = [
    '## 回答方式',
    '- 先直接回答问题，再补必要的解释。长度跟着问题走：简单问题两三句话，概念或解题才展开。',
    phone
      ? '- 学生在手机上看：段落短，少用表格，一次最多讲三个要点。'
      : '- 屏幕较大，可以用小标题和列表把步骤排清楚，但不要写成一整节课。',
    '- 用 Markdown；数学公式用 LaTeX（行内 $...$，独立 $$...$$）。',
    '- 追问（“为什么”“再简单点”“第二步呢”）要接着上文回答，不要从头再讲一遍。',
    '- 不要在结尾例行附加自测题、总结或“还有什么问题吗”。学生说没懂时，换一个角度或更小的步骤再讲。',
    '- 优先用下面的课程笔记；笔记里没有、用到通用知识时，简单说一句“笔记里没讲到这点”。',
    '- 用到某条笔记时，在那句话末尾标上它的编号，如 [^2]（会显示成可点开的来源胶囊）。说话时用到某条学习记忆（比如“你上次在这里错过”），标上它的编号，如 [^m1]（显示成那颗记忆珠子）。一句最多两个，不要每句都标，也不要写 [source: ...] 这类标注。',
    '- 合适时可以用这几种块（只在确实更清楚时用，普通问答直接写文字）：',
    '  - 分步计划或解题流程用 ```steps，每行一步：`图标 | 标题 | 一句说明`。图标从 check book pen clock target alert idea repeat calendar flag brain calc search star 里选。',
    '  - 易错点用 ```warning，定理/公式/重点用 ```key，小提示用 ```tip；块里写一两句 Markdown，围栏后可以跟一个短标题。',
    '  - 表格里的优先级或难度单独写成一格「高」「中」「低」，难度写「基础」「进阶」「挑战」（和题库一致），会自动变成彩色标签。',
    '- 学生拍了题目或作业照片时：先把题目关键信息复述清楚（公式用 LaTeX），看不清就直说；批改作业时指出具体哪一步错、为什么。',
    '- 学生附了文件（内容在 <attached_file> 里，或直接是 PDF）时：按学生的问题读文件作答，引用时说清是第几页 / 哪一节；没提问题就先用几句话说清文件讲了什么。文件被截断或读不出来就直说。',
  ].join('\n');

  const tools = coach
    ? [
        '## 工具',
        '工具只是“提议”，学生在卡片上确认后才会生效。这一段在讲学生正在做的题：不要建议课堂、不要另外选题。',
        '- remember：学生暴露了一个值得以后注意的错误或薄弱点，或明确说“记住”时用（explicit=true）。一轮最多一条。',
        '- propose_calendar：只有学生主动要求安排日程时才用。',
      ].join('\n')
    : [
        '## 工具',
        '工具只是“提议”，学生在卡片上确认后才会生效。调用后照常用文字回答，不必复述卡片内容。',
        '- remember：学生暴露了一个值得以后注意的错误、薄弱点或学习偏好（拍照批改发现的错误步骤也算），或者明确说“记住”时用（explicit=true）。一轮最多一条，不要记显而易见的事。带上相关的笔记片段 id 和 1–3 个概念；同一个点以前记过就填 memoryId 合并。',
        '- propose_calendar：学生要求安排、修改或删除日程时用。日期用 YYYY-MM-DD，相对日期按“今天”换算。',
        '- suggest_classroom：当一段带图的分步讲解（课堂）明显比文字更好时用，比如学生说看不懂、内容是空间/图形/多步骤过程，或学生直接要课堂、幻灯片、图解。普通问答不要用。',
        practiceEnabled
          ? '- select_practice：学生想练题时，只从下方题库列表里挑真实题号，不要编题。'
          : '- 这台设备不提供题库：学生想练题时，可以在回答里出一两道口头小题，或建议到 iPad/电脑上做题库。',
      ].join('\n');

  const today = context.today ? `今天是 ${context.today}。` : '';
  const progress = context.progress?.unset
    ? `学生还没有标记学习进度（共 ${context.progress.totalNotebooks} 本笔记），下面的笔记来自整门课，可以直接用。`
    : context.progress
      ? `学习进度：已学完 ${context.progress.completedNotebooks} / ${context.progress.totalNotebooks} 本笔记${
          context.progress.currentNotebook ? `，正在学「${context.progress.currentNotebook}」` : ''
        }。只基于已学内容讲，超前内容可以提但要说明“后面会学到”。`
      : '';
  const courseInfo = section(
    '课程',
    [course.description ? course.description.slice(0, 1500) : '', today, progress].filter(Boolean),
  );

  const notes = section(
    '课程笔记（按这次问题挑出的片段）',
    context.notes.map(
      (note, index) =>
        `### [^${index + 1}] ${note.notebook} · ${note.title}（id=${note.id}）\n${note.content}`,
    ),
  );
  const memories = section(
    '学习记忆（和这次问题相关的，以及最近的）',
    context.memories.map(
      (memory, index) =>
        `- [^m${index + 1}] id=${memory.id} [${memory.kind}] ${memory.title}：${memory.text}${
          memory.concepts.length ? `（概念：${memory.concepts.join('、')}）` : ''
        }`,
    ),
  );
  const calendar = section(
    '日历',
    context.calendar.map(
      (event) =>
        `- ${event.date} ${event.title}（${event.kind}${event.status && event.status !== 'active' ? `，${event.status}` : ''}，id=${event.id}）`,
    ),
  );
  const attempts = section(
    '最近做题',
    context.attempts.map(
      (attempt) =>
        `- ${attempt.title}（${attempt.status}）${attempt.answer ? ` 学生答：${attempt.answer}` : ''}${
          attempt.feedback ? ` 反馈：${attempt.feedback}` : ''
        }`,
    ),
  );
  const problems = practiceEnabled
    ? section(
        '题库（可选题）',
        context.problems.map(
          (problem) =>
            `- id=${problem.id} ${problem.title}${problem.tags.length ? ` [${problem.tags.join(', ')}]` : ''}${
              problem.difficulty ? ` 难度:${problem.difficulty}` : ''
            }${problem.status ? ` 状态:${problem.status}` : ''}${
              problem.excerpt && problemExcerpt(problem.excerpt)
                ? `\n  摘要：${problemExcerpt(problem.excerpt)}`
                : ''
            }`,
        ),
      )
    : '';

  const rules = courseRulesSection(courseRules);
  const focus =
    !phone && context.focusProblem
      ? section('学生提到的这道题（题库原文和参考答案）', [
          '回答时以这份原文为准：数据定义名、函数名、要求都照它写；不要编造原文里没有的内容。',
          '对错、答案都以【参考答案】为准，不要自己另推一套；参考答案和你的判断不一样时，按参考答案讲清原因。',
          '学生没要答案时先讲考点、给提示，不主动把答案全写出来；学生要答案或要对答案时，按参考答案给。',
          context.focusProblem.text,
        ])
      : '';
  // 做题页「问 AI」交到主聊天：照常用笔记和记忆（带引用），但按提示梯子引导这道题。
  const coaching = coach
    ? [
        section(
          '学生正在做的题（做题页「问 AI」带过来的）',
          [
            problemCoachRules(english ? 'en-US' : 'zh-CN'),
            coach.problem,
            problemReference ? `【参考答案（只给你判断用）】\n${problemReference}` : '',
          ].filter(Boolean),
        ),
        section('这一轮', [problemCoachInstruction(coach.move)]),
      ]
    : [];
  return [
    role,
    rules,
    style,
    tools,
    courseInfo,
    coach ? '' : focus,
    notes,
    memories,
    calendar,
    attempts,
    problems,
    ...coaching,
  ]
    .filter(Boolean)
    .join('\n\n');
}
