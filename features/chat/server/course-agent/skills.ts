import { chatMaxOutputTokens } from '@/lib/ai/system-model-policy';

/**
 * Course-chat "skills": a deterministic task classifier, a per-task step and
 * output budget, and a concise per-task playbook appended to the system prompt.
 *
 * Everything here is pure and synchronous so it can be unit-tested without a
 * model or database.
 */

export const COURSE_TASKS = [
  'qa',
  'find_problems',
  'lecture_script',
  'worksheet',
  'document',
  'image',
  'learning_insight',
  'calendar',
] as const;

export type CourseTask = (typeof COURSE_TASKS)[number];
export type CourseSkillMode = 'teacher' | 'student';
export type CourseReplyLanguage = 'zh' | 'en';

export type ClassifyCourseTaskOptions = {
  mode: CourseSkillMode;
  hasAttachment: boolean;
  /**
   * Earlier user messages in this conversation, oldest first. Used only when the
   * latest message is a short follow-up with no task signal of its own
   * (e.g. "你从资料库里查", "把原题找出来"), so it inherits the previous task.
   */
  previousUserTexts?: string[];
};

const CALENDAR_PATTERN =
  /日历|日程|calendar|\bschedule\b|(?:安排|提醒|加到|加入|排到|挪到|改到|推迟|提前).{0,10}(?:周[一二三四五六日天]|星期|明天|后天|下周|本周|这周|下个月|\d{1,2}\s*[月号日点:：]|时间|几点)|(?:添加|新增|删除|取消|修改).{0,6}(?:事项|提醒|安排)/i;

const LECTURE_PATTERN =
  /逐字稿|讲稿|讲义|讲解稿|速成课|速成讲|授课稿|上课稿|教案|备课稿|课堂脚本|lecture\s*(?:script|notes?)|teaching\s*script|speaker\s*notes|crash\s*course|lesson\s*plan/i;

const WORKSHEET_PATTERN =
  /出题|出几道|出.{0,4}道题|编.{0,4}道?题|选择题|判断题|填空题|练习卷|练习单|测验|小测|随堂测|试卷|模拟题|worksheet|\bquiz(?:zes)?\b|multiple[\s-]*cho(?:ice|ise)|multip\s*choice|\bmcqs?\b|(?:write|create|make|generate|draft|give me)\b.{0,30}\bquestions?\b|practice\s*(?:set|questions?|problems?)/i;

const FIND_PROBLEMS_PATTERN =
  /找题|找.{0,6}题|类似的?题|相似的?题|同类题|相关的?题|对应的?题|真题|往年|历年|考过|原题|题库|similar\s+(?:problems?|questions?)|past\s+(?:exams?|papers?)|problem\s*bank|question\s*bank|find\s+(?:problems?|questions?)/i;

const LEARNING_INSIGHT_PATTERN =
  /学情|班级|全班|学生.{0,8}(?:情况|掌握|问题|提问|作答|进度|薄弱|错|表现|成绩)|(?:哪些|哪个|哪位|多少|几个)学生|掌握(?:情况|程度)|薄弱|错误率|正确率|作答情况|提交情况|student'?s?\s+(?:progress|performance|mastery|questions)|class\s+(?:overview|performance)|struggling/i;

const IMAGE_PATTERN =
  /画(?:一|个|张|出|幅|图)?|图片|示意图|配图|插图|流程图|思维导图|海报|\bimage\b|\bpicture\b|\bdiagram\b|\bdraw\b|illustrat(?:e|ion)|\bposter\b/i;

const DOCUMENT_PATTERN =
  /\bword\b|docx|\bpdf\b|文档|导出|下载|打印版|讲义文件|汇总|总结表|知识点(?:表|汇总|梳理|总结)|复习提纲|复习资料|cheat\s*sheet|handout|summary\s*(?:sheet|table)|\bexport\b|\bdownload\b/i;

