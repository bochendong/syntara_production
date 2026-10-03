import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withAiFailureAudit } from '@/lib/server/ai-failure-log';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requirePublicApi,
} from '@/lib/server/public-api';
import { withRequestContext } from '@/lib/server/request-context';
import { resolveOpenAIResponsesModelFromHeaders } from '@/lib/server/resolve-model';
import { importUploadedProblemFile } from '@/features/problems/server/import';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_FILE_BYTES = 20 * 1024 * 1024;

async function auditedPOST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = requirePublicApi(request, requestId);
  if (principal instanceof NextResponse) return principal;

  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    return publicApiError(requestId, 415, 'unsupported_media_type', 'Use multipart/form-data.');
  }
  const contentLength = Number(request.headers.get('content-length'));
  if (contentLength > MAX_FILE_BYTES + 1024 * 1024) {
    return publicApiError(requestId, 413, 'invalid_request', 'Maximum PDF size is 20 MiB.');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return publicApiError(requestId, 400, 'invalid_request', 'Invalid multipart form.');
  }
  const file = form.get('file');
  const language = form.get('language') ?? 'zh-CN';
  const verifyAnswers = form.get('verify_answers') ?? 'false';
  if (!(file instanceof File) || form.getAll('file').length !== 1 || file.size === 0) {
    return publicApiError(requestId, 400, 'invalid_request', 'Provide one non-empty file field.');
  }
  if (file.size > MAX_FILE_BYTES) {
    return publicApiError(requestId, 413, 'invalid_request', 'Maximum PDF size is 20 MiB.');
  }
  if (language !== 'zh-CN' && language !== 'en-US') {
    return publicApiError(requestId, 400, 'invalid_request', 'language must be zh-CN or en-US.');
  }
  if (verifyAnswers !== 'true' && verifyAnswers !== 'false') {
    return publicApiError(
      requestId,
      400,
      'invalid_request',
      'verify_answers must be true or false.',
    );
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    return publicApiError(
      requestId,
      415,
      'unsupported_media_type',
      'Only PDF files are supported.',
    );
  }

  try {
    const resolved = await resolveOpenAIResponsesModelFromHeaders(request);
    const result = await withRequestContext(
      {
        userId: principal.userId,
        route: '/api/v1/problem-imports',
        operationCode: 'public_problem_import',
        chargeReason: '上传题目生成',
      },
      () =>
        importUploadedProblemFile({
          buffer,
          fileName: file.name || 'problems.pdf',
          model: resolved.model,
          language,
          verifyAnswers: verifyAnswers === 'true',
        }),
    );
    return publicApiSuccess(requestId, {
      id: `pimport_${randomUUID()}`,
      object: 'problem_import',
      created_at: new Date().toISOString(),
      model: resolved.modelString,
      source: { file_name: file.name, bytes: file.size, openai_file_id: result.fileId },
      verify_answers: verifyAnswers === 'true',
      first_pass: result.firstPass,
      problems: result.drafts,
      skipped: result.skipped,
      quality_report: { ...result.report, coverage: result.coverage },
      usage: result.usage,
      storage: 'none',
    });
  } catch (error) {
    return publicApiError(
      requestId,
      502,
      'generation_failed',
      error instanceof Error ? error.message : 'Problem import failed.',
    );
  }
}

export const POST = withAiFailureAudit(auditedPOST);
