import { z } from 'zod';
import type { QuizQuestion, Scene } from '@/lib/types/stage';

export const notebookProblemTypeSchema = z.enum([
  'short_answer',
  'choice',
  'proof',
  'calculation',
  'code',
  'fill_blank',
  'multipart',
  'table',
]);
export const notebookProblemStatusSchema = z.enum(['draft', 'published', 'archived']);
export const notebookProblemSourceSchema = z.enum([
  'chat',
  'pdf',
  'manual',
  'web',
  'legacy_quiz_scene',
]);
export const notebookProblemDifficultySchema = z.enum(['easy', 'medium', 'hard']);
export const notebookProblemContractVersionSchema = z.literal('syntara.problem.v1');
export const notebookProblemStatementFormatSchema = z.literal('syntara-markdown-v1');
export const notebookProblemTaskKindSchema = z.enum([
  'concept',
  'code_reading',
  'calculation',
  'proof',
  'implementation',
]);
export const notebookProblemResponseKindSchema = z.enum([
  'short_text',
  'long_text',
  'choice',
  'math_expression',
  'fill_blank',
  'code_submission',
  'table_cells',
]);
export const notebookProblemGraderKindSchema = z.enum([
  'rubric',
  'exact_choice',
  'numeric_or_exact',
  'blank_match',
  'code_runner',
  'table_match',
]);
export const notebookProblemAttemptKindSchema = z.enum(['run', 'submit', 'answer']);
export const notebookProblemAttemptStatusSchema = z.enum([
  'pending',
  'passed',
  'failed',
  'partial',
  'error',
]);

export const notebookProblemSourceMetaSchema = z.record(z.string(), z.unknown()).default({});

export const notebookProblemImageAssetSchema = z.object({
  id: z.string().trim().min(1).max(120),
  src: z.string().trim().min(1).max(8_000_000),
  alt: z.string().trim().min(1).max(500).optional(),
  caption: z.string().trim().min(1).max(1000).optional(),
  sourceImageId: z.string().trim().min(1).max(120).optional(),
  pageNumber: z.number().int().positive().optional(),
  width: z.number().int().positive().max(10000).optional(),
  height: z.number().int().positive().max(10000).optional(),
  mimeType: z.string().trim().min(1).max(120).optional(),
  role: z.enum(['question', 'context', 'option', 'explanation']).default('question'),
});

export const notebookProblemAssetsSchema = z
  .object({
    images: z.array(notebookProblemImageAssetSchema).max(8).default([]),
  })
  .default({ images: [] });

export const notebookChoiceOptionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(4000),
  format: z.literal('syntara-markdown-inline-v1').optional(),
});

export const notebookProblemLocalizedContentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  chapterName: z.string().trim().min(1).max(200).optional(),
  stem: z.string().trim().min(1).max(16000).optional(),
  stemTemplate: z.string().trim().min(1).max(16000).optional(),
  explanation: z.string().trim().min(1).max(8000).optional(),
  options: z.array(notebookChoiceOptionSchema).max(12).optional(),
});

export const notebookProblemTranslationsSchema = z
  .object({
    'zh-CN': notebookProblemLocalizedContentSchema.optional(),
    'en-US': notebookProblemLocalizedContentSchema.optional(),
  })
  .partial()
  .optional();

const notebookProblemPublicBaseSchema = z.object({
  contractVersion: notebookProblemContractVersionSchema.optional(),
  statementFormat: notebookProblemStatementFormatSchema.optional(),
  explanation: z.string().trim().min(1).max(8000).optional(),
  assets: notebookProblemAssetsSchema.optional(),
  translations: notebookProblemTranslationsSchema,
});

export const notebookProblemPublicShortAnswerSchema = notebookProblemPublicBaseSchema.extend({
  type: z.literal('short_answer'),
  taskKind: notebookProblemTaskKindSchema.optional(),
  responseKind: z.literal('short_text').optional(),
  stem: z.string().trim().min(1).max(12000),
});

export const notebookProblemPublicChoiceSchema = notebookProblemPublicBaseSchema.extend({
  type: z.literal('choice'),
  taskKind: notebookProblemTaskKindSchema.optional(),
  responseKind: z.literal('choice').optional(),
  stem: z.string().trim().min(1).max(12000),
  selectionMode: z.enum(['single', 'multiple']).default('single'),
  options: z.array(notebookChoiceOptionSchema).min(2).max(12),
});

export const notebookProblemPublicProofSchema = notebookProblemPublicBaseSchema.extend({
  type: z.literal('proof'),
  taskKind: z.literal('proof').optional(),
  responseKind: z.literal('long_text').optional(),
  stem: z.string().trim().min(1).max(12000),
});

export const notebookProblemPublicCalculationSchema = notebookProblemPublicBaseSchema.extend({
  type: z.literal('calculation'),
  taskKind: z.literal('calculation').optional(),
  responseKind: z.literal('math_expression').optional(),
  stem: z.string().trim().min(1).max(12000),
  unit: z.string().trim().min(1).max(120).optional(),
  showWork: z.boolean().optional(),
});

export const notebookProblemPublicFillBlankSchema = notebookProblemPublicBaseSchema.extend({
  type: z.literal('fill_blank'),
  taskKind: notebookProblemTaskKindSchema.optional(),
  responseKind: z.literal('fill_blank').optional(),
  /// Figure blanks are numbered in the source image; inputs follow blanks array order.
  blankLayout: z.enum(['inline', 'figure']).optional(),
  stemTemplate: z.string().trim().min(1).max(12000),
  blanks: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        placeholder: z.string().trim().min(1).max(120).optional(),
        answerKind: z.enum(['text', 'number', 'math_expression', 'code_token']).optional(),
      }),
    )
    .min(1)
    .max(32),
});