const EXPORT_INTENT_PATTERN =
  /导出|下载|转成|转换成|做成|生成.{0,8}(?:word|docx|pdf|文档|文件)|(?:word|docx|pdf)\s*(?:版|文件|文档)|into\s+(?:a\s+)?(?:word|pdf|docx)|\bexport\b|\bdownload\b/i;

const FOLLOW_UP_PATTERN =
  /^(?:你|请|那|再|继续|接着|按照?|就|还是|帮我|麻烦)?.{0,6}(?:查|找|搜|看|写|改|做|继续|再来|按|照|重新)|^(?:again|continue|go on|redo|try again|search|look)/i;

const ATTACHMENT_SIMILAR_PATTERN =
  /类似|相似|对应|同类|一样|出现过|考过|similar|same\s+type|related/i;

function normalizeTaskText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function classifyByKeywords(
  text: string,
  options: Pick<ClassifyCourseTaskOptions, 'mode' | 'hasAttachment'>,
): CourseTask | null {
  const normalized = normalizeTaskText(text);
  if (!normalized) return null;
  if (CALENDAR_PATTERN.test(normalized)) return 'calendar';
  if (LECTURE_PATTERN.test(normalized)) return 'lecture_script';
  // "把这几道题导出成 Word" is a file request about existing content.
  if (EXPORT_INTENT_PATTERN.test(normalized)) return 'document';
  if (WORKSHEET_PATTERN.test(normalized)) return 'worksheet';
  if (FIND_PROBLEMS_PATTERN.test(normalized)) return 'find_problems';
  if (options.hasAttachment && ATTACHMENT_SIMILAR_PATTERN.test(normalized)) return 'find_problems';
  if (options.mode === 'teacher' && LEARNING_INSIGHT_PATTERN.test(normalized)) {
    return 'learning_insight';
  }
  if (IMAGE_PATTERN.test(normalized)) return 'image';
  if (DOCUMENT_PATTERN.test(normalized)) return 'document';
  return null;
}

/**
 * Deterministic keyword classifier for the latest user message.
 * Falls back to the previous user message's task for short follow-ups, and to
 * 'qa' otherwise.
 */
export function classifyCourseTask(text: string, options: ClassifyCourseTaskOptions): CourseTask {
  const direct = classifyByKeywords(text, options);
  if (direct) return direct;
  const normalized = normalizeTaskText(text);
  const previous = options.previousUserTexts || [];
  if (previous.length > 0 && normalized.length <= 24 && FOLLOW_UP_PATTERN.test(normalized)) {
    for (let index = previous.length - 1; index >= 0; index -= 1) {
      const inherited = classifyByKeywords(previous[index] || '', {
        mode: options.mode,
        hasAttachment: false,
      });
      if (inherited) return inherited;
    }
  }
  return 'qa';
}

/** Detect the language the reply should use from the latest user text. */
export function detectReplyLanguage(
  text: string,
  fallback: CourseReplyLanguage = 'zh',
): CourseReplyLanguage {
  const normalized = text.normalize('NFKC');
  if (
    /(?:用|说|讲|改用|换成|切换到?)\s*英文|英文(?:回答|回复)|in\s+english|switch\s+to\s+english/i.test(
      normalized,
    )
  ) {
    return 'en';
  }
  if (/(?:用|说|讲|改用|换成|切换到?)\s*中文|中文(?:回答|回复)|in\s+chinese/i.test(normalized)) {
    return 'zh';
  }
  const han = (normalized.match(/[㐀-鿿]/g) || []).length;
  const latinWords = (normalized.match(/[A-Za-z]{2,}/g) || []).length;
  if (han === 0 && latinWords >= 2) return 'en';
  if (han > 0 && latinWords > han * 1.5 && latinWords >= 6) return 'en';
  // Very short acknowledgements (好的、谢谢) keep the current language.
  if (han > 0 && han <= 4 && latinWords === 0) return fallback;
  if (han > 0) return 'zh';
  return fallback;
}

/**
 * Language for this turn: walk the user's messages oldest → newest so an explicit
 * switch ("你能用英文吗") carries over to later short or ambiguous messages.
 */
