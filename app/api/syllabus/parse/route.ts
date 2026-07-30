import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { UserContent } from 'ai';
import { z } from 'zod';
import { safeRoute } from '@/lib/server/json-error-response';
import { runWithRequestContext } from '@/lib/server/request-context';
import { resolveOpenAIResponsesModelFromHeaders } from '@/lib/server/resolve-model';
import { callLLM } from '@/lib/ai/llm';

export const runtime = 'nodejs';

const MAX_SYLLABUS_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_SYLLABUS_IMAGE_BYTES = 12 * 1024 * 1024;
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

const syllabusEventKindSchema = z.enum([
  'assignment',
  'exam',
  'progress',
  'tutorial',
  'holiday',
  'other',
]);

const syllabusParseSchema = z.object({
  courseTitle: z.string().optional().nullable(),
  events: z.array(
    z.object({
      title: z.string().min(1),
      kind: syllabusEventKindSchema,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      week: z.string().optional().nullable(),
      sourceColumn: z.string().optional().nullable(),
      rawText: z.string().optional().nullable(),
      confidence: z.number().min(0).max(1).optional().nullable(),
    }),
  ),
  warnings: z.array(z.string()),
});

function isPdfFile(file: File) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function syllabusImageMediaType(file: File): string | null {
  const mediaType = file.type.toLowerCase();
  if (SUPPORTED_IMAGE_MEDIA_TYPES.has(mediaType)) return mediaType;
  if (/\.jpe?g$/i.test(file.name)) return 'image/jpeg';
  if (/\.png$/i.test(file.name)) return 'image/png';
  if (/\.webp$/i.test(file.name)) return 'image/webp';
  if (/\.gif$/i.test(file.name)) return 'image/gif';
  return null;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }
    throw new Error('AI 没有返回可解析的 syllabus 日历数据。');
  }
}

function syllabusExtractionPrompt(args: {
  fileName: string;
  fileKind: 'PDF' | 'image';
  courseName?: string;
  courseDescription?: string;
}) {
  return `Read the attached syllabus ${args.fileKind} directly. Extract all student-relevant dated calendar items into strict JSON.

Context:
- Course name: ${args.courseName || 'unknown'}
- Course description: ${args.courseDescription || 'unknown'}
- File name: ${args.fileName}

Important rules:
- Preserve the visual table structure. Do not read the document as a single flat paragraph.
- The attachment may be one photographed or scanned syllabus page. Read all visible dates and associate them with the correct row, column, and event.
- For weekly schedule tables, combine the week beginning date with each column day when a cell only implies the weekday.
- If a cell contains an explicit date like "Tue 2 Jun", use that exact date.
- If the PDF title or header gives a year/term, use that year. Do not default to the current year when the PDF has its own year.
- Extract due dates, tests/exams/quizzes, assignments, tutorial activities, school progress/lecture topics, holidays, make-up days, and breaks.
- Use kind:
  - assignment: homework, WeBWorK, assignment, lab, project, due/deadline
  - exam: test, exam, quiz, midterm, final, make-up test
  - progress: lecture topics, weekly course progress, readings, modules, sections
  - tutorial: tutorial, two-stage activity, workshop
  - holiday: break, holiday, campus closed, no class due to holiday
  - other: only when nothing else fits
- Keep titles short and student-facing. Include coverage when listed, e.g. "Test 1 - Coverage: Weeks 1-4".
- Return JSON only. No Markdown.

JSON shape:
{
  "courseTitle": "string or null",
  "events": [
    {
      "title": "short title",
      "kind": "assignment|exam|progress|tutorial|holiday|other",
      "date": "YYYY-MM-DD",
      "week": "week label if available",
      "sourceColumn": "table column or section name",
      "rawText": "cell text used",
      "confidence": 0.0
    }
  ],
  "warnings": ["short warning if extraction is uncertain"]
}`;
}

export async function POST(request: NextRequest) {
  return runWithRequestContext(
    request,
    '/api/syllabus/parse',
    () =>
      safeRoute(async () => {
        const formData = await request.formData();
        const file = formData.get('file') || formData.get('pdf');
        if (!(file instanceof File)) {
          return NextResponse.json({ error: '请上传 syllabus 图片或 PDF 文件。' }, { status: 400 });
        }
        const isPdf = isPdfFile(file);
        const imageMediaType = syllabusImageMediaType(file);
        if (!isPdf && !imageMediaType) {
          return NextResponse.json(
            { error: '当前 AI 解析支持 PDF、PNG、JPG、WEBP 和 GIF。' },
            { status: 400 },
          );
        }
        const maxBytes = isPdf ? MAX_SYLLABUS_DOCUMENT_BYTES : MAX_SYLLABUS_IMAGE_BYTES;
        if (file.size > maxBytes) {
          return NextResponse.json(
            {
              error: isPdf
                ? 'PDF 文件太大，请上传 20MB 以内的 syllabus。'
                : '图片文件太大，请上传 12MB 以内的 syllabus 图片。',
            },
            { status: 400 },
          );
        }

        const arrayBuffer = await file.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);
        const { model, modelString } = await resolveOpenAIResponsesModelFromHeaders(request, {
          allowOpenAIModelOverride: true,
        });
        const modelId = modelString.replace(/^openai:/, '');
        const content: UserContent = [
          {
            type: 'text',
            text: syllabusExtractionPrompt({
              fileName: file.name,
              fileKind: isPdf ? 'PDF' : 'image',
              courseName: String(formData.get('courseName') || ''),
              courseDescription: String(formData.get('courseDescription') || ''),
            }),
          },
          isPdf
            ? {
                type: 'file',
                data: fileBuffer,
                mediaType: 'application/pdf',
                filename: file.name,
              }
            : {
                type: 'image',
                image: fileBuffer,
                mediaType: imageMediaType || undefined,
              },
        ];

        const result = await callLLM(
          {
            model,
            system:
              'You are a careful university syllabus calendar extraction engine. Return only valid JSON matching the requested schema.',
            maxOutputTokens: 12000,
            messages: [
              {
                role: 'user',
                content,
              },
            ],
            maxRetries: 0,
          },
          'syllabus-file-extraction',
        );

        const parsed = syllabusParseSchema.parse(extractJsonObject(result.text));

        const savedAt = Date.now();
        const events = parsed.events.map((event, index) => ({
          ...event,
          id: `syllabus-${savedAt}-${index}-${randomUUID().slice(0, 8)}`,
        }));
        return NextResponse.json({
          success: true,
          parser: isPdf ? 'openai-responses-input-file' : 'openai-responses-image',
          sourceType: isPdf ? 'pdf' : 'image',
          modelId,
          courseTitle: parsed.courseTitle || null,
          events,
          warnings: parsed.warnings,
        });
      }),
    {
      operationCode: 'syllabus_file_import',
      chargeReason: 'AI 读取 syllabus 文件',
    },
  );
}
