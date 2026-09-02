import { createHash, randomBytes } from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { FormData as UndiciFormData } from 'undici';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { resolveOpenAIResponsesModelFromHeaders } from '@/lib/server/resolve-model';
import { parsePDF } from '@/lib/pdf/pdf-providers';
import type { PDFProviderId } from '@/lib/pdf/types';
import { parseDocxBuffer } from '@/lib/docx/parse-docx-buffer';
import { parsePptxBuffer } from '@/lib/ppt/pptx-parser';
import { resolvePDFApiKey, resolvePDFBaseUrl } from '@/lib/server/provider-config';
import { getSystemLLMRuntimeConfig } from '@/lib/server/system-llm-config';
import { proxyFetch, proxyRequest } from '@/lib/server/proxy-fetch';
import { findOwnedCourse } from '@/lib/server/repositories/course-repository';
import { createLogger } from '@/lib/logger';
import {
  computeSourceUploadHash,
  ingestCourseSourceUpload,
  prepareCourseSourceProblemReuseOnlyPlan,
  prepareCheatSheetPrompt,
  prepareSourceMarkdownNotebook,
  type SourceProblemReuseOnlyPlan,
  type SourceUploadIngestionResult,
  type SourceUploadKind,
} from '@/features/memory/server/source-upload-ingestion';
import {
  findStoredCourseSource,
  isCourseSourceIngestLeaseActive,
  markCourseSourceError,
  markCourseSourceProcessing,
  markCourseSourceReady,
} from '@/features/memory/server/course-source-store';
import {
  deleteCourseSourceUpload,
  deleteOpenAIUserFiles,
  listCourseSourceUploads,
} from '@/features/memory/server/source-upload-library';
import { indexCourseSourceKnowledge } from '@/lib/server/knowledge-document-index';
import { extractCourseSourceImageText } from '@/lib/server/extract-course-source-image-text';
import {
  COURSE_SOURCE_MAX_FILE_BYTES,
  courseSourceFileKind,
  courseSourceFileValidationError,
  normalizedCourseSourceMimeType,
} from '@/lib/uploads/course-source-policy';
import { verifyOpenAIFileCapability } from '@/lib/server/openai-upload-capability';
import { downloadOpenAIUserFile } from '@/lib/server/openai-user-files';

export const maxDuration = 300;

const MAX_SOURCE_TEXT_CHARS = 220_000;
const OPENAI_FILE_UPLOAD_MIN_TIMEOUT_MS = 90_000;
const OPENAI_FILE_UPLOAD_MAX_TIMEOUT_MS = 300_000;
const OPENAI_MULTIPART_UPLOAD_THRESHOLD_BYTES = 8 * 1024 * 1024;
const OPENAI_UPLOAD_PART_BYTES = 4 * 1024 * 1024;
const OPENAI_UPLOAD_STEP_TIMEOUT_MS = 120_000;
const OPENAI_FILE_INPUT_READY_TIMEOUT_MS = 15_000;
const OPENAI_FILE_INPUT_MIN_AGE_MS = 4_000;
const log = createLogger('CourseSourceIngest');

function sanitizeSourceText(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\uFFFD/g, '')
    .trim();
}

const sourceUploadSchema = z.object({
  sourceTitle: z.string().trim().min(1).max(240),
  sourceKind: z
    .enum(['pdf', 'markdown', 'plain_text', 'pptx', 'docx', 'image', 'problem_bank', 'other'])
    .default('plain_text'),
  sourceFileMime: z.string().trim().max(160).optional(),
  targetNotebookId: z.string().trim().min(1).optional(),
  language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
  usageProfile: z.enum(['research', 'university_course', 'daily_use']).optional(),
  coverTitle: z.string().trim().max(120).optional(),
  coverCourseLabel: z.string().trim().max(80).optional(),
  coverFocus: z.string().trim().max(1200).optional(),
  requireNotebookCover: z.boolean().default(false),
  ingestIntent: z.enum(['standard', 'maintenance_pilot_reuse_only']).default('standard'),
  expectedReusableProblemCount: z.number().int().min(1).max(5000).optional(),
  outputMode: z.enum(['ingest', 'cover_prompt', 'notebook_content']).default('ingest'),
  text: z.preprocess(
    (value) => (typeof value === 'string' ? sanitizeSourceText(value) : value),
    z.string().trim().min(1).max(MAX_SOURCE_TEXT_CHARS),
  ),
});

const stagedSourceUploadSchema = z.object({
  stagedFileToken: z.string().trim().min(1),
  sourceTitle: z.string().trim().min(1).max(240).optional(),
  sourceKind: z
    .enum(['pdf', 'markdown', 'plain_text', 'pptx', 'docx', 'image', 'problem_bank', 'other'])
    .optional(),
  targetNotebookId: z.string().trim().min(1).optional(),
  language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
  usageProfile: z.enum(['research', 'university_course', 'daily_use']).optional(),
  coverTitle: z.string().trim().max(120).optional(),
  coverCourseLabel: z.string().trim().max(80).optional(),
  coverFocus: z.string().trim().max(1200).optional(),
  requireNotebookCover: z.boolean().default(false),
  ingestIntent: z.enum(['standard', 'maintenance_pilot_reuse_only']).default('standard'),
  expectedReusableProblemCount: z.number().int().min(1).max(5000).optional(),
  outputMode: z.enum(['ingest', 'cover_prompt', 'notebook_content']).default('ingest'),
});

export type NormalizedSourceUploadPayload = {
  sourceTitle: string;
  sourceKind: SourceUploadKind;
  sourceFileMime?: string;
  targetNotebookId?: string;
  language: 'zh-CN' | 'en-US';
  usageProfile?: 'research' | 'university_course' | 'daily_use';
  coverTitle?: string;
  coverCourseLabel?: string;
  coverFocus?: string;
  requireNotebookCover: boolean;
  ingestIntent: 'standard' | 'maintenance_pilot_reuse_only';
  expectedReusableProblemCount?: number;
  outputMode: 'ingest' | 'cover_prompt' | 'notebook_content';
  text: string;
  rawFileHash?: string | null;
  openaiFileId?: string | null;
  parser?: string | null;
  pageCount?: number | null;
  slideCount?: number | null;
  deferredOpenAIFileUpload?: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
  };
  originalFile?: Buffer;
  originalFileSize?: number;
};