/// 题目自带的文件：运行前写进工作目录，代码里 open('scores.csv') 就能读到
export const notebookCodeFileSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^(?!\/)(?!.*\.\.)[\w .\/-]+$/, 'File path must be relative'),
  content: z.string().max(200_000),
  format: z.enum(['csv', 'txt', 'json']).optional(),
  /// input = 程序读入的数据；expected_output = 程序写完后文件应有的内容
  role: z.enum(['input', 'expected_output']).default('input'),
  visible: z.boolean().default(true),
});

/// 代码空位：template 里的 {{id}}；expr 行内表达式，line 一整行，block 多行（函数体）
export const notebookCodeSlotSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[\w-]+$/),
  kind: z.enum(['expr', 'line', 'block']).default('expr'),
  placeholder: z.string().trim().min(1).max(200).optional(),
  hint: z.string().trim().min(1).max(500).optional(),
});

export const notebookTableColumnSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[\w-]+$/),
  header: z.string().trim().max(200).default(''),
  /// given = 题目给的格子；answer = 学生要填的格子
  role: z.enum(['given', 'answer']),
  cellKind: z.enum(['code', 'text', 'python_value', 'output']).default('text'),
});

export const notebookTableRowSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[\w-]+$/),
  cells: z.record(z.string(), z.string().max(8000)).default({}),
});

/// 表格题：「Code → What is printed」、逐轮追踪表、docstring 例子补全
export const notebookProblemPublicTableSchema = notebookProblemPublicBaseSchema.extend({
  type: z.literal('table'),
  taskKind: notebookProblemTaskKindSchema.optional(),
  responseKind: z.literal('table_cells').optional(),
  stem: z.string().trim().min(1).max(16000),
  /// 每行运行前先跑的共享代码（表格上方给的代码）
  setupCode: z.string().max(40000).optional(),
  files: z.array(notebookCodeFileSchema).max(8).optional(),
  columns: z.array(notebookTableColumnSchema).min(2).max(8),
  rows: z.array(notebookTableRowSchema).min(1).max(40),
  /// 一点就填的常用答案，如 ERROR / NOTHING
  quickAnswers: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
  /// 每行的 code 格可以真跑（提交后可用来看真实输出）
  runnable: z.boolean().optional(),
});

export const notebookCodeTestSchema = z.object({
  id: z.string().trim().min(1).max(64),
  description: z.string().trim().min(1).max(500).optional(),
  expression: z.string().trim().min(1).max(4000),
  expected: z.string().trim().min(1).max(4000),
});

export const notebookCodeSampleIoSchema = z.object({
  input: z.string().trim().min(1).max(4000),
  output: z.string().trim().min(1).max(4000),
  explanation: z.string().trim().min(1).max(2000).optional(),
});

export const notebookCodeStatementSectionSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    title: z.string().trim().min(1).max(120),
    kind: z
      .enum([
        'overview',
        'requirements',
        'interface',
        'invariants',
        'examples',
        'constraints',
        'notes',
      ])
      .default('overview'),
    body: z.string().trim().min(1).max(8000).optional(),
    items: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
    code: z.string().max(24000).optional(),
    codeLanguage: z.string().trim().min(1).max(40).optional(),
  })
  .refine((section) => section.body || section.items.length > 0 || section.code, {
    message: 'Code statement sections need body, items, or code.',
  });

export const notebookProblemPublicCodeSchema = notebookProblemPublicBaseSchema.extend({
  type: z.literal('code'),
  /// These supplied helpers are evaluated independently of earlier student answers.
  assumedHelpers: z
    .array(z.string().regex(/^[A-Za-z_]\w*$/))
    .max(12)
    .optional(),
  taskKind: z.literal('implementation').optional(),
  responseKind: z.literal('code_submission').optional(),
  stem: z.string().trim().min(1).max(16000),
  language: z.string().trim().min(1).max(40).default('python'),
  runnerAdapter: z.string().trim().min(1).max(80).optional(),
  starterCode: z.string().max(40000).optional(),
  functionSignature: z.string().trim().min(1).max(4000).optional(),
  constraints: z.array(z.string().trim().min(1).max(500)).max(16).default([]),
  publicTestCode: z.string().max(80000).optional(),
  publicTests: z.array(notebookCodeTestSchema).max(24).default([]),
  sampleIO: z.array(notebookCodeSampleIoSchema).max(12).default([]),
  statementSections: z.array(notebookCodeStatementSectionSchema).max(10).optional(),
  starterCodeDescription: z.string().trim().min(1).max(1000).optional(),
  secretConfigPresent: z.boolean().default(false),
  /// 带空位的代码：{{slot_id}} 以外的部分学生改不了；没有时整段 starterCode 可改
  template: z.string().max(40000).optional(),
  slots: z.array(notebookCodeSlotSchema).max(16).optional(),
  files: z.array(notebookCodeFileSchema).max(8).optional(),
  /// 自由运行时喂给 input() 的内容
  stdin: z.string().max(20000).optional(),
});

