import { NextRequest } from 'next/server';
import { callLLM } from '@/lib/ai/llm';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { runWithRequestContext } from '@/lib/server/request-context';

const log = createLogger('MicroLessonInsertPosition');

type PageSummary = {
  order: number;
  title: string;
  summary: string;
};

type InsertPositionRequest = {
  notebookTitle?: string;
  currentPages?: PageSummary[];
  lessonPages?: PageSummary[];
};

function safePages(input: unknown, max = 80): PageSummary[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((p) => {
      const row = p as Partial<PageSummary>;
      const order = Number(row.order);
      const title = String(row.title || '').trim();
      const summary = String(row.summary || '').trim();
      if (!Number.isFinite(order) || !title) return null;
      return { order, title, summary: summary.slice(0, 600) } satisfies PageSummary;
    })
    .filter(Boolean)
    .slice(0, max) as PageSummary[];
}

function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned.trim();
}

export async function POST(req: NextRequest) {
  return runWithRequestContext(req, '/api/notebooks/micro-lesson/insert-position', async () => {
    try {
      const body = (await req.json()) as InsertPositionRequest;
      const currentPages = safePages(body.currentPages);
      const lessonPages = safePages(body.lessonPages, 12);
      if (lessonPages.length === 0) {
        return apiError('MISSING_REQUIRED_FIELD', 400, 'lessonPages is required');
      }
      if (currentPages.length === 0) {
        return apiSuccess({ insertAfterOrder: -1, reason: 'Notebook is empty, insert at beginning.' });
      }

      const maxOrder = Math.max(...currentPages.map((p) => p.order));
      const { model, modelString } = await resolveModelFromHeaders(req, {
        allowOpenAIModelOverride: true,
      });
      const system = `You are a curriculum editor. Decide the best insertion position for new lesson pages in an existing notebook outline.
Return strict JSON only.`;
      const prompt = `Notebook title: ${body.notebookTitle?.trim() || '未命名笔记本'}

Existing pages (ordered):
${JSON.stringify(currentPages)}

Temporary lesson pages to insert:
${JSON.stringify(lessonPages)}

Return JSON:
{
  "insertAfterOrder": number, // -1 means insert at beginning
  "reason": "short reason"
}

Rules:
- Preserve narrative continuity.
- Prefer inserting near semantically related pages.
- If no good match, append at end (insertAfterOrder = ${maxOrder}).
- insertAfterOrder must be between -1 and ${maxOrder}.`;

      log.info(`Micro lesson insert-position [model=${modelString}]`);
      const llm = await callLLM({ model, system, prompt }, 'micro-lesson-insert-position');
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripCodeFences(llm.text));
      } catch {
        return apiError('PARSE_FAILED', 500, 'Failed to parse insert position');
      }
      const out = parsed as Partial<{ insertAfterOrder: number; reason: string }>;
      const raw = Number(out.insertAfterOrder);
      const insertAfterOrder = Number.isFinite(raw) ? Math.min(maxOrder, Math.max(-1, Math.round(raw))) : maxOrder;
      const reason = String(out.reason || '').trim().slice(0, 240);
      return apiSuccess({ insertAfterOrder, reason });
    } catch (error) {
      return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : 'Unknown error');
    }
  });
}
