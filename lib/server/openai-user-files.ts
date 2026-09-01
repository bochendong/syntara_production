import { randomBytes } from 'node:crypto';
import { getSystemLLMRuntimeConfig } from '@/lib/server/system-llm-config';
import { proxyFetch, proxyRequest } from '@/lib/server/proxy-fetch';

const OPENAI_STEP_TIMEOUT_MS = 120_000;
const OPENAI_FILE_CONTENT_RETRY_DELAYS_MS = [0, 500, 1_500, 3_000] as const;
export const OPENAI_BROWSER_UPLOAD_PART_BYTES = 3 * 1024 * 1024;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function openAIErrorDetail(response: Response): Promise<string> {
  const responseText = await response.text().catch(() => '');
  const payload = (() => {
    try {
      return JSON.parse(responseText) as unknown;
    } catch {
      return null;
    }
  })();
  const error = asRecord(asRecord(payload)?.error);
  const detail =
    (typeof error?.message === 'string' && error.message.trim()) ||
    responseText.replace(/\s+/g, ' ').trim().slice(0, 300) ||
    'OpenAI 未返回错误说明';
  const requestId = response.headers.get('x-request-id')?.trim();
  return requestId ? `${detail}（request_id: ${requestId}）` : detail;
}

async function officialOpenAIConfig() {
  const config = await getSystemLLMRuntimeConfig();
  if (!config.apiKey) throw new Error('系统 OpenAI API Key 尚未配置。');
  const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('系统 OpenAI Base URL 配置无效。');
  }
  if (parsed.hostname !== 'api.openai.com' || parsed.pathname.replace(/\/+$/, '') !== '/v1') {
    throw new Error('文件分片上传目前仅支持 OpenAI 官方 API（https://api.openai.com/v1）。');
  }
  return { apiKey: config.apiKey, baseUrl };
}

async function requestJson(args: {
  url: string;
  apiKey: string;
  method: 'POST';
  body?: string | Buffer;
  contentType?: string;
}): Promise<Record<string, unknown>> {
  const response = await proxyRequest(args.url, {
    method: args.method,
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      ...(args.contentType ? { 'content-type': args.contentType } : {}),
      ...(Buffer.isBuffer(args.body) ? { 'content-length': String(args.body.byteLength) } : {}),
    },
    body: args.body,
    headersTimeout: OPENAI_STEP_TIMEOUT_MS,
    bodyTimeout: OPENAI_STEP_TIMEOUT_MS,
    signal: AbortSignal.timeout(OPENAI_STEP_TIMEOUT_MS),
  });
  const responseText = await response.body.text();
  const payload = (() => {
    try {
      return JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const error = asRecord(payload.error);
    const detail = typeof error?.message === 'string' ? error.message : responseText.slice(0, 300);
    throw new Error(`OpenAI 文件上传失败（HTTP ${response.statusCode}）：${detail}`);
  }
  return payload;
}

export async function createOpenAIUserUpload(args: {
  fileName: string;
  mimeType: string;
  bytes: number;
}): Promise<string> {
  const config = await officialOpenAIConfig();
  const payload = await requestJson({
    url: `${config.baseUrl}/uploads`,
    apiKey: config.apiKey,
    method: 'POST',
    contentType: 'application/json',
    body: JSON.stringify({
      purpose: 'user_data',
      filename: args.fileName,
      bytes: args.bytes,
      mime_type: args.mimeType,
    }),
  });
  if (typeof payload.id !== 'string') throw new Error('OpenAI 未返回 upload_id。');
  return payload.id;
}

function multipartPartBody(chunk: Buffer, partIndex: number) {
  const boundary = `----SyntaraOpenAIPart${randomBytes(12).toString('hex')}`;
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="data"; filename="part-${String(partIndex).padStart(4, '0')}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([prefix, chunk, suffix]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export async function addOpenAIUserUploadPart(args: {
  uploadId: string;
  partIndex: number;
  chunk: Buffer;
}): Promise<string> {
  const config = await officialOpenAIConfig();
  const multipart = multipartPartBody(args.chunk, args.partIndex);
  const payload = await requestJson({
    url: `${config.baseUrl}/uploads/${encodeURIComponent(args.uploadId)}/parts`,
    apiKey: config.apiKey,
    method: 'POST',
    body: multipart.body,
    contentType: multipart.contentType,
  });
  if (typeof payload.id !== 'string') throw new Error('OpenAI 未返回 part_id。');
  return payload.id;
}

export async function completeOpenAIUserUpload(args: {
  uploadId: string;
  partIds: string[];
}): Promise<string> {
  const config = await officialOpenAIConfig();
  const payload = await requestJson({
    url: `${config.baseUrl}/uploads/${encodeURIComponent(args.uploadId)}/complete`,
    apiKey: config.apiKey,
    method: 'POST',
    body: JSON.stringify({ part_ids: args.partIds }),
    contentType: 'application/json',
  });
  const file = asRecord(payload.file);
  if (typeof file?.id !== 'string') throw new Error('OpenAI 完成上传后未返回 file_id。');
  return file.id;
}

export async function cancelOpenAIUserUpload(uploadId: string): Promise<void> {
  const config = await officialOpenAIConfig();
  await requestJson({
    url: `${config.baseUrl}/uploads/${encodeURIComponent(uploadId)}/cancel`,
    apiKey: config.apiKey,
    method: 'POST',
  });
}

export async function downloadOpenAIUserFile(fileId: string): Promise<Buffer> {
  const config = await officialOpenAIConfig();
  let lastFailure = 'OpenAI 未返回错误说明';
  let lastStatus = 502;
  for (const retryDelay of OPENAI_FILE_CONTENT_RETRY_DELAYS_MS) {
    if (retryDelay > 0) await delay(retryDelay);
    const response = await proxyFetch(
      `${config.baseUrl}/files/${encodeURIComponent(fileId)}/content`,
      {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(OPENAI_STEP_TIMEOUT_MS),
      },
    );
    if (response.ok) return Buffer.from(await response.arrayBuffer());

    lastStatus = response.status;
    lastFailure = await openAIErrorDetail(response);
    const retryable =
      response.status === 400 ||
      response.status === 404 ||
      response.status === 409 ||
      response.status === 425 ||
      response.status === 429 ||
      response.status >= 500;
    if (!retryable) break;
  }
  throw new Error(`OpenAI 文件读取失败（HTTP ${lastStatus}）：${lastFailure}`);
}

export async function deleteOpenAIUserFile(fileId: string): Promise<void> {
  const config = await officialOpenAIConfig();
  const response = await proxyFetch(`${config.baseUrl}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(OPENAI_STEP_TIMEOUT_MS),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`OpenAI 文件删除失败（HTTP ${response.status}）。`);
  }
}