/// 大题里的一问：复用现有题型的题面结构（含代码题，隐藏测试放在 secretJudge.parts[label]），content.stem（填空为 stemTemplate）只写这一问的问法
export const notebookProblemPartPublicContentSchema = z.discriminatedUnion('type', [
  notebookProblemPublicShortAnswerSchema,
  notebookProblemPublicChoiceSchema,
  notebookProblemPublicProofSchema,
  notebookProblemPublicCalculationSchema,
  notebookProblemPublicFillBlankSchema,
  notebookProblemPublicTableSchema,
  notebookProblemPublicCodeSchema,
]);

export const notebookProblemPartLabelSchema = z.string().trim().min(1).max(40);

export const notebookProblemPartSchema = z.object({
  label: notebookProblemPartLabelSchema,
  points: z.number().nonnegative().max(1000).default(0),
  /// 用到了哪些前面小问的结论，界面上提示「接着 (a) 的结果」
  dependsOn: z.array(notebookProblemPartLabelSchema).max(12).optional(),
  content: notebookProblemPartPublicContentSchema,
});

export const notebookProblemPublicMultipartSchema = notebookProblemPublicBaseSchema.extend({
  type: z.literal('multipart'),
  taskKind: notebookProblemTaskKindSchema.optional(),
  responseKind: z.literal('multipart').optional(),
  /// 共享题干：背景、条件、表格、图，所有小问共用，只写一次
  stem: z.string().trim().min(1).max(16000),
  parts: z.array(notebookProblemPartSchema).min(1).max(12),
});

export const notebookProblemPublicContentSchema = z.discriminatedUnion('type', [
  notebookProblemPublicShortAnswerSchema,
  notebookProblemPublicChoiceSchema,
  notebookProblemPublicProofSchema,
  notebookProblemPublicCalculationSchema,
  notebookProblemPublicFillBlankSchema,
  notebookProblemPublicCodeSchema,
  notebookProblemPublicMultipartSchema,
  notebookProblemPublicTableSchema,
]);

export const notebookProblemGradingShortAnswerSchema = z.object({
  type: z.literal('short_answer'),
  graderKind: z.literal('rubric').optional(),
  referenceAnswer: z.string().trim().min(1).max(12000).optional(),
  rubric: z.string().trim().min(1).max(12000).optional(),
  rubricCriteria: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        description: z.string().trim().min(1).max(1000),
        points: z.number().nonnegative().max(1000),
      }),
    )
    .max(24)
    .optional(),
  analysis: z.string().trim().min(1).max(12000).optional(),
});

export const notebookProblemGradingChoiceSchema = z.object({
  type: z.literal('choice'),
  graderKind: z.literal('exact_choice').optional(),
  correctOptionIds: z.array(z.string().trim().min(1).max(64)).max(12).default([]),
  analysis: z.string().trim().min(1).max(12000).optional(),
});

export const notebookProblemGradingProofSchema = z.object({
  type: z.literal('proof'),
  graderKind: z.literal('rubric').optional(),
  referenceProof: z.string().trim().min(1).max(16000).optional(),
  rubric: z.string().trim().min(1).max(12000).optional(),
  rubricCriteria: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        description: z.string().trim().min(1).max(1000),
        points: z.number().nonnegative().max(1000),
      }),
    )
    .max(24)
    .optional(),
  analysis: z.string().trim().min(1).max(12000).optional(),
});

export const notebookProblemGradingCalculationSchema = z.object({
  type: z.literal('calculation'),
  graderKind: z.literal('numeric_or_exact').optional(),
  referenceAnswer: z.string().trim().min(1).max(4000).optional(),
  acceptedForms: z.array(z.string().trim().min(1).max(1000)).max(16).default([]),
  tolerance: z.number().nonnegative().optional(),
  relativeTolerance: z.number().nonnegative().optional(),
  unit: z.string().trim().min(1).max(120).optional(),
  analysis: z.string().trim().min(1).max(12000).optional(),
});

export const notebookProblemGradingFillBlankSchema = z.object({
  type: z.literal('fill_blank'),
  graderKind: z.literal('blank_match').optional(),
  blanks: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        acceptedAnswers: z.array(z.string().trim().min(1).max(1000)).min(1).max(16),
        caseSensitive: z.boolean().default(false),
        matcher: z.enum(['exact', 'normalized_exact', 'numeric_tolerance']).optional(),
        tolerance: z.number().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(32),
  /// Complete alternative diagrams; blanks must all follow the same variant.
  answerVariants: z
    .array(z.record(z.string().min(1).max(64), z.string().trim().min(1).max(1000)))
    .min(1)
    .max(16)
    .optional(),
  analysis: z.string().trim().min(1).max(12000).optional(),
});

export const notebookProblemGradingCodeSchema = z.object({
  type: z.literal('code'),
  graderKind: z.literal('code_runner').optional(),
  referenceAnswer: z.string().trim().min(1).max(40000).optional(),
  solutionCode: z.string().trim().min(1).max(40000).optional(),
  analysis: z.string().trim().min(1).max(12000).optional(),
  publishRequirementsMet: z.boolean().default(false),
  /// 每个空位的参考答案（讲解用；判分以测试为准）
  solutionSlots: z.record(z.string(), z.string().max(20000)).optional(),
});

export const notebookTableCellGradingSchema = z.object({
  rowId: z.string().trim().min(1).max(64),
  colId: z.string().trim().min(1).max(64),
  acceptedAnswers: z.array(z.string().max(8000)).max(16).default([]),
  /// output 按 print 输出比；python_value 解析成 Python 值比；run_check 把答案代入 check 运行
  matcher: z.enum(['output', 'python_value', 'normalized_exact', 'run_check']).default('output'),
  /// run_check：含 {answer} 的 Python 表达式，结果为 True 就算对
  check: z.string().max(4000).optional(),
  points: z.number().nonnegative().max(1000).optional(),
});