export function detectConversationLanguage(userTexts: string[]): CourseReplyLanguage {
  let language: CourseReplyLanguage = 'zh';
  for (const text of userTexts) language = detectReplyLanguage(text, language);
  return language;
}

export type CourseSkillBudget = { maxSteps: number; maxOutputTokens: number };

const SKILL_BUDGETS: Record<CourseTask, CourseSkillBudget> = {
  qa: { maxSteps: 4, maxOutputTokens: 10_000 },
  find_problems: { maxSteps: 8, maxOutputTokens: 12_000 },
  lecture_script: { maxSteps: 6, maxOutputTokens: 12_000 },
  worksheet: { maxSteps: 6, maxOutputTokens: 12_000 },
  document: { maxSteps: 6, maxOutputTokens: 16_000 },
  image: { maxSteps: 4, maxOutputTokens: 4_000 },
  learning_insight: { maxSteps: 5, maxOutputTokens: 10_000 },
  calendar: { maxSteps: 4, maxOutputTokens: 6_000 },
};

/** Step and output-token budget for one chat turn of this task. */
export function skillBudget(task: CourseTask, modelId: string): CourseSkillBudget {
  const budget = SKILL_BUDGETS[task] || SKILL_BUDGETS.qa;
  return {
    maxSteps: budget.maxSteps,
    maxOutputTokens: Math.min(budget.maxOutputTokens, chatMaxOutputTokens(modelId || '')),
  };
}

export type SkillPlaybookOptions = {
  /** Tool names actually registered this turn; file-tool steps are dropped when absent. */
  availableTools?: string[];
};

function hasTool(options: SkillPlaybookOptions | undefined, name: string): boolean {
  return !options?.availableTools || options.availableTools.includes(name);
}

function languageLine(language: CourseReplyLanguage): string {
  return language === 'en'
    ? '回答语言：用户本轮使用英文，正文、表格、题目和文件内容全部用英文；课程笔记本名可保留原名。'
    : '回答语言：使用中文；用户改用其他语言时随之切换。';
}

const FIND_PROBLEMS_EXEMPLAR = [
  '示例（压缩，编号为示意）：老师附上一份 Tutorial 问“有没有类似的题”。',
  '有相关题型，但只有利率转换、年金现值、租赁决策和剩余期限估值能找到较直接的对应题。附件四题本身已在题库，分别是《货币时间价值》· 题库第 12、13、14、15 题，不算作类似题。',
  '| 附件中的题 | 题库中的对应题 | 对应关系 |',
  '|---|---|---|',
  '| 第 1 题 跨币种 NPV | 题库中暂无同类题 | 若已上传相关原件但未转化，可先处理后再查 |',
  '| 第 2 题 债券复制与套利 | 《无套利与一价定律》· 题库第 8 题 | 同考一价定律，但不是 $B_1$/$B_2$ 复制组合同型题 |',
  '| 第 4 题 按揭提前清偿 | 《利率转换与年金》· 题库第 19–20、22 题 | 分别考利率转换与年金现值 |',
  '## 1 月利率和有效年利率 —《利率转换与年金》· 题库第 19–20 题',
  '**答案：19 题 B，20 题 A。** $$r_m=0.10/12=0.8333\\%,\\qquad EAR=(1+0.10/12)^{12}-1=10.4713\\%$$',
  '这对应附件第 4 题的第一步；但附件给的是半年复利 APR，不能直接除以 12：$r_m=(1+0.0775/2)^{1/6}-1$。',
  '结尾：复习顺序（换利率→统一时点→年金现值→剩余余额）+ 缺口清单。',
].join('\n');

