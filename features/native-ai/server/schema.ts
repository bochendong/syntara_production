import { z } from 'zod';

/** 手机 / iPad / 桌面三种界面；只有手机不提供题库。 */
export const nativeChatSurfaceSchema = z.enum(['phone', 'tablet', 'desktop']);
export type NativeChatSurface = z.infer<typeof nativeChatSurfaceSchema>;

const shortText = (max: number) => z.string().trim().max(max);

export const nativeChatRequestSchema = z.object({
  requestId: z.string().trim().min(1).max(160),
  surface: nativeChatSurfaceSchema,
  scope: z.enum(['course', 'general']).default('course'),
  course: z.object({
    id: shortText(200).optional(),
    name: z.string().trim().min(1).max(200),
    code: shortText(80).nullish(),
    description: shortText(4000).optional().default(''),
    language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
  }),
  /** 最近的对话，最后一条是这次学生的问题。 */
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(6000) }))
    .min(1)
    .max(16),
  images: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        // App 发送前已压缩；约 2.6 MB base64 ≈ 2 MB 图片。
        dataBase64: z.string().min(1).max(2_800_000),
      }),
    )
    .max(4)
    .default([]),
  /** 聊天里附的文件（PDF、Word、PPT、纯文本），服务端抽成文字再给模型。 */
  files: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        mimeType: z.string().trim().min(1).max(200),
        // 单个文件最多约 10 MB。
        dataBase64: z.string().min(1).max(14_000_000),
      }),
    )
    .max(3)
    .default([]),
  /** App 本机的资料（本机优先：记忆、日历可能还没同步到服务器）。 */
  context: z
    .object({
      today: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      progress: z
        .object({
          completedNotebooks: z.number().int().min(0).max(10_000),
          totalNotebooks: z.number().int().min(0).max(10_000),
          currentNotebook: shortText(300).nullish(),
        })
        .optional(),
      /** 按这次问题挑出的笔记片段，只来自学习进度之内的笔记本。 */
      notes: z
        .array(
          z.object({
            id: shortText(200),
            notebookId: shortText(200).optional(),
            notebook: shortText(300),
            title: shortText(300),
            content: z.string().max(6000),
          }),
        )
        .max(8)
        .default([]),
      memories: z
        .array(
          z.object({
            id: shortText(200),
            kind: shortText(80),
            title: shortText(300),
            text: z.string().max(1200),
            /** 星图上的概念标签（concept:xxx 去掉前缀）。 */
            concepts: z.array(shortText(60)).max(6).default([]),
          }),
        )
        .max(40)
        .default([]),
      calendar: z
        .array(
          z.object({
            id: shortText(240),
            title: shortText(300),
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            kind: shortText(40),
            status: shortText(40).optional(),
          }),
        )
        .max(80)
        .default([]),
      attempts: z
        .array(
          z.object({
            problemId: shortText(200),
            title: shortText(300),
            status: shortText(80),
            answer: z.string().max(1200).optional(),
            feedback: z.string().max(800).optional(),
          }),
        )
        .max(12)
        .default([]),
      problems: z
        .array(
          z.object({
            id: shortText(200),
            title: shortText(300),
            type: shortText(80).optional(),
            difficulty: shortText(40).optional(),
            tags: z.array(shortText(80)).max(12).default([]),
            excerpt: z.string().max(600).optional(),
            status: shortText(80).nullish(),
          }),
        )
        .max(40)
        .default([]),
    })
    .default({ notes: [], memories: [], calendar: [], attempts: [], problems: [] }),
});

export type NativeChatRequest = z.infer<typeof nativeChatRequestSchema>;