export const notebookProblemGradingTableSchema = z.object({
  type: z.literal('table'),
  graderKind: z.literal('table_match').optional(),
  cells: z.array(notebookTableCellGradingSchema).max(160).default([]),
  analysis: z.string().trim().min(1).max(12000).optional(),
});

export const notebookProblemPartGradingSchema = z.discriminatedUnion('type', [
  notebookProblemGradingShortAnswerSchema,
  notebookProblemGradingChoiceSchema,
  notebookProblemGradingProofSchema,
  notebookProblemGradingCalculationSchema,
  notebookProblemGradingFillBlankSchema,
  notebookProblemGradingTableSchema,
  notebookProblemGradingCodeSchema,
]);

export const notebookProblemGradingMultipartSchema = z.object({
  type: z.literal('multipart'),
  graderKind: z.literal('per_part').optional(),
  /// 按 label 对应 publicContent.parts
  parts: z
    .array(
      z.object({
        label: notebookProblemPartLabelSchema,
        grading: notebookProblemPartGradingSchema,
      }),
    )
    .max(12)
    .default([]),
  analysis: z.string().trim().min(1).max(12000).optional(),
});

export const notebookProblemGradingSchema = z.discriminatedUnion('type', [
  notebookProblemGradingShortAnswerSchema,
  notebookProblemGradingChoiceSchema,
  notebookProblemGradingProofSchema,
  notebookProblemGradingCalculationSchema,
  notebookProblemGradingFillBlankSchema,
  notebookProblemGradingCodeSchema,
  notebookProblemGradingMultipartSchema,
  notebookProblemGradingTableSchema,
]);

export const notebookProblemPartSecretJudgeSchema = z.object({
  supportCode: z.string().max(40000).optional(),
  secretTestCode: z.string().max(80000).optional(),
  secretTests: z.array(notebookCodeTestSchema).max(48).default([]),
  timeoutMs: z.number().int().positive().max(20000).default(5000),
  files: z.array(notebookCodeFileSchema).max(8).optional(),
});

export const notebookProblemSecretJudgeSchema = z.object({
  /// Private reference helpers, added only after the student's locked ranges are validated.
  supportCode: z.string().max(40000).optional(),
  language: z.string().trim().min(1).max(40).default('python'),
  runnerAdapter: z.string().trim().min(1).max(80).optional(),
  secretTestCode: z.string().max(80000).optional(),
  secretTests: z.array(notebookCodeTestSchema).max(48).default([]),
  timeoutMs: z.number().int().positive().max(20000).default(5000),
  /// 只给隐藏测试用的文件，不下发到前端
  files: z.array(notebookCodeFileSchema).max(8).optional(),
  /// 大题里的代码小问：按 label 存各自的隐藏测试
  parts: z.record(notebookProblemPartLabelSchema, notebookProblemPartSecretJudgeSchema).optional(),
});

export const notebookProblemRecordSchema = z.object({
  id: z.string().trim().min(1),
  courseId: z.string().trim().min(1).nullable().optional(),
  notebookId: z.string().trim().min(1).nullable().optional(),
  notebookName: z.string().trim().min(1).max(200).optional(),
  chapterId: z.string().trim().min(1).nullable().optional(),
  chapterName: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(200),
  type: notebookProblemTypeSchema,
  status: notebookProblemStatusSchema,
  source: notebookProblemSourceSchema,
  order: z.number().int().min(0),
  problemNumber: z.number().int().positive().nullable().optional(),
  points: z.number().int().min(0).max(1000).default(100),
  tags: z.array(z.string().trim().min(1).max(30)).max(16).default([]),
  difficulty: notebookProblemDifficultySchema.default('medium'),
  publicContent: notebookProblemPublicContentSchema,
  grading: notebookProblemGradingSchema,
  sourceMeta: notebookProblemSourceMetaSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const notebookProblemSummarySchema = notebookProblemRecordSchema.extend({
  attemptStats: z
    .object({
      attemptedCount: z.number().int().min(0),
      passedCount: z.number().int().min(0),
    })
    .nullable()
    .optional(),
  classStats: z
    .object({
      studentCount: z.number().int().min(0),
      attemptedStudentCount: z.number().int().min(0),
      passedStudentCount: z.number().int().min(0),
    })
    .nullable()
    .optional(),
  latestAttempt: z
    .object({
      id: z.string().trim().min(1),
      status: notebookProblemAttemptStatusSchema,
      score: z.number().nullable().optional(),
      createdAt: z.number(),
    })
    .nullable()
    .optional(),
});

export const notebookProblemAttemptImageSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(1).max(120),
  size: z
    .number()
    .int()
    .min(0)
    .max(4 * 1024 * 1024),
  dataUrl: z.string().startsWith('data:image/').max(6_000_000),
});

export const notebookProblemPartAnswerSchema = z.object({
  text: z.string().max(40000).optional(),
  selectedOptionIds: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
  blanks: z.record(z.string(), z.string().max(4000)).optional(),
  images: z.array(notebookProblemAttemptImageSchema).max(4).optional(),
  cells: z.record(z.string(), z.string().max(8000)).optional(),
  code: z.string().max(120000).optional(),
});