const LECTURE_EXEMPLAR = [
  '示例（压缩）：ECO365 两小时速成课逐字稿的大纲与语体。',
  '大纲：0–5 分钟 学习路线｜5–30 国民收入账户（GNE 与支出分类、TB 与 GDP、NFIA 与 GNP、完整例题）｜30–45 国际转移与经常账户｜45–65 储蓄与投资｜65–90 国际收支与复式记账｜90–100 对外净财富｜100–105 公式与考法回顾｜105–120 综合例题与收尾，最后附知识点汇总表。',
  '语体样例：“先看 GNE。它回答的是：本国主体总共花了多少在最终商品和服务上？（板书：$GNE=C+I+G$。）这里的投资 I 指新增机器设备、厂房、住宅和存货变化，买股票不算……（留 1 分钟作答；请学生说出分类理由，再讲评。）考试中，如果原始支出表里混入股票购买或养老金，你要先分类，再计算。”',
  '要点：口语段落直接可读，不用引用块（>）包裹；课堂动作写在（板书：…）（停顿…）（练习…）里；每节依次覆盖为什么学→讲解/公式→例子→考试怎么考→例题逐步讲解。',
].join('\n');

const WORKSHEET_EXEMPLAR = [
  'Example (compressed, English request): "can you write a few multiple choice questions on not-for-profit organizations?"',
  'Based on **《UTM-MGM101｜第 1 周：商业的变化面貌》**, section 1. These are practice questions created from the notebook, not bank problems.',
  '### 1 What is the primary purpose of a not-for-profit organization?',
  'A. To distribute profits to shareholders  B. To provide public services or support a mission  C. …  D. …',
  'Teacher answer key (after the student part): | Question | Answer | Explanation | … 1 | B | The notebook defines … |',
  'Teaching reminder: “Not-for-profit” describes the main purpose; it does not mean the organization needs no money.',
].join('\n');

const DOCUMENT_EXEMPLAR = [
  '示例（压缩）：“做一张知识点汇总”。',
  '| 知识点 | 公式或判断 | 使用时注意 |',
  '|---|---|---|',
  '| 国内支出 | $GNE=C+I+G$ | 股票不是 I；转移支付不是 G |',
  '| 经常账户 | $CA=TB+NFIA+NUT=Y-GNE$ | CA 不一定等于 TB |',
  '| 储蓄投资关系 | $CA=S-I$ | 恒等式不等于因果预测 |',
  '表后一行：本表依据《…》第 1–8 节。',
].join('\n');

const QA_EXEMPLAR = [
  'Example (compressed, English): "what does the term non-profit organization mean?"',
  'A **non-profit organization** (also called a **not-for-profit organization**) is an organization whose main purpose is to provide a public service or support a mission, rather than make profits for owners. … Based on **Chapter 1: “The Changing Face of Business,”** section *Business, Profits, and Non-Profit Organizations*.',
  '注意：英文括号里的普通说明保持为文字，不要写进 $...$。',
].join('\n');

function teacherOrStudentFileLine(mode: CourseSkillMode): string {
  return mode === 'student'
    ? '学生端文件只用于学生自己的学习笔记、错题整理和复习提纲；不得生成题库题的答案册、答案键或可直接提交的作业答案。'
    : '教师端可生成讲义、练习卷（学生版 + `<!-- pagebreak -->` 之后的教师答案页）、汇总表等备课材料。';
}