function stringFormValue(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseSourceIngestControls(args: {
  rawIntent: unknown;
  rawExpectedReusableProblemCount: unknown;
  outputMode: NormalizedSourceUploadPayload['outputMode'];
}):
  | Pick<NormalizedSourceUploadPayload, 'ingestIntent' | 'expectedReusableProblemCount'>
  | NextResponse {
  const rawIntent =
    typeof args.rawIntent === 'string' && args.rawIntent.trim()
      ? args.rawIntent.trim()
      : 'standard';
  if (rawIntent !== 'standard' && rawIntent !== 'maintenance_pilot_reuse_only') {
    return NextResponse.json(
      {
        error: 'ingestIntent must be standard or maintenance_pilot_reuse_only.',
        code: 'INVALID_SOURCE_INGEST_INTENT',
      },
      { status: 400 },
    );
  }

  const hasExpectedCount =
    args.rawExpectedReusableProblemCount !== undefined &&
    args.rawExpectedReusableProblemCount !== null &&
    String(args.rawExpectedReusableProblemCount).trim() !== '';
  if (rawIntent === 'standard') {
    if (hasExpectedCount) {
      return NextResponse.json(
        {
          error: 'expectedReusableProblemCount is only valid for maintenance_pilot_reuse_only.',
          code: 'INVALID_SOURCE_REUSE_ONLY_CONTRACT',
        },
        { status: 400 },
      );
    }
    return { ingestIntent: 'standard' };
  }

  if (args.outputMode !== 'ingest') {
    return NextResponse.json(
      {
        error: 'maintenance_pilot_reuse_only is only valid for production ingestion.',
        code: 'INVALID_SOURCE_REUSE_ONLY_CONTRACT',
      },
      { status: 400 },
    );
  }
  const expectedReusableProblemCount = Number(args.rawExpectedReusableProblemCount);
  if (
    !Number.isInteger(expectedReusableProblemCount) ||
    expectedReusableProblemCount < 1 ||
    expectedReusableProblemCount > 5000
  ) {
    return NextResponse.json(
      {
        error:
          'maintenance_pilot_reuse_only requires expectedReusableProblemCount between 1 and 5000.',
        code: 'INVALID_SOURCE_REUSE_ONLY_CONTRACT',
      },
      { status: 400 },
    );
  }
  return {
    ingestIntent: 'maintenance_pilot_reuse_only',
    expectedReusableProblemCount,
  };
}

function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function sourceTextTooLongResponse(actualChars: number): NextResponse {
  return NextResponse.json(
    {
      error: `Uploaded source text contains ${actualChars} characters, exceeding the ${MAX_SOURCE_TEXT_CHARS} character limit.`,
      code: 'SOURCE_TEXT_TOO_LARGE',
      details: {
        actualChars,
        maxChars: MAX_SOURCE_TEXT_CHARS,
      },
    },
    { status: 413 },
  );
}

function openAIFileUploadTimeoutMs(fileBytes: number): number {
  // Large multipart bodies can be buffered by a local HTTP proxy. Budget for a
  // conservative 64 KiB/s upstream rate while still keeping a hard ceiling.
  return Math.min(
    OPENAI_FILE_UPLOAD_MAX_TIMEOUT_MS,
    Math.max(
      OPENAI_FILE_UPLOAD_MIN_TIMEOUT_MS,
      30_000 + Math.ceil(fileBytes / (64 * 1024)) * 1_000,
    ),
  );
}

function isSourceKind(value: string | undefined): value is SourceUploadKind {
  return (
    value === 'pdf' ||
    value === 'markdown' ||
    value === 'plain_text' ||
    value === 'pptx' ||
    value === 'docx' ||
    value === 'image' ||
    value === 'problem_bank' ||
    value === 'other'
  );
}

async function openAIRequestJson(args: {
  url: string;
  apiKey: string;
  method: 'POST';
  body?: string | Buffer;
  contentType?: string;
  contentLength?: number;
}): Promise<Record<string, unknown>> {
  const response = await proxyRequest(args.url, {
    method: args.method,
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      ...(args.contentType ? { 'content-type': args.contentType } : {}),
      ...(typeof args.contentLength === 'number'
        ? { 'content-length': String(args.contentLength) }
        : {}),
    },
    body: args.body,
    headersTimeout: OPENAI_UPLOAD_STEP_TIMEOUT_MS,
    bodyTimeout: OPENAI_UPLOAD_STEP_TIMEOUT_MS,
    signal: AbortSignal.timeout(OPENAI_UPLOAD_STEP_TIMEOUT_MS),
  });
  const responseText = await response.body.text();
  const data = (() => {
    try {
      return JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const error = asRecord(data.error);
    const message = typeof error?.message === 'string' ? error.message : responseText.slice(0, 240);
    throw new Error(`OpenAI upload request failed (${response.statusCode}): ${message}`);
  }
  return data;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function openAIUploadPartBody(
  chunk: Buffer,
  partIndex: number,
): { body: Buffer; contentType: string } {
  const boundary = `----OpenMAICPart${randomBytes(12).toString('hex')}`;
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="data"; filename="part-${String(partIndex).padStart(3, '0')}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([prefix, chunk, suffix]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function uploadOpenAIUserFileInParts(args: {
  baseUrl: string;
  apiKey: string;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<string> {
  const created = await openAIRequestJson({
    url: `${args.baseUrl}/uploads`,
    apiKey: args.apiKey,
    method: 'POST',
    body: JSON.stringify({
      purpose: 'user_data',
      filename: args.fileName,
      bytes: args.buffer.byteLength,
      mime_type: args.mimeType || 'application/octet-stream',
    }),
    contentType: 'application/json',
  });
  const uploadId = typeof created.id === 'string' ? created.id : '';
  if (!uploadId) throw new Error('OpenAI Uploads API did not return an upload id.');

  try {
    const partIds: string[] = [];
    for (
      let offset = 0, partIndex = 0;
      offset < args.buffer.byteLength;
      offset += OPENAI_UPLOAD_PART_BYTES, partIndex += 1
    ) {
      const chunk = args.buffer.subarray(
        offset,
        Math.min(offset + OPENAI_UPLOAD_PART_BYTES, args.buffer.byteLength),
      );
      const multipart = openAIUploadPartBody(chunk, partIndex);
      const part = await openAIRequestJson({
        url: `${args.baseUrl}/uploads/${encodeURIComponent(uploadId)}/parts`,
        apiKey: args.apiKey,
        method: 'POST',
        body: multipart.body,
        contentType: multipart.contentType,
        contentLength: multipart.body.byteLength,
      });
      const partId = typeof part.id === 'string' ? part.id : '';
      if (!partId) throw new Error(`OpenAI Uploads API did not return part ${partIndex + 1}.`);
      partIds.push(partId);
      log.info('OpenAI upload part finished.', {
        uploadId,
        part: partIndex + 1,
        partBytes: chunk.byteLength,
      });
    }

    const completed = await openAIRequestJson({
      url: `${args.baseUrl}/uploads/${encodeURIComponent(uploadId)}/complete`,
      apiKey: args.apiKey,
      method: 'POST',
      body: JSON.stringify({ part_ids: partIds }),
      contentType: 'application/json',
    });
    const file = asRecord(completed.file);
    const fileId = typeof file?.id === 'string' ? file.id : '';
    if (!fileId) throw new Error('OpenAI Uploads API completed without returning a file id.');
    return fileId;
  } catch (error) {
    await openAIRequestJson({
      url: `${args.baseUrl}/uploads/${encodeURIComponent(uploadId)}/cancel`,
      apiKey: args.apiKey,
      method: 'POST',
    }).catch(() => {});
    throw error;
  }
}

async function tryUploadOpenAIUserFile(args: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<string | null> {
  const startedAt = Date.now();
  const config = await getSystemLLMRuntimeConfig();
  if (!config.apiKey) {
    log.warn('Skipping OpenAI file upload because the system API key is missing.');
    return null;
  }
  const baseUrl = config.baseUrl?.replace(/\/+$/, '') || 'https://api.openai.com/v1';
  if (!/api\.openai\.com\/v1$/.test(baseUrl)) {
    log.warn('Skipping OpenAI file upload for a non-OpenAI base URL.', { baseUrl });
    return null;
  }

  try {
    const timeoutMs = openAIFileUploadTimeoutMs(args.buffer.byteLength);
    const useMultipartUpload = args.buffer.byteLength > OPENAI_MULTIPART_UPLOAD_THRESHOLD_BYTES;
    log.info(
      useMultipartUpload
        ? 'Uploading source file through OpenAI Uploads API.'
        : 'Uploading source file to OpenAI Files API.',
      {
        fileName: args.fileName,
        fileBytes: args.buffer.byteLength,
        timeoutMs,
      },
    );
    const fileId = useMultipartUpload
      ? await uploadOpenAIUserFileInParts({
          baseUrl,
          apiKey: config.apiKey,
          ...args,
        })
      : await (async () => {
          // proxyFetch uses the workspace undici package so the multipart body must
          // use that package's FormData implementation too. Node's global FormData
          // is from a different undici realm and otherwise gets serialized as
          // text/plain, which OpenAI rejects with HTTP 415.
          const formData = new UndiciFormData();
          formData.append('purpose', 'user_data');
          formData.append(
            'file',
            new Blob([new Uint8Array(args.buffer)], {
              type: args.mimeType || 'application/octet-stream',
            }),
            args.fileName,
          );
          const response = await proxyFetch(`${baseUrl}/files`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.apiKey}` },
            body: formData as unknown as BodyInit,
            signal: AbortSignal.timeout(timeoutMs),
          });
          const data = (await response.json().catch(() => ({}))) as { id?: unknown };
          if (!response.ok || typeof data.id !== 'string') {
            throw new Error(`OpenAI Files API upload failed (${response.status}).`);
          }
          return data.id;
        })();
    log.info('OpenAI file upload finished.', {
      strategy: useMultipartUpload ? 'uploads_api' : 'files_api',
      hasFileId: Boolean(fileId),
      durationMs: Date.now() - startedAt,
    });
    if (args.mimeType === 'application/pdf' || /\.pdf$/i.test(args.fileName)) {
      await waitForOpenAIFileInputReady({
        fileId,
        apiKey: config.apiKey,
        baseUrl,
      });
    }
    return fileId;
  } catch (error) {
    log.warn(
      'OpenAI Files API upload failed; AI file-input test modes will return this failure without fallback.',
      {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      },
    );
    return null;
  }
}

async function waitForOpenAIFileInputReady(args: {
  fileId: string;
  apiKey: string;
  baseUrl: string;
}): Promise<void> {
  const startedAt = Date.now();
  let lastStatus = 'unknown';
  while (Date.now() - startedAt < OPENAI_FILE_INPUT_READY_TIMEOUT_MS) {
    const response = await proxyFetch(`${args.baseUrl}/files/${encodeURIComponent(args.fileId)}`, {
      headers: { Authorization: `Bearer ${args.apiKey}` },
      signal: AbortSignal.timeout(OPENAI_UPLOAD_STEP_TIMEOUT_MS),
    });
    const file = (await response.json().catch(() => ({}))) as {
      id?: unknown;
      status?: unknown;
      created_at?: unknown;
      status_details?: unknown;
    };
    if (!response.ok || file.id !== args.fileId) {
      throw new Error(
        `OpenAI Files API could not retrieve the uploaded file (${response.status}).`,
      );
    }
    lastStatus = typeof file.status === 'string' ? file.status : 'processed';
    if (lastStatus === 'error') {
      throw new Error(
        `OpenAI Files API rejected the uploaded file: ${typeof file.status_details === 'string' ? file.status_details : 'unknown error'}`,
      );
    }
    const createdAtMs =
      typeof file.created_at === 'number' && Number.isFinite(file.created_at)
        ? file.created_at * 1_000
        : startedAt;
    const oldEnoughForResponses = Date.now() - createdAtMs >= OPENAI_FILE_INPUT_MIN_AGE_MS;
    if (lastStatus === 'processed' && oldEnoughForResponses) {
      log.info('OpenAI file input is ready for the Responses API.', {
        fileId: args.fileId,
        status: lastStatus,
        ageMs: Date.now() - createdAtMs,
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(
    `OpenAI file did not become ready for Responses within ${OPENAI_FILE_INPUT_READY_TIMEOUT_MS}ms (last status: ${lastStatus}).`,
  );
}

async function extractSourceTextFromFile(args: {
  request: NextRequest;
  file: File;
  sourceKind: SourceUploadKind;
  buffer: Buffer;
  formData: FormData;
  allowClientProviderConfig?: boolean;
}): Promise<{
  text: string;
  parser: string;
  pageCount: number | null;
  slideCount: number | null;
}> {
  if (args.sourceKind === 'pdf') {
    const allowClientProviderConfig = args.allowClientProviderConfig !== false;
    const providerId = (
      allowClientProviderConfig
        ? stringFormValue(args.formData, 'pdfProviderId') ||
          stringFormValue(args.formData, 'providerId') ||
          'unpdf'
        : 'unpdf'
    ) as PDFProviderId;
    const clientApiKey = allowClientProviderConfig
      ? stringFormValue(args.formData, 'pdfApiKey') || stringFormValue(args.formData, 'apiKey')
      : undefined;
    const clientBaseUrl = allowClientProviderConfig
      ? stringFormValue(args.formData, 'pdfBaseUrl') || stringFormValue(args.formData, 'baseUrl')
      : undefined;
    const parsed = await parsePDF(
      {
        providerId,
        apiKey: clientBaseUrl ? clientApiKey || '' : resolvePDFApiKey(providerId, clientApiKey),
        baseUrl: clientBaseUrl ? clientBaseUrl : resolvePDFBaseUrl(providerId, clientBaseUrl),
      },
      args.buffer,
    );
    return {
      text: parsed.text || '',
      parser: String(parsed.metadata?.parser || providerId),
      pageCount: typeof parsed.metadata?.pageCount === 'number' ? parsed.metadata.pageCount : null,
      slideCount: null,
    };
  }

  if (args.sourceKind === 'pptx') {
    const parsed = await parsePptxBuffer({
      buffer: args.buffer,
      fileName: args.file.name,
      fileSize: args.file.size,
    });
    return {
      text: parsed.text || '',
      parser: 'pptxtojson',
      pageCount: null,
      slideCount: parsed.metadata.slideCount,
    };
  }

  if (args.sourceKind === 'docx') {
    const parsed = await parseDocxBuffer({
      buffer: args.buffer,
      fileName: args.file.name,
      fileSize: args.file.size,
    });
    return {
      text: parsed.text,
      parser: 'docx-openxml',
      pageCount: null,
      slideCount: null,
    };
  }

  if (args.sourceKind === 'image') {
    const { model } = await resolveOpenAIResponsesModelFromHeaders(args.request, {
      allowOpenAIModelOverride: true,
    });
    return {
      text: await extractCourseSourceImageText({
        buffer: args.buffer,
        fileName: args.file.name,
        mimeType: normalizedCourseSourceMimeType(args.file, 'image'),
        model,
      }),
      parser: 'openai-responses-image',
      pageCount: null,
      slideCount: null,
    };
  }

  return {
    text: args.buffer.toString('utf8'),
    parser: 'text',
    pageCount: null,
    slideCount: null,
  };
}

async function parseMultipartSourceUpload(
  request: NextRequest,
  options: {
    outputMode?: NormalizedSourceUploadPayload['outputMode'];
    allowClientProviderConfig?: boolean;
  } = {},
): Promise<NormalizedSourceUploadPayload | NextResponse> {
  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No source file provided' }, { status: 400 });
  }
  const validationError = courseSourceFileValidationError(file);
  if (validationError) {
    return NextResponse.json(
      { error: validationError },
      {
        status: file.size <= 0 ? 400 : file.size > COURSE_SOURCE_MAX_FILE_BYTES ? 413 : 415,
      },
    );
  }

  const explicitKind = stringFormValue(formData, 'sourceKind');
  if (explicitKind && !isSourceKind(explicitKind)) {
    return NextResponse.json({ error: `不支持的课程资料类型：${explicitKind}。` }, { status: 400 });
  }
  const detectedKind = courseSourceFileKind(file);
  if (!detectedKind) {
    return NextResponse.json({ error: '无法识别上传文件的格式。' }, { status: 415 });
  }
  if (explicitKind && explicitKind !== detectedKind && explicitKind !== 'problem_bank') {
    return NextResponse.json(
      { error: `文件实际格式为 ${detectedKind}，与提交类型 ${explicitKind} 不一致。` },
      { status: 415 },
    );
  }
  const sourceKind: SourceUploadKind =
    explicitKind === 'problem_bank' ? 'problem_bank' : detectedKind;
  const extractionKind: SourceUploadKind = detectedKind;
  const sourceTitle = stringFormValue(formData, 'sourceTitle') || file.name;
  const languageValue = stringFormValue(formData, 'language');
  const language = languageValue === 'en-US' ? 'en-US' : 'zh-CN';
  const targetNotebookId = stringFormValue(formData, 'targetNotebookId');
  const usageProfileValue = stringFormValue(formData, 'usageProfile');
  const usageProfile =
    usageProfileValue === 'research' ||
    usageProfileValue === 'university_course' ||
    usageProfileValue === 'daily_use'
      ? usageProfileValue
      : undefined;
  const coverTitle = stringFormValue(formData, 'coverTitle');
  const coverCourseLabel = stringFormValue(formData, 'coverCourseLabel');
  const coverFocus = stringFormValue(formData, 'coverFocus');
  const requireNotebookCoverValue = stringFormValue(formData, 'requireNotebookCover');
  if (
    requireNotebookCoverValue &&
    !['true', 'false', '1', '0'].includes(requireNotebookCoverValue.toLowerCase())
  ) {
    return NextResponse.json(
      {
        error: 'requireNotebookCover must be true, false, 1, or 0.',
        code: 'INVALID_NOTEBOOK_COVER_REQUIREMENT',
      },
      { status: 400 },
    );
  }
  const requireNotebookCover =
    requireNotebookCoverValue === '1' || requireNotebookCoverValue?.toLowerCase() === 'true';
  const outputModeValue = stringFormValue(formData, 'outputMode');
  const outputMode =
    options.outputMode ||
    (outputModeValue === 'cover_prompt' || outputModeValue === 'notebook_content'
      ? outputModeValue
      : 'ingest');
  const ingestControls = parseSourceIngestControls({
    rawIntent: formData.get('ingestIntent'),
    rawExpectedReusableProblemCount: formData.get('expectedReusableProblemCount'),
    outputMode,
  });
  if (ingestControls instanceof NextResponse) return ingestControls;
  const buffer = Buffer.from(await file.arrayBuffer());
  const rawFileHash = sha256Buffer(buffer);
  log.info('Received source upload.', {
    fileName: file.name,
    fileBytes: file.size,
    sourceKind,
  });
  if (
    sourceKind === 'pdf' &&
    (outputMode === 'cover_prompt' || outputMode === 'notebook_content')
  ) {
    const openaiFileId = await tryUploadOpenAIUserFile({
      buffer,
      fileName: file.name || sourceTitle,
      mimeType: file.type || 'application/octet-stream',
    });
    if (!openaiFileId) {
      return NextResponse.json(
        {
          error: 'OpenAI Files API upload failed. PDF AI tests do not fall back to OCR text.',
        },
        { status: 502 },
      );
    }
    return {
      sourceTitle,
      sourceKind,
      sourceFileMime: file.type || 'application/pdf',
      targetNotebookId,
      language,
      usageProfile,
      coverTitle,
      coverCourseLabel,
      coverFocus,
      requireNotebookCover,
      ...ingestControls,
      outputMode,
      text: `Original PDF is attached through OpenAI Files API: ${sourceTitle}`,
      rawFileHash,
      openaiFileId,
      parser: 'openai-file-input',
      pageCount: null,
      slideCount: null,
      originalFile: buffer,
      originalFileSize: buffer.byteLength,
    };
  }
  const extractionStartedAt = Date.now();
  log.info('Extracting source text.', { fileName: file.name, sourceKind });
  let extracted: Awaited<ReturnType<typeof extractSourceTextFromFile>>;
  try {
    extracted = await extractSourceTextFromFile({
      request,
      file,
      sourceKind: extractionKind,
      buffer,
      formData,
      allowClientProviderConfig: options.allowClientProviderConfig,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (sourceKind === 'docx' && message.startsWith('Invalid DOCX file:')) {
      return NextResponse.json(
        {
          error: message,
          code: 'INVALID_DOCX_SOURCE',
        },
        { status: /too large|larger than/i.test(message) ? 413 : 400 },
      );
    }
    throw error;
  }
  log.info('Source text extraction finished.', {
    fileName: file.name,
    sourceKind,
    textChars: extracted.text.length,
    durationMs: Date.now() - extractionStartedAt,
  });
  const text = sanitizeSourceText(extracted.text);
  if (!text) {
    return NextResponse.json(
      { error: 'Uploaded source file was parsed, but no usable text was extracted' },
      { status: 400 },
    );
  }
  if (text.length > MAX_SOURCE_TEXT_CHARS) {
    return sourceTextTooLongResponse(text.length);
  }
  const deferOpenAIFileUpload = ingestControls.ingestIntent === 'maintenance_pilot_reuse_only';
  const deferredOpenAIFileUpload = deferOpenAIFileUpload
    ? {
        buffer,
        fileName: file.name || sourceTitle,
        mimeType: file.type || 'application/octet-stream',
      }
    : undefined;
  const openaiFileId = deferOpenAIFileUpload
    ? null
    : await tryUploadOpenAIUserFile({
        buffer,
        fileName: file.name || sourceTitle,
        mimeType: file.type || 'application/octet-stream',
      });

  return {
    sourceTitle,
    sourceKind,
    sourceFileMime: file.type || undefined,
    targetNotebookId,
    language,
    usageProfile,
    coverTitle,
    coverCourseLabel,
    coverFocus,
    requireNotebookCover,
    ...ingestControls,
    outputMode,
    text,
    rawFileHash,
    openaiFileId,
    parser: extracted.parser,
    pageCount: extracted.pageCount,
    slideCount: extracted.slideCount,
    deferredOpenAIFileUpload,
    originalFile: buffer,
    originalFileSize: buffer.byteLength,
  };
}

async function parseStagedSourceUpload(
  request: NextRequest,
  requestBody: unknown,
  options: {
    outputMode?: NormalizedSourceUploadPayload['outputMode'];
    allowClientProviderConfig?: boolean;
    userId?: string;
  },
): Promise<NormalizedSourceUploadPayload | NextResponse | null> {
  const record =
    requestBody && typeof requestBody === 'object' && !Array.isArray(requestBody)
      ? (requestBody as Record<string, unknown>)
      : null;
  if (typeof record?.stagedFileToken !== 'string') return null;
  if (!options.userId) {
    return NextResponse.json(
      { error: 'Staged file upload requires authentication.' },
      { status: 401 },
    );
  }
  const parsed = stagedSourceUploadSchema.safeParse(requestBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid staged source upload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const capability = verifyOpenAIFileCapability({
    token: parsed.data.stagedFileToken,
    userId: options.userId,
    intents: ['course_source', 'problem_bank_source'],
  });
  if (!capability) {
    return NextResponse.json({ error: '文件凭证无效或已过期。' }, { status: 403 });
  }
  const fileKind = courseSourceFileKind({
    name: capability.fileName,
    type: capability.mimeType,
  });
  if (!fileKind) {
    return NextResponse.json({ error: '无法识别已上传文件的格式。' }, { status: 415 });
  }
  const explicitKind = parsed.data.sourceKind;
  if (explicitKind && explicitKind !== fileKind && explicitKind !== 'problem_bank') {
    return NextResponse.json(
      { error: `文件实际格式为 ${fileKind}，与提交类型 ${explicitKind} 不一致。` },
      { status: 415 },
    );
  }
  const sourceKind: SourceUploadKind =
    capability.intent === 'problem_bank_source' || explicitKind === 'problem_bank'
      ? 'problem_bank'
      : (explicitKind ?? fileKind);
  const outputMode = options.outputMode || parsed.data.outputMode;
  const ingestControls = parseSourceIngestControls({
    rawIntent: parsed.data.ingestIntent,
    rawExpectedReusableProblemCount: parsed.data.expectedReusableProblemCount,
    outputMode,
  });
  if (ingestControls instanceof NextResponse) return ingestControls;

  const buffer = await downloadOpenAIUserFile(capability.fileId);
  if (buffer.byteLength !== capability.bytes || buffer.byteLength > COURSE_SOURCE_MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'OpenAI 文件大小与上传凭证不一致。' }, { status: 409 });
  }
  const file = new File([new Uint8Array(buffer)], capability.fileName, {
    type: capability.mimeType,
  });
  const extraction = await extractSourceTextFromFile({
    request,
    file,
    sourceKind: fileKind,
    buffer,
    formData: new FormData(),
    allowClientProviderConfig: options.allowClientProviderConfig,
  });
  const text = sanitizeSourceText(extraction.text);
  if (!text) {
    return NextResponse.json(
      { error: 'Uploaded source file was parsed, but no usable text was extracted' },
      { status: 400 },
    );
  }
  if (text.length > MAX_SOURCE_TEXT_CHARS) return sourceTextTooLongResponse(text.length);

  return {
    sourceTitle: parsed.data.sourceTitle || capability.fileName,
    sourceKind,
    sourceFileMime: capability.mimeType,
    targetNotebookId: sourceKind === 'problem_bank' ? undefined : parsed.data.targetNotebookId,
    language: parsed.data.language,
    usageProfile: parsed.data.usageProfile,
    coverTitle: parsed.data.coverTitle,
    coverCourseLabel: parsed.data.coverCourseLabel,
    coverFocus: parsed.data.coverFocus,
    requireNotebookCover: parsed.data.requireNotebookCover,
    ...ingestControls,
    outputMode,
    text,
    rawFileHash: sha256Buffer(buffer),
    openaiFileId: capability.fileId,
    parser: extraction.parser,
    pageCount: extraction.pageCount,
    slideCount: extraction.slideCount,
    originalFile: buffer,
    originalFileSize: buffer.byteLength,
  };
}

export async function parseSourceUploadPayload(
  request: NextRequest,
  options: {
    outputMode?: NormalizedSourceUploadPayload['outputMode'];
    allowClientProviderConfig?: boolean;
    userId?: string;
  } = {},
): Promise<NormalizedSourceUploadPayload | NextResponse> {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    return parseMultipartSourceUpload(request, options);
  }

  const requestBody: unknown = await request.json();
  const staged = await parseStagedSourceUpload(request, requestBody, options);
  if (staged) return staged;
  const rawText =
    requestBody && typeof requestBody === 'object' && !Array.isArray(requestBody)
      ? (requestBody as { text?: unknown }).text
      : undefined;
  if (typeof rawText === 'string') {
    const normalizedTextLength = rawText.trim().length;
    if (normalizedTextLength > MAX_SOURCE_TEXT_CHARS) {
      return sourceTextTooLongResponse(normalizedTextLength);
    }
  }
  const payload = sourceUploadSchema.safeParse(requestBody);
  if (!payload.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: payload.error.flatten() },
      { status: 400 },
    );
  }
  const outputMode = options.outputMode || payload.data.outputMode;
  const ingestControls = parseSourceIngestControls({
    rawIntent: payload.data.ingestIntent,
    rawExpectedReusableProblemCount: payload.data.expectedReusableProblemCount,
    outputMode,
  });
  if (ingestControls instanceof NextResponse) return ingestControls;
  return {
    sourceTitle: payload.data.sourceTitle,
    sourceKind: payload.data.sourceKind as SourceUploadKind,
    sourceFileMime: payload.data.sourceFileMime,
    targetNotebookId: payload.data.targetNotebookId,
    language: payload.data.language,
    usageProfile: payload.data.usageProfile,
    coverTitle: payload.data.coverTitle,
    coverCourseLabel: payload.data.coverCourseLabel,
    coverFocus: payload.data.coverFocus,
    requireNotebookCover: payload.data.requireNotebookCover,
    ...ingestControls,
    outputMode,
    text: payload.data.text,
    parser: 'legacy-json-text',
  };
}

function sourceIngestErrorReason(error: unknown, maxChars = 4000): string {
  const message = error instanceof Error ? error.message : String(error || '');
  return (message.trim() || 'Source ingest failed').slice(0, maxChars);
}

function sourceIngestFailureReason(originalReason: string, cleanupErrors: string[]): string {
  if (cleanupErrors.length === 0) return originalReason.slice(0, 4000);
  const cleanupReason = cleanupErrors.join(' | ').slice(0, 900);
  return `Ingest failed: ${originalReason.slice(0, 3000)}\nCleanup issues: ${cleanupReason}`.slice(
    0,
    4000,
  );
}

class CourseSourceIngestLeaseLostError extends Error {
  constructor() {
    super('Course source ingest lease was lost before finalization');
    this.name = 'CourseSourceIngestLeaseLostError';
  }
}

async function duplicateCourseSourceResponse(
  source: {
    courseId: string;
    sourceHash: string;
    ingestStatus: 'uploading' | 'uploaded' | 'processing' | 'ready' | 'error';
    indexStatus: 'pending' | 'indexing' | 'ready' | 'error';
    errorReason: string | null;
    openaiFileId?: string | null;
    openaiFileIds?: string[];
  },
  transientOpenAIFileId?: string | null,
): Promise<NextResponse> {
  const error =
    source.ingestStatus === 'uploading' || source.ingestStatus === 'uploaded'
      ? 'The same source has already been saved and is waiting for the teacher to start processing.'
      : source.ingestStatus === 'processing'
        ? 'The same source is already being ingested. Wait for it to finish before trying again.'
        : source.ingestStatus === 'ready'
          ? 'The same source is already in this course. Delete the existing source before uploading it again.'
          : 'The same source has a retained failure record. Delete that source record before retrying the upload.';
  const transientFileId = transientOpenAIFileId?.trim() || '';
  const retainedOpenAIFileIds = new Set(
    [source.openaiFileId || '', ...(source.openaiFileIds || [])].filter(Boolean),
  );
  const cleanup =
    transientFileId && !retainedOpenAIFileIds.has(transientFileId)
      ? await deleteOpenAIUserFiles([transientFileId])
      : { deletedCount: 0, errors: [] };
  if (cleanup.errors.length > 0) {
    log.warn(
      'Duplicate source upload was rejected, but its transient file cleanup was incomplete.',
      {
        courseId: source.courseId,
        sourceHash: source.sourceHash,
        cleanupErrors: cleanup.errors,
      },
    );
  }
  return NextResponse.json(
    {
      error,
      code: 'SOURCE_UPLOAD_CONFLICT',
      sourceHash: source.sourceHash,
      ingestStatus: source.ingestStatus,
      indexStatus: source.indexStatus,
      errorReason: source.errorReason,
      cleanupErrors: cleanup.errors,
    },
    { status: 409 },
  );
}

async function findLegacyCourseSourceUploadByHash(args: {
  userId: string;
  courseId: string;
  sourceHash: string;
}) {
  // Upload preflight only needs to know whether this hash already owns a
  // durable artifact. Avoid the full legacy source aggregation here: that
  // reader intentionally joins sections, problems, imports, memories, facts,
  // and cache rows, which is unnecessary load before a long-running ingest.
  const section = await prisma.markdownNotebookSection.findFirst({
    where: {
      notebook: { ownerId: args.userId, courseId: args.courseId },
      OR: [{ courseId: args.courseId }, { courseId: null }],
      sourceMeta: {
        path: ['sourceHash'],
        equals: args.sourceHash,
      },
    },
    select: { id: true },
  });
  if (section) {
    const sources = await listCourseSourceUploads({
      prisma,
      userId: args.userId,
      courseId: args.courseId,
      includeTextSections: false,
    });
    return sources.find((source) => source.sourceHash === args.sourceHash) ?? null;
  }

  const problem = await prisma.notebookProblem.findFirst({
    where: {
      AND: [
        {
          OR: [
            { courseId: args.courseId },
            {
              courseId: null,
              notebook: { courseId: args.courseId, ownerId: args.userId },
            },
          ],
        },
        {
          OR: [
            {
              sourceMeta: {
                path: ['uploadSourceHash'],
                equals: args.sourceHash,
              },
            },
            {
              sourceMeta: {
                path: ['sourceHash'],
                equals: args.sourceHash,
              },
            },
          ],
        },
      ],
    },
    select: { id: true },
  });
  if (!problem) return null;

  const sources = await listCourseSourceUploads({
    prisma,
    userId: args.userId,
    courseId: args.courseId,
    includeTextSections: false,
  });
  return sources.find((source) => source.sourceHash === args.sourceHash) ?? null;
}

function sourceArtifactCounts(result: SourceUploadIngestionResult) {
  return {
    notebookCount: result.notebook ? 1 : 0,
    sectionCount: result.notebook?.sections.length ?? 0,
    problemCount: result.problems.associatedCount,
    insertedProblemCount: result.problems.insertedCount,
    reusedProblemCount: result.problems.reusedProblemIds.length,
    duplicateProblemCount: result.problems.duplicateCount,
    importBatchCount: result.problems.importBatchId ? 1 : 0,
    memoryCount: result.memory.writtenCount,
    templateMemoryCount: result.memory.templateCount,
    knowledgeGraphFactCount: result.knowledgeGraph.factId ? 1 : 0,
    ragEntryCount: 1,
    openaiFileCount: result.source.openaiFileId ? 1 : 0,
  };
}

function sourceCatalogMetadata(
  payload: NormalizedSourceUploadPayload,
  result: SourceUploadIngestionResult,
) {
  return {
    rawFileHash: result.source.rawFileHash,
    parser: result.source.parser,
    pageCount: payload.pageCount ?? null,
    slideCount: payload.slideCount ?? null,
    language: payload.language,
    targetNotebookId: payload.targetNotebookId ?? null,
    documentType: result.classification.documentType,
    allQuestionUpload: result.classification.allQuestionUpload,
    aiSynthesisInput: result.source.aiSynthesisInput,
    notebookIds: result.notebook ? [result.notebook.id] : [],
    sectionIds: result.notebook?.sections.map((section) => section.id) ?? [],
    problemIds: result.problems.associatedProblemIds,
    insertedProblemIds: result.problems.insertedProblemIds,
    reusedProblemIds: result.problems.reusedProblemIds,
    problemReuseOnlyContract: result.problems.reuseOnlyContract,
    importBatchIds: result.problems.importBatchId ? [result.problems.importBatchId] : [],
    knowledgeGraphFactIds: result.knowledgeGraph.factId ? [result.knowledgeGraph.factId] : [],
    openaiFileIds: result.source.openaiFileId ? [result.source.openaiFileId] : [],
    coverImagePath: result.notebookCover?.imagePath ?? null,
    coverStatus: result.notebookCover?.status ?? null,
  };
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id } = await context.params;

    const course = await findOwnedCourse(prisma, auth.userId, id);
    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    const payload = await parseSourceUploadPayload(request, { userId: auth.userId });
    if (payload instanceof NextResponse) return payload;

    const resolved = await resolveOpenAIResponsesModelFromHeaders(request, {
      allowOpenAIModelOverride: true,
    }).catch(() => null);
    if (payload.outputMode === 'cover_prompt') {
      const preview = await prepareCheatSheetPrompt({
        sourceTitle: payload.sourceTitle,
        sourceKind: payload.sourceKind,
        sourceFileMime: payload.sourceFileMime,
        text: payload.text,
        rawFileHash: payload.rawFileHash,
        openaiFileId: payload.openaiFileId,
        parser: payload.parser,
        pageCount: payload.pageCount,
        slideCount: payload.slideCount,
        language: payload.language,
        usageProfile: payload.usageProfile,
        coverTitle: payload.coverTitle,
        coverCourseLabel: payload.coverCourseLabel,
        coverFocus: payload.coverFocus,
        model: resolved?.model,
        modelProviderId: resolved?.providerId,
      });
      return NextResponse.json({ storage: 'none', preview });
    }
    if (payload.outputMode === 'notebook_content') {
      const preview = await prepareSourceMarkdownNotebook({
        sourceTitle: payload.sourceTitle,
        sourceKind: payload.sourceKind,
        sourceFileMime: payload.sourceFileMime,
        text: payload.text,
        rawFileHash: payload.rawFileHash,
        openaiFileId: payload.openaiFileId,
        parser: payload.parser,
        pageCount: payload.pageCount,
        slideCount: payload.slideCount,
        language: payload.language,
        usageProfile: payload.usageProfile,
        model: resolved?.model,
        modelProviderId: resolved?.providerId,
      });
      return NextResponse.json({ storage: 'none', preview });
    }
    const ingestionStartedAt = Date.now();
    log.info('Starting production source ingestion.', {
      courseId: id,
      sourceTitle: payload.sourceTitle,
      sourceKind: payload.sourceKind,
      hasOpenAIFileId: Boolean(payload.openaiFileId),
    });
    const sourceHash = computeSourceUploadHash({
      sourceTitle: payload.sourceTitle,
      sourceKind: payload.sourceKind,
      text: payload.text,
      rawFileHash: payload.rawFileHash,
    });
    const reuseOnlyPilot = payload.ingestIntent === 'maintenance_pilot_reuse_only';
    const storedSource = await findStoredCourseSource({
      prisma,
      userId: auth.userId,
      courseId: id,
      sourceHash,
    });
    if (!storedSource.available) {
      const cleanup = await deleteOpenAIUserFiles(
        payload.openaiFileId ? [payload.openaiFileId] : [],
      );
      return NextResponse.json(
        {
          error: reuseOnlyPilot
            ? 'The source catalog is required for idempotent maintenance pilot ingestion.'
            : 'The source catalog is required for fenced source ingestion.',
          code: reuseOnlyPilot
            ? 'SOURCE_CATALOG_REQUIRED_FOR_MAINTENANCE_PILOT'
            : 'SOURCE_CATALOG_REQUIRED_FOR_INGEST',
          sourceHash,
          cleanupErrors: cleanup.errors,
        },
        { status: 503, headers: { 'Retry-After': '10' } },
      );
    }

    let processingReservation: Awaited<ReturnType<typeof markCourseSourceProcessing>> | null = null;
    let sourceLeaseToken: string | null = null;
    if (storedSource.source) {
      const staleProcessingSource =
        storedSource.source.ingestStatus === 'processing' &&
        !isCourseSourceIngestLeaseActive(storedSource.source);
      if (!staleProcessingSource) {
        return duplicateCourseSourceResponse(storedSource.source, payload.openaiFileId);
      }

      processingReservation = await markCourseSourceProcessing({
        prisma,
        userId: auth.userId,
        courseId: id,
        sourceHash,
        title: payload.sourceTitle,
        kind: payload.sourceKind,
        fileMime: payload.sourceFileMime,
        fileData: payload.originalFile,
        fileSize: payload.originalFileSize,
        // Keep the previous file reference until stale artifacts are cleaned.
        // A newly uploaded retry file must not be mistaken for stale data.
        openaiFileId: storedSource.source.openaiFileId,
        extractedText: payload.text,
        usageProfile: payload.usageProfile,
        metadata: {
          rawFileHash: payload.rawFileHash ?? null,
          parser: payload.parser ?? null,
          pageCount: payload.pageCount ?? null,
          slideCount: payload.slideCount ?? null,
          language: payload.language,
          targetNotebookId: payload.targetNotebookId ?? null,
        },
      });
      if (!processingReservation.available) {
        const cleanup = await deleteOpenAIUserFiles(
          payload.openaiFileId ? [payload.openaiFileId] : [],
        );
        return NextResponse.json(
          {
            error: 'The source catalog became unavailable during stale ingest recovery.',
            code: 'SOURCE_CATALOG_REQUIRED_FOR_INGEST',
            sourceHash,
            cleanupErrors: cleanup.errors,
          },
          { status: 503, headers: { 'Retry-After': '10' } },
        );
      }
      if (!processingReservation.source) {
        const conflictingSource = await findStoredCourseSource({
          prisma,
          userId: auth.userId,
          courseId: id,
          sourceHash,
        });
        if (conflictingSource.source) {
          return duplicateCourseSourceResponse(conflictingSource.source, payload.openaiFileId);
        }
        return NextResponse.json(
          {
            error: 'The expired source ingestion could not be atomically reclaimed.',
            code: 'SOURCE_INGEST_RECOVERY_REQUIRED',
            sourceHash,
          },
          { status: 409, headers: { 'Retry-After': '10' } },
        );
      }
      sourceLeaseToken = processingReservation.source.ingestLeaseToken?.trim() || null;
      if (!sourceLeaseToken) {
        return NextResponse.json(
          {
            error: 'Stale source recovery did not return a fencing token.',
            code: 'SOURCE_INGEST_LEASE_REQUIRED',
            sourceHash,
          },
          { status: 503, headers: { 'Retry-After': '10' } },
        );
      }

      try {
        const recovery = await deleteCourseSourceUpload({
          prisma,
          userId: auth.userId,
          courseId: id,
          sourceHash,
          preserveCatalog: true,
          preserveProblems: true,
        });
        if (recovery.deleted.problems !== 0) {
          throw new Error('Stale source recovery attempted to delete course problems');
        }
        if (
          recovery.deleted.openaiFiles > 0 &&
          storedSource.source.openaiFileId &&
          storedSource.source.openaiFileId === payload.openaiFileId
        ) {
          payload.openaiFileId = null;
        }
        log.warn('Recovered an expired CourseSource ingest lease before retrying.', {
          courseId: id,
          sourceHash,
          previousLeaseExpiresAt: storedSource.source.ingestLeaseExpiresAt,
          preservedProblems: recovery.preservedProblems,
          cleanupErrors: recovery.cleanupErrors,
        });
      } catch (error) {
        await markCourseSourceError({
          prisma,
          userId: auth.userId,
          courseId: id,
          sourceHash,
          leaseToken: sourceLeaseToken,
          errorReason: `Stale source recovery failed: ${sourceIngestErrorReason(error)}`,
        }).catch(() => null);
        const cleanup = await deleteOpenAIUserFiles(
          payload.openaiFileId ? [payload.openaiFileId] : [],
        );
        return NextResponse.json(
          {
            error:
              'The previous source ingestion lease expired, but its derived artifacts could not be safely recovered.',
            code: 'SOURCE_INGEST_RECOVERY_REQUIRED',
            sourceHash,
            recoveryError: sourceIngestErrorReason(error),
            cleanupErrors: cleanup.errors,
          },
          { status: 409, headers: { 'Retry-After': '10' } },
        );
      }
    } else {
      const legacySource = await findLegacyCourseSourceUploadByHash({
        userId: auth.userId,
        courseId: id,
        sourceHash,
      });
      if (legacySource) {
        return duplicateCourseSourceResponse(legacySource, payload.openaiFileId);
      }
    }
    let problemReuseOnlyPlan: SourceProblemReuseOnlyPlan | null = null;
    if (reuseOnlyPilot) {
      problemReuseOnlyPlan = await prepareCourseSourceProblemReuseOnlyPlan({
        prisma,
        userId: auth.userId,
        courseId: id,
        sourceHash,
        expectedProblemCount: payload.expectedReusableProblemCount!,
      });
      if (!problemReuseOnlyPlan.contract.satisfied) {
        if (sourceLeaseToken) {
          await markCourseSourceError({
            prisma,
            userId: auth.userId,
            courseId: id,
            sourceHash,
            leaseToken: sourceLeaseToken,
            errorReason: 'The stale source retry failed its reusable-problem contract.',
          }).catch(() => null);
        }
        const cleanup = await deleteOpenAIUserFiles(
          payload.openaiFileId ? [payload.openaiFileId] : [],
        );
        return NextResponse.json(
          {
            error:
              'The maintenance pilot could not prove the exact expected reusable question set. No source, notebook, import batch, memory, or problem artifact was persisted.',
            code: 'SOURCE_PROBLEM_REUSE_CONTRACT_FAILED',
            sourceHash,
            problemReuseOnlyContract: problemReuseOnlyPlan.contract,
            cleanupErrors: cleanup.errors,
          },
          { status: 409 },
        );
      }
    }
    if (payload.deferredOpenAIFileUpload) {
      try {
        payload.openaiFileId = await tryUploadOpenAIUserFile(payload.deferredOpenAIFileUpload);
      } catch (error) {
        if (sourceLeaseToken) {
          await markCourseSourceError({
            prisma,
            userId: auth.userId,
            courseId: id,
            sourceHash,
            leaseToken: sourceLeaseToken,
            errorReason: `Deferred source file upload failed: ${sourceIngestErrorReason(error)}`,
          }).catch(() => null);
        }
        throw error;
      }
      payload.deferredOpenAIFileUpload = undefined;
    }
    const processing = await markCourseSourceProcessing({
      prisma,
      userId: auth.userId,
      courseId: id,
      sourceHash,
      title: payload.sourceTitle,
      kind: payload.sourceKind,
      fileMime: payload.sourceFileMime,
      fileData: payload.originalFile,
      fileSize: payload.originalFileSize,
      openaiFileId: payload.openaiFileId,
      extractedText: payload.text,
      usageProfile: payload.usageProfile,
      metadata: {
        rawFileHash: payload.rawFileHash ?? null,
        parser: payload.parser ?? null,
        pageCount: payload.pageCount ?? null,
        slideCount: payload.slideCount ?? null,
        language: payload.language,
        targetNotebookId: payload.targetNotebookId ?? null,
      },
      leaseToken: sourceLeaseToken,
    });
    if (!processing.available) {
      const cleanup = await deleteOpenAIUserFiles(
        payload.openaiFileId ? [payload.openaiFileId] : [],
      );
      return NextResponse.json(
        {
          error: reuseOnlyPilot
            ? 'The source catalog became unavailable before the maintenance pilot reservation.'
            : 'The source catalog became unavailable before the fenced ingest reservation.',
          code: reuseOnlyPilot
            ? 'SOURCE_CATALOG_REQUIRED_FOR_MAINTENANCE_PILOT'
            : 'SOURCE_CATALOG_REQUIRED_FOR_INGEST',
          sourceHash,
          cleanupErrors: cleanup.errors,
        },
        { status: 503, headers: { 'Retry-After': '10' } },
      );
    }
    if (processing.available && !processing.source) {
      const conflictingSource = await findStoredCourseSource({
        prisma,
        userId: auth.userId,
        courseId: id,
        sourceHash,
      });
      if (conflictingSource.source) {
        return duplicateCourseSourceResponse(conflictingSource.source, payload.openaiFileId);
      }
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    sourceLeaseToken ||= processing.source?.ingestLeaseToken?.trim() || null;
    if (!processing.source || !sourceLeaseToken) {
      const cleanup = await deleteOpenAIUserFiles(
        payload.openaiFileId ? [payload.openaiFileId] : [],
      );
      return NextResponse.json(
        {
          error: 'Course source processing reservation did not return a fencing token.',
          code: 'SOURCE_INGEST_LEASE_REQUIRED',
          sourceHash,
          cleanupErrors: cleanup.errors,
        },
        { status: 503, headers: { 'Retry-After': '10' } },
      );
    }

    let result: SourceUploadIngestionResult;
    try {
      result = await ingestCourseSourceUpload({
        prisma,
        userId: auth.userId,
        courseId: id,
        sourceTitle: payload.sourceTitle,
        sourceKind: payload.sourceKind,
        sourceFileMime: payload.sourceFileMime,
        targetNotebookId: payload.targetNotebookId,
        language: payload.language,
        usageProfile: payload.usageProfile,
        text: payload.text,
        rawFileHash: payload.rawFileHash,
        openaiFileId: payload.openaiFileId,
        parser: payload.parser,
        pageCount: payload.pageCount,
        slideCount: payload.slideCount,
        model: resolved?.model,
        modelProviderId: resolved?.providerId,
        problemReuseOnlyPlan,
        coverTitle: payload.coverTitle,
        coverCourseLabel: payload.coverCourseLabel,
        coverFocus: payload.coverFocus,
        requireNotebookCover: payload.requireNotebookCover,
      });
      const ready = await markCourseSourceReady({
        prisma,
        userId: auth.userId,
        courseId: id,
        sourceHash: result.source.hash,
        leaseToken: sourceLeaseToken,
        title: result.source.title,
        kind: result.source.kind,
        fileMime: payload.sourceFileMime,
        openaiFileId: result.source.openaiFileId,
        usageProfile: result.classification.usageProfile,
        topic: result.classification.topic,
        metadata: sourceCatalogMetadata(payload, result),
        artifactCounts: sourceArtifactCounts(result),
      });
      if (!ready.available) {
        throw new Error('Course source catalog became unavailable before finalization');
      }
      if (!ready.source) {
        throw new CourseSourceIngestLeaseLostError();
      }
      if (ready.source) {
        after(async () => {
          const indexResult = await indexCourseSourceKnowledge({
            prisma,
            ownerId: auth.userId,
            courseId: id,
            sourceHash: result.source.hash,
          });
          if (!indexResult.indexed) {
            log.warn('Course source search projection was not completed.', {
              courseId: id,
              sourceHash: result.source.hash,
              reason: indexResult.reason,
              errorReason: indexResult.errorReason,
            });
          }
        });
      }
    } catch (error) {
      const originalReason = sourceIngestErrorReason(error);
      const cleanupErrors: string[] = [];
      let leaseLost = error instanceof CourseSourceIngestLeaseLostError;
      let ownsFailedSourceLease = false;

      try {
        const initialErrorState = await markCourseSourceError({
          prisma,
          userId: auth.userId,
          courseId: id,
          sourceHash,
          leaseToken: sourceLeaseToken,
          errorReason: originalReason,
        });
        if (!initialErrorState.available) {
          cleanupErrors.push(
            'CourseSource error state could not be persisted because the catalog schema is unavailable.',
          );
        } else if (!initialErrorState.source) {
          leaseLost = true;
          cleanupErrors.push(
            'CourseSource failure compensation was fenced out because this request no longer owns the ingest lease.',
          );
        } else {
          ownsFailedSourceLease = true;
        }
      } catch (catalogError) {
        cleanupErrors.push(
          `CourseSource error state persistence failed: ${sourceIngestErrorReason(catalogError, 600)}`,
        );
      }

      if (ownsFailedSourceLease) {
        try {
          const cleanup = await deleteCourseSourceUpload({
            prisma,
            userId: auth.userId,
            courseId: id,
            sourceHash,
            preserveCatalog: true,
            preserveProblems: true,
          });
          if (cleanup.deleted.problems !== 0) {
            cleanupErrors.push('Problem preservation invariant failed during compensation.');
          }
          cleanupErrors.push(...cleanup.cleanupErrors);
          log.info('Removed source-derived artifacts after failed ingestion.', {
            courseId: id,
            sourceHash,
            deleted: cleanup.deleted,
            preservedProblems: cleanup.preservedProblems,
            cleanupErrors: cleanup.cleanupErrors,
          });
        } catch (cleanupError) {
          cleanupErrors.push(
            `Derived artifact cleanup failed: ${sourceIngestErrorReason(cleanupError, 800)}`,
          );
        }
      } else {
        cleanupErrors.push(
          'Derived artifact cleanup was skipped because the request could not prove current lease ownership.',
        );
      }

      const failureReason = sourceIngestFailureReason(originalReason, cleanupErrors);

      log.error('Course source ingestion failed and compensation finished.', {
        courseId: id,
        sourceHash,
        originalError: originalReason,
        leaseLost,
        ownsFailedSourceLease,
        cleanupErrors,
      });
      const status = leaseLost
        ? 409
        : originalReason === 'Course not found'
          ? 404
          : originalReason === 'Uploaded source text is empty'
            ? 400
            : 500;
      return NextResponse.json(
        {
          error: failureReason,
          code: leaseLost ? 'SOURCE_INGEST_LEASE_LOST' : 'SOURCE_INGEST_FAILED',
          sourceHash,
          ingestStatus: ownsFailedSourceLease ? 'error' : 'unknown',
          originalError: originalReason,
          cleanupErrors,
        },
        { status, headers: leaseLost ? { 'Retry-After': '2' } : undefined },
      );
    }

    log.info('Production source ingestion finished.', {
      courseId: id,
      sourceTitle: payload.sourceTitle,
      aiSynthesisInput: result.source.aiSynthesisInput,
      coverStatus: result.notebookCover?.status ?? null,
      durationMs: Date.now() - ingestionStartedAt,
    });

    return NextResponse.json({
      storage: 'database',
      ingest: result,
    });
  });
}