export const notebookProblemAttemptAnswerSchema = z.object({
  text: z.string().max(40000).optional(),
  selectedOptionIds: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
  blanks: z.record(z.string(), z.string().max(4000)).optional(),
  code: z.string().max(120000).optional(),
  images: z.array(notebookProblemAttemptImageSchema).max(4).optional(),
  /// 表格题：key 为 `${rowId}:${colId}`
  cells: z.record(z.string(), z.string().max(8000)).optional(),
  /// 大题：按小问 label 存作答；只交了其中几问时，其余小问沿用上一次的结果
  parts: z.record(z.string(), notebookProblemPartAnswerSchema).optional(),
});

export const notebookCodeCaseResultSchema = z.object({
  id: z.string().trim().min(1).max(64),
  description: z.string().trim().min(1).max(500).optional(),
  passed: z.boolean(),
  actual: z.string().trim().min(1).max(12000).optional(),
  error: z.string().trim().min(1).max(12000).optional(),
  stdout: z.string().max(12000).optional(),
});

export const notebookCodeCaseSummarySchema = z.object({
  total: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  failureSummary: z.string().trim().min(1).max(16000).optional(),
});

export const notebookCodeRunTargetSchema = z.enum(['code', 'public', 'secret']);

export const notebookTableCellResultSchema = z.object({
  key: z.string().trim().min(1).max(140),
  correct: z.boolean(),
  expected: z.string().max(8000).optional(),
});

export const notebookProblemProgressSnapshotSchema = z.object({
  status: z.string().trim().min(1).max(40),
  score: z.number().min(0).max(1).nullable(),
  attemptedCount: z.number().int().nonnegative(),
});

export const notebookProblemPartResultSchema = z.object({
  cells: z.array(notebookTableCellResultSchema).optional(),
  label: notebookProblemPartLabelSchema,
  status: notebookProblemAttemptStatusSchema,
  score: z.number().min(0).max(1000),
  points: z.number().min(0).max(1000),
  correct: z.boolean().nullable().optional(),
  feedback: z.string().trim().min(1).max(16000).optional(),
  analysis: z.string().trim().min(1).max(16000).optional(),
  /// 这一问最后一次被批改的时间（沿用旧结果时保留原时间）
  gradedAt: z.number().optional(),
  /// 这一问累计提交了几次（自动判分的小问最多 3 次，分数上限逐次降低）
  submissions: z.number().int().min(0).max(1000).optional(),
  /// 代码小问的测试结果
  publicSummary: notebookCodeCaseSummarySchema.optional(),
  secretSummary: notebookCodeCaseSummarySchema.optional(),
  caseResults: z.array(notebookCodeCaseResultSchema).optional(),
});

export const notebookProblemAttemptResultSchema = z.object({
  event: z.enum(['solution_viewed', 'answer_reset']).optional(),
  progressSnapshot: notebookProblemProgressSnapshotSchema.nullable().optional(),
  correct: z.boolean().nullable().optional(),
  feedback: z.string().trim().min(1).max(16000).optional(),
  analysis: z.string().trim().min(1).max(16000).optional(),
  earnedPoints: z.number().min(0).max(1000).optional(),
  runTarget: notebookCodeRunTargetSchema.optional(),
  stdout: z.string().max(12000).optional(),
  error: z.string().trim().min(1).max(12000).optional(),
  caseResults: z.array(notebookCodeCaseResultSchema).optional(),
  publicCases: z.array(notebookCodeCaseResultSchema).default([]),
  publicSummary: notebookCodeCaseSummarySchema.optional(),
  secretSummary: notebookCodeCaseSummarySchema.optional(),
  parts: z.array(notebookProblemPartResultSchema).optional(),
  cells: z.array(notebookTableCellResultSchema).optional(),
  /// 运行后程序新写出 / 改过的文件
  files: z
    .array(z.object({ path: z.string().max(120), content: z.string().max(200_000) }))
    .optional(),
});