/** Concise Chinese playbook for one task, appended to the course-agent system prompt. */
export function skillPlaybook(
  task: CourseTask,
  mode: CourseSkillMode,
  language: CourseReplyLanguage,
  options?: SkillPlaybookOptions,
): string {
  const isStudent = mode === 'student';
  const canCreateDocument = hasTool(options, 'create_document');
  const canWriteLong = hasTool(options, 'write_long_document');
  const canImage = hasTool(options, 'generate_image');
  const lines: string[] = [];

  switch (task) {
    case 'find_problems':
      lines.push(
        '本轮技能：找题 / 对应题',
        '步骤：',
        '1. 先确定章节和知识点：有附件时逐题概括“考什么”（如利率转换、年金现值）；没有附件时从用户描述提取。',
        '2. 先查题库：按每个知识点分别调用 search_course_problem_bank，可多次换关键词（中英文同义词、章节名），不要一次只搜一个笼统词就下结论。',
        '3. 题库不足时再用 search_course_notebooks 查笔记本中的例题与讲解；不要读取或声称读取过原始上传的 PDF/Word。',
        '4. 附件中的题如果本身已在题库，写“这题本身已在题库第 N 题”，不能把它当作“类似题”。',
        '5. 仍找不到：明确写“题库中暂无同类题”，并按资料清单提示“可能已经上传了原件，但还没有转化到题库或笔记本”。',
        '输出格式：',
        '- 第一句给结论（有/没有、哪几类有直接对应）。',
        '- 一张映射表：| 附件中的题 / 题型 | 题库中的对应题（《章节》· 题库第 N 题） | 对应关系 |。',
        isStudent
          ? '- 学生端：命中后界面会显示练习卡片，只说明可以开始练习，不给答案、提示或完整题干。'
          : '- 教师端：命中的题会以题目卡片显示，不要粘贴完整题干，除非老师要求；每个分组用“## 序号 主题 —《章节》· 题库第 N 题”，给一句题意、答案、关键公式（$$...$$）和与附件题的联系、差异。',
        '- 结尾：建议讲解/复习顺序 + 缺口清单。',
        '质量检查：不出现“往年真题 / past exam / 历年试卷”、原件文件名、年份、原卷题号；编号只用工具返回的题库编号，工具没有编号时只写《章节》· 题目标题；没查到不等于课程没有，按缺口表述。',
        ...(isStudent ? [] : ['', FIND_PROBLEMS_EXEMPLAR]),
      );
      break;
    case 'lecture_script':
      lines.push(
        isStudent ? '本轮技能：学习讲解稿（学生自学用）' : '本轮技能：讲课逐字稿 / 速成课讲稿',
        '步骤：',
        '1. 用 search_course_notebooks 定位相关笔记本与章节（必要时 detail=full 读取目录与关键节）；有题目需求时用 search_course_problem_bank 选例题。',
        '2. 按用户给的总时长规划大纲：每节写清时间段、标题、要讲的知识点和对应 notebook sectionIds；覆盖笔记本的全部相关小节，不要漏掉后半部分。',
        canWriteLong
          ? '3. 调用 write_long_document 生成正文（逐节分别生成），不要在聊天里自己写完整长稿。工具成功后，聊天中只给：一句结论 + 大纲表（时间段 | 内容 | 依据章节）+ 生成的文件说明。工具失败时如实说明，不要声称文件已生成。'
          : '3. 直接在回答中按大纲写正文；篇幅过长时先写前几节并说明剩余部分可继续生成。',
        '正文要求：口语段落，可直接照读；课堂动作写在（板书：…）（停顿…）（练习…）中；每节依次覆盖为什么学→讲解与公式→例子→考试怎么考→例题逐步讲解；公式完整写成 $...$ / $$...$$；不要用引用块（>）包裹正文，不要只写提纲。',
        '最后一节或附录给“知识点汇总”表（知识点 | 公式或判断 | 使用时注意）。',
        ...(isStudent ? [teacherOrStudentFileLine(mode)] : []),
        '',
        LECTURE_EXEMPLAR,
      );
      break;
    case 'worksheet':
      lines.push(
        '本轮技能：练习题 / 练习卷',
        '步骤：',
        '1. 用 search_course_notebooks 找到对应章节，题目只考笔记本里讲过的内容；需要题库现有练习题时先用 search_course_problem_bank，命中的题以卡片形式出现。',
        '2. 新编题必须说明“依据《…》第 N 节新编的练习题，不是题库题”。选项互斥、只有一个最佳答案，干扰项来自常见误解。',
        '3. 输出：学生部分（题目、选项、作答空位），之后是答案部分（| 题号 | 答案 | 解析 |，解析指向笔记本概念），最后一句教学提醒。',
        canCreateDocument
          ? '4. 用户要 Word / PDF / 可打印版本时调用 create_document：学生部分在前，教师答案放在 `<!-- pagebreak -->` 之后；工具成功后才说文件已生成。'
          : '4. 当前没有文件工具，用户要文件时说明暂不能生成，并给出可直接复制的版本。',
        ...(isStudent ? [] : ['不得替老师布置作业或创建作业；只帮助准备材料。']),
        ...(isStudent
          ? [
              '学生端：可以出自测题，但答案放在最后并提醒先作答；不得输出题库题的答案。',
              teacherOrStudentFileLine(mode),
            ]
          : []),
        '',
        WORKSHEET_EXEMPLAR,
      );
      break;
    case 'document':
      lines.push(
        '本轮技能：文档 / 汇总 / 导出',
        '步骤：',
        '1. 内容来自本对话已有回答时直接整理，不必重新检索；新内容先用 search_course_notebooks 取证。',
        '2. 汇总类内容用表格（知识点 | 公式或判断 | 使用时注意），公式写成 $...$；标明依据章节。',
        canCreateDocument
          ? '3. 用户要求 Word / docx / PDF / 下载时调用 create_document（Markdown 正文；教师答案或附录放在 `<!-- pagebreak -->` 之后）。工具返回成功后，聊天里只给一句说明和内容概要，不要重复全文；失败时如实说明并给出 Markdown 版本。不要说“无法生成 Word”。'
          : '3. 当前没有文件工具：直接给出排版好的 Markdown，并说明暂不能生成文件。',
        canWriteLong ? '4. 预计超过约 4000 字的长文档用 write_long_document 分节生成。' : '',
        teacherOrStudentFileLine(mode),
        '必须在回答中给出实际内容；不能返回空回答。',
        '',
        DOCUMENT_EXEMPLAR,
      );
      break;
    case 'image':
      lines.push(
        '本轮技能：图片 / 示意图',
        canImage
          ? '1. 先用 search_course_notebooks 确认图要表达的概念与术语，再调用 generate_image，提示词写清画面元素、标注文字（与回答语言一致）、风格（简洁教学示意图、白底）。'
          : '1. 当前没有图片工具：改用 Markdown 表格或 Mermaid 风格的文字结构说明，并说明暂不能生成图片。',
        '2. 工具成功后用一两句话说明图中内容与对应章节；失败时如实说明，不要声称图片已生成。',
        '3. 公式类内容不要画进图片，用 $$...$$ 写在回答中。',
        teacherOrStudentFileLine(mode),
      );
      break;
    case 'learning_insight':
      lines.push(
        '本轮技能：学情分析',
        '1. 调用 get_course_learning_insight（scope=student / class / problem），按姓名或手机号尾号找学生时用 studentQuery。',
        '2. 第一句给结论；随后用表格列出证据（时间范围、提交样本数、计时样本数、主要问题、相关题目/章节），区分“原始提问记录”和“基于证据的判断”。',
        '3. 给出可执行的教学建议（补讲哪个章节、用哪道题库题讲评），不要替老师布置作业。',
        '4. 缺少数据时写“暂无数据”，不要推测。',
      );
      break;
    case 'calendar':
      lines.push(
        '本轮技能：日历',
        '1. 先 list_calendar_events 读取真实日程；修改或删除必须使用返回的 event id。',
        isStudent
          ? '2. 新增、修改、删除只调用一次 propose_calendar_change 形成草案，等待学生确认；不要声称已经写入。'
          : '2. 教师端只读日程并给出建议，不要声称已修改日历，也不要创建作业。',
        '3. 回答用表格列出日期、事项、类型。',
      );
      break;
    case 'qa':
    default:
      lines.push(
        '本轮技能：课程问答',
        '1. 课程知识先 search_course_notebooks（需要原文时 detail=full）；涉及练习题时查 search_course_problem_bank。',
        '2. 第一句直接回答；然后给定义/公式/步骤，计算题给完整推导与数值结果；结尾一句注明依据的笔记本与章节。',
        '3. 简短问题简短回答，不写套话、不复述检索过程。',
        '',
        QA_EXEMPLAR,
      );
      break;
  }

  return [
    ...lines.filter((line, index, all) => line !== '' || all[index - 1] !== ''),
    languageLine(language),
  ].join('\n');
}