export const notebookProblemAttemptRecordSchema = z.object({
  id: z.string().trim().min(1),
  problemId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  kind: notebookProblemAttemptKindSchema,
  status: notebookProblemAttemptStatusSchema,
  score: z.number().nullable().optional(),
  answer: notebookProblemAttemptAnswerSchema,
  result: notebookProblemAttemptResultSchema.optional(),
  activeDurationMs: z.number().int().min(0).max(14_400_000).nullable().optional(),
  timingSource: z.string().trim().min(1).max(32).nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const notebookProblemImportDraftSchema = z.object({
  draftId: z.string().trim().min(1),
  notebookId: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(200),
  type: notebookProblemTypeSchema,
  status: notebookProblemStatusSchema.default('draft'),
  source: notebookProblemSourceSchema.default('manual'),
  points: z.number().int().min(0).max(1000).default(100),
  tags: z.array(z.string().trim().min(1).max(30)).max(16).default([]),
  difficulty: notebookProblemDifficultySchema.default('medium'),
  publicContent: notebookProblemPublicContentSchema,
  grading: notebookProblemGradingSchema,
  secretJudge: notebookProblemSecretJudgeSchema.optional(),
  sourceMeta: notebookProblemSourceMetaSchema,
  validationErrors: z.array(z.string().trim().min(1).max(500)).default([]),
});

export type NotebookProblemType = z.infer<typeof notebookProblemTypeSchema>;
export type NotebookProblemStatus = z.infer<typeof notebookProblemStatusSchema>;
export type NotebookProblemSource = z.infer<typeof notebookProblemSourceSchema>;
export type NotebookProblemDifficulty = z.infer<typeof notebookProblemDifficultySchema>;
export type NotebookProblemAttemptKind = z.infer<typeof notebookProblemAttemptKindSchema>;
export type NotebookProblemAttemptStatus = z.infer<typeof notebookProblemAttemptStatusSchema>;
export type NotebookProblemImageAsset = z.infer<typeof notebookProblemImageAssetSchema>;
export type NotebookProblemAssets = z.infer<typeof notebookProblemAssetsSchema>;
export type NotebookProblemLocalizedContent = z.infer<typeof notebookProblemLocalizedContentSchema>;
export type NotebookProblemTranslations = z.infer<typeof notebookProblemTranslationsSchema>;
export type NotebookProblemPublicContent = z.infer<typeof notebookProblemPublicContentSchema>;
export type NotebookProblemGrading = z.infer<typeof notebookProblemGradingSchema>;
export type NotebookProblemSecretJudge = z.infer<typeof notebookProblemSecretJudgeSchema>;
export type NotebookProblemRecord = z.infer<typeof notebookProblemRecordSchema>;
export type NotebookProblemSummary = z.infer<typeof notebookProblemSummarySchema>;
export type NotebookProblemAttemptAnswer = z.infer<typeof notebookProblemAttemptAnswerSchema>;
export type NotebookProblemAttemptResult = z.infer<typeof notebookProblemAttemptResultSchema>;
export type NotebookProblemAttemptRecord = z.infer<typeof notebookProblemAttemptRecordSchema>;
export type NotebookProblemImportDraft = z.infer<typeof notebookProblemImportDraftSchema>;
export type NotebookProblemPublicChoice = z.infer<typeof notebookProblemPublicChoiceSchema>;
export type NotebookProblemPublicFillBlank = z.infer<typeof notebookProblemPublicFillBlankSchema>;
export type NotebookProblemPublicCalculation = z.infer<
  typeof notebookProblemPublicCalculationSchema
>;
export type NotebookProblemPublicCode = z.infer<typeof notebookProblemPublicCodeSchema>;
export type NotebookProblemGradingChoice = z.infer<typeof notebookProblemGradingChoiceSchema>;
export type NotebookProblemGradingFillBlank = z.infer<typeof notebookProblemGradingFillBlankSchema>;
export type NotebookProblemGradingCalculation = z.infer<
  typeof notebookProblemGradingCalculationSchema
>;
export type NotebookProblemGradingShortAnswer = z.infer<
  typeof notebookProblemGradingShortAnswerSchema
>;
export type NotebookProblemGradingProof = z.infer<typeof notebookProblemGradingProofSchema>;
export type NotebookProblemGradingCode = z.infer<typeof notebookProblemGradingCodeSchema>;
export type NotebookProblemPublicMultipart = z.infer<typeof notebookProblemPublicMultipartSchema>;
export type NotebookProblemGradingMultipart = z.infer<typeof notebookProblemGradingMultipartSchema>;
export type NotebookProblemPart = z.infer<typeof notebookProblemPartSchema>;
export type NotebookCodeFile = z.infer<typeof notebookCodeFileSchema>;
export type NotebookCodeSlot = z.infer<typeof notebookCodeSlotSchema>;
export type NotebookTableColumn = z.infer<typeof notebookTableColumnSchema>;
export type NotebookTableRow = z.infer<typeof notebookTableRowSchema>;
export type NotebookTableCellGrading = z.infer<typeof notebookTableCellGradingSchema>;
export type NotebookTableCellResult = z.infer<typeof notebookTableCellResultSchema>;
export type NotebookProblemPublicTable = z.infer<typeof notebookProblemPublicTableSchema>;
export type NotebookProblemGradingTable = z.infer<typeof notebookProblemGradingTableSchema>;
export type NotebookTableProblemRecord = NotebookProblemRecord & {
  type: 'table';
  publicContent: NotebookProblemPublicTable;
  grading: NotebookProblemGradingTable;
};
export type NotebookProblemPartPublicContent = z.infer<
  typeof notebookProblemPartPublicContentSchema
>;
export type NotebookProblemPartGrading = z.infer<typeof notebookProblemPartGradingSchema>;
export type NotebookProblemPartAnswer = z.infer<typeof notebookProblemPartAnswerSchema>;
export type NotebookProblemPartResult = z.infer<typeof notebookProblemPartResultSchema>;
export type NotebookMultipartProblemRecord = NotebookProblemRecord & {
  type: 'multipart';
  publicContent: NotebookProblemPublicMultipart;
  grading: NotebookProblemGradingMultipart;
};
export type NotebookCodeProblemRecord = NotebookProblemRecord & {
  type: 'code';
  publicContent: NotebookProblemPublicCode;
  grading: NotebookProblemGradingCode;
};
export type NotebookChoiceProblemRecord = NotebookProblemRecord & {
  type: 'choice';
  publicContent: NotebookProblemPublicChoice;
  grading: NotebookProblemGradingChoice;
};
export type NotebookFillBlankProblemRecord = NotebookProblemRecord & {
  type: 'fill_blank';
  publicContent: NotebookProblemPublicFillBlank;
  grading: NotebookProblemGradingFillBlank;
};
export type NotebookCalculationProblemRecord = NotebookProblemRecord & {
  type: 'calculation';
  publicContent: NotebookProblemPublicCalculation;
  grading: NotebookProblemGradingCalculation;
};
export type NotebookShortAnswerProblemRecord = NotebookProblemRecord & {
  type: 'short_answer';
  publicContent: z.infer<typeof notebookProblemPublicShortAnswerSchema>;
  grading: NotebookProblemGradingShortAnswer;
};
export type NotebookProofProblemRecord = NotebookProblemRecord & {
  type: 'proof';
  publicContent: z.infer<typeof notebookProblemPublicProofSchema>;
  grading: NotebookProblemGradingProof;
};

export function parseNotebookProblemPublicContent(input: unknown): NotebookProblemPublicContent {
  return notebookProblemPublicContentSchema.parse(input);
}

export function parseNotebookProblemGrading(input: unknown): NotebookProblemGrading {
  return notebookProblemGradingSchema.parse(input);
}

export function parseNotebookProblemSecretJudge(
  input: unknown,
): NotebookProblemSecretJudge | undefined {
  if (!input) return undefined;
  return notebookProblemSecretJudgeSchema.parse(input);
}

export function parseNotebookProblemRecord(input: unknown): NotebookProblemRecord {
  return notebookProblemRecordSchema.parse(input);
}

export function parseNotebookProblemAttemptRecord(input: unknown): NotebookProblemAttemptRecord {
  return notebookProblemAttemptRecordSchema.parse(input);
}

export function parseNotebookProblemImportDraft(input: unknown): NotebookProblemImportDraft {
  return notebookProblemImportDraftSchema.parse(input);
}

function normalizeQuizChoiceType(question: QuizQuestion): NotebookProblemImportDraft | null {
  const optionList =
    question.options?.map((option, index) => {
      if (typeof option === 'string') {
        return {
          id: String.fromCharCode(65 + index),
          label: option,
        };
      }
      const id = option.value?.trim() || String.fromCharCode(65 + index);
      const label = option.label?.trim() || option.value?.trim() || id;
      return { id, label };
    }) ?? [];

  if (optionList.length < 2) return null;

  const answers = Array.isArray(question.answer)
    ? question.answer
    : typeof question.answer === 'string'
      ? [question.answer]
      : Array.isArray(question.correctAnswer)
        ? question.correctAnswer
        : typeof question.correctAnswer === 'string'
          ? [question.correctAnswer]
          : [];

  const correctOptionIds = answers
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const match = optionList.find((option) => option.id === value || option.label === value);
      return match?.id || value;
    });

  const selectionMode = question.type === 'multiple' ? 'multiple' : 'single';
  return {
    draftId: question.id,
    title: question.question.slice(0, 80),
    type: 'choice',
    status: 'published',
    source: 'legacy_quiz_scene',
    points: 100,
    tags: [],
    difficulty: 'medium',
    publicContent: {
      type: 'choice',
      stem: question.question,
      selectionMode,
      options: optionList,
      explanation: question.explanation,
    },
    grading: {
      type: 'choice',
      correctOptionIds,
      analysis: question.analysis,
    },
    sourceMeta: {
      legacyQuestionType: question.type,
    },
    validationErrors: correctOptionIds.length === 0 ? ['缺少正确答案'] : [],
  };
}

export function buildLegacyProblemDraftFromQuizQuestion(
  question: QuizQuestion,
  scene: Scene,
): NotebookProblemImportDraft | null {
  if (
    question.type === 'single' ||
    question.type === 'multiple' ||
    question.type === 'multiple_choice'
  ) {
    const choice = normalizeQuizChoiceType(question);
    if (!choice) return null;
    return {
      ...choice,
      sourceMeta: {
        ...choice.sourceMeta,
        sceneId: scene.id,
        sceneTitle: scene.title,
      },
    };
  }

  if (question.type === 'short_answer') {
    return {
      draftId: question.id,
      title: question.question.slice(0, 80),
      type: 'short_answer',
      status: 'published',
      source: 'legacy_quiz_scene',
      points: 100,
      tags: [],
      difficulty: 'medium',
      publicContent: {
        type: 'short_answer',
        stem: question.question,
        explanation: question.explanation,
      },
      grading: {
        type: 'short_answer',
        referenceAnswer:
          typeof question.answer === 'string'
            ? question.answer
            : typeof question.correctAnswer === 'string'
              ? question.correctAnswer
              : undefined,
        rubric: question.commentPrompt,
        analysis: question.analysis,
      },
      sourceMeta: {
        sceneId: scene.id,
        sceneTitle: scene.title,
        legacyQuestionType: question.type,
      },
      validationErrors: [],
    };
  }

  if (question.type === 'proof') {
    return {
      draftId: question.id,
      title: question.question.slice(0, 80),
      type: 'proof',
      status: 'published',
      source: 'legacy_quiz_scene',
      points: 100,
      tags: [],
      difficulty: 'hard',
      publicContent: {
        type: 'proof',
        stem: question.question,
        explanation: question.explanation,
      },
      grading: {
        type: 'proof',
        referenceProof: question.proof,
        rubric: question.commentPrompt,
        analysis: question.analysis,
      },
      sourceMeta: {
        sceneId: scene.id,
        sceneTitle: scene.title,
        legacyQuestionType: question.type,
      },
      validationErrors: [],
    };
  }

  if (question.type === 'code') {
    const publicTests = (question.testCases ?? [])
      .filter((testCase) => !testCase.hidden)
      .map((testCase, index) => ({
        id: testCase.id || `public_${index + 1}`,
        description: testCase.description,
        expression: testCase.expression,
        expected: testCase.expected,
      }));
    const secretTests = (question.testCases ?? [])
      .filter((testCase) => testCase.hidden)
      .map((testCase, index) => ({
        id: testCase.id || `secret_${index + 1}`,
        description: testCase.description,
        expression: testCase.expression,
        expected: testCase.expected,
      }));
    const publishable =
      Boolean(question.language === 'python') && publicTests.length > 0 && secretTests.length > 0;
    return {
      draftId: question.id,
      title: question.question.slice(0, 80),
      type: 'code',
      status: publishable ? 'published' : 'draft',
      source: 'legacy_quiz_scene',
      points: 100,
      tags: [],
      difficulty: 'hard',
      publicContent: {
        type: 'code',
        stem: question.question,
        language: 'python',
        starterCode: question.starterCode,
        functionSignature: undefined,
        constraints: [],
        publicTests,
        sampleIO: [],
        secretConfigPresent: secretTests.length > 0,
        explanation: question.explanation,
      },
      grading: {
        type: 'code',
        analysis: question.analysis,
        publishRequirementsMet: publishable,
      },
      secretJudge:
        secretTests.length > 0
          ? {
              language: 'python',
              secretTests,
              timeoutMs: 5000,
            }
          : undefined,
      sourceMeta: {
        sceneId: scene.id,
        sceneTitle: scene.title,
        legacyQuestionType: question.type,
      },
      validationErrors: [
        ...(question.language && question.language !== 'python' ? ['仅支持 Python 代码题'] : []),
        ...(publicTests.length === 0 ? ['缺少 public tests'] : []),
        ...(secretTests.length === 0 ? ['缺少 secret tests'] : []),
      ],
    };
  }

  if (question.type === 'code_tracing') {
    if ((question.options?.length ?? 0) > 0) {
      const choice = normalizeQuizChoiceType({
        ...question,
        type: 'single',
      });
      if (!choice) return null;
      return {
        ...choice,
        sourceMeta: {
          sceneId: scene.id,
          sceneTitle: scene.title,
          legacyQuestionType: question.type,
        },
      };
    }
    return {
      draftId: question.id,
      title: question.question.slice(0, 80),
      type: 'short_answer',
      status: 'published',
      source: 'legacy_quiz_scene',
      points: 100,
      tags: [],
      difficulty: 'medium',
      publicContent: {
        type: 'short_answer',
        stem: question.question,
        explanation: question.explanation,
      },
      grading: {
        type: 'short_answer',
        referenceAnswer:
          typeof question.answer === 'string'
            ? question.answer
            : typeof question.correctAnswer === 'string'
              ? question.correctAnswer
              : undefined,
        rubric: question.commentPrompt,
        analysis: question.analysis,
      },
      sourceMeta: {
        sceneId: scene.id,
        sceneTitle: scene.title,
        legacyQuestionType: question.type,
        codeSnippet: question.codeSnippet || '',
      },
      validationErrors: [],
    };
  }

  return null;
}

export function buildLegacyProblemDraftsFromScene(scene: Scene): NotebookProblemImportDraft[] {
  if (scene.type !== 'quiz' || scene.content.type !== 'quiz') return [];
  return scene.content.questions
    .map((question) => buildLegacyProblemDraftFromQuizQuestion(question, scene))
    .filter(Boolean) as NotebookProblemImportDraft[];
}

export function isNotebookCodeProblemRecord(
  problem: NotebookProblemRecord,
): problem is NotebookCodeProblemRecord {
  return (
    problem.type === 'code' &&
    problem.publicContent.type === 'code' &&
    problem.grading.type === 'code'
  );
}

export function isNotebookChoiceProblemRecord(
  problem: NotebookProblemRecord,
): problem is NotebookChoiceProblemRecord {
  return (
    problem.type === 'choice' &&
    problem.publicContent.type === 'choice' &&
    problem.grading.type === 'choice'
  );
}

export function isNotebookFillBlankProblemRecord(
  problem: NotebookProblemRecord,
): problem is NotebookFillBlankProblemRecord {
  return (
    problem.type === 'fill_blank' &&
    problem.publicContent.type === 'fill_blank' &&
    problem.grading.type === 'fill_blank'
  );
}

export function isNotebookCalculationProblemRecord(
  problem: NotebookProblemRecord,
): problem is NotebookCalculationProblemRecord {
  return (
    problem.type === 'calculation' &&
    problem.publicContent.type === 'calculation' &&
    problem.grading.type === 'calculation'
  );
}

export function isNotebookShortAnswerProblemRecord(
  problem: NotebookProblemRecord,
): problem is NotebookShortAnswerProblemRecord {
  return (
    problem.type === 'short_answer' &&
    problem.publicContent.type === 'short_answer' &&
    problem.grading.type === 'short_answer'
  );
}

export function isNotebookProofProblemRecord(
  problem: NotebookProblemRecord,
): problem is NotebookProofProblemRecord {
  return (
    problem.type === 'proof' &&
    problem.publicContent.type === 'proof' &&
    problem.grading.type === 'proof'
  );
}

export function isNotebookMultipartProblemRecord(
  problem: NotebookProblemRecord,
): problem is NotebookMultipartProblemRecord {
  return (
    problem.type === 'multipart' &&
    problem.publicContent.type === 'multipart' &&
    problem.grading.type === 'multipart'
  );
}

export function isNotebookTableProblemRecord(
  problem: NotebookProblemRecord,
): problem is NotebookTableProblemRecord {
  return (
    problem.type === 'table' &&
    problem.publicContent.type === 'table' &&
    problem.grading.type === 'table'
  );
}
