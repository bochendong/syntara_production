import crypto from 'node:crypto';
import OpenAI from 'openai';
import { createLogger } from '@/lib/logger';
import { proxyFetch } from '@/lib/server/proxy-fetch';
import { getSystemLLMRuntimeConfig } from '@/lib/server/system-llm-config';

const log = createLogger('EmbeddingClient');

export const DEFAULT_EMBEDDING_MODEL =
  process.env.STUDY_MEMORY_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

const EMBEDDING_BATCH_SIZE = 64;
const SINGLE_EMBEDDING_CACHE_TTL_MS = 2 * 60 * 1000;
const SINGLE_EMBEDDING_CACHE_MAX_ENTRIES = 128;

let clientPromise: Promise<OpenAI | null> | null = null;
let clientFingerprint: string | null = null;
let singleEmbeddingCache: Map<
  string,
  { expiresAt: number; promise: Promise<number[] | null> }
> | null = null;

async function getEmbeddingClient(): Promise<OpenAI | null> {
  const config = await getSystemLLMRuntimeConfig();
  if (!config.apiKey) {
    clientPromise = null;
    clientFingerprint = null;
    return null;
  }
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${config.baseUrl || ''}\n${config.apiKey}`)
    .digest('hex');

  if (!clientPromise || clientFingerprint !== fingerprint) {
    clientFingerprint = fingerprint;
    clientPromise = Promise.resolve(
      new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || undefined,
        fetch: proxyFetch as typeof fetch,
        timeout: 30_000,
        maxRetries: 1,
      }),
    ).catch((error) => {
      clientPromise = null;
      clientFingerprint = null;
      log.warn('Failed to initialize embedding client:', error);
      return null;
    });
  }
  return clientPromise;
}

export type EmbeddingBatchResult = {
  model: string;
  dimensions: number;
  embeddings: Array<number[] | null>;
  reason?: 'client_unavailable' | 'embedding_failed' | 'dimension_mismatch';
};

/**
 * Creates embeddings lazily and sends multiple inputs in one provider request
 * whenever possible. Callers keep their original input ordering.
 */
export async function createEmbeddings(
  inputs: string[],
  options: {
    model?: string;
    dimensions?: number;
  } = {},
): Promise<EmbeddingBatchResult> {
  const model = options.model?.trim() || DEFAULT_EMBEDDING_MODEL;
  const dimensions = options.dimensions || DEFAULT_EMBEDDING_DIMENSIONS;
  if (inputs.length === 0) return { model, dimensions, embeddings: [] };

  const client = await getEmbeddingClient();
  if (!client) {
    return {
      model,
      dimensions,
      embeddings: inputs.map(() => null),
      reason: 'client_unavailable',
    };
  }

  const embeddings: Array<number[] | null> = inputs.map(() => null);
  try {
    for (let start = 0; start < inputs.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = inputs.slice(start, start + EMBEDDING_BATCH_SIZE);
      const response = await client.embeddings.create({
        model,
        input: batch,
        dimensions,
      });
      for (const item of response.data) {
        const position = start + item.index;
        if (position < start || position >= start + batch.length) continue;
        embeddings[position] = item.embedding.length === dimensions ? item.embedding : null;
      }
    }
  } catch (error) {
    log.warn('Embedding batch request failed:', error);
    return { model, dimensions, embeddings, reason: 'embedding_failed' };
  }

  return {
    model,
    dimensions,
    embeddings,
    reason: embeddings.some((embedding) => embedding === null) ? 'dimension_mismatch' : undefined,
  };
}

export async function createEmbedding(
  input: string,
  options: {
    model?: string;
    dimensions?: number;
  } = {},
): Promise<number[] | null> {
  const model = options.model?.trim() || DEFAULT_EMBEDDING_MODEL;
  const dimensions = options.dimensions || DEFAULT_EMBEDDING_DIMENSIONS;
  const key = `${model}:${dimensions}:${crypto.createHash('sha256').update(input).digest('hex')}`;
  const now = Date.now();
  const cache = singleEmbeddingCache || new Map();
  singleEmbeddingCache = cache;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  if (cached) cache.delete(key);

  const promise = createEmbeddings([input], { model, dimensions })
    .then((result) => result.embeddings[0] || null)
    .catch((error) => {
      log.warn('Single embedding request failed:', error);
      return null;
    });
  cache.set(key, {
    expiresAt: now + SINGLE_EMBEDDING_CACHE_TTL_MS,
    promise,
  });
  while (cache.size > SINGLE_EMBEDDING_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    cache.delete(oldestKey);
  }

  const embedding = await promise;
  if (!embedding) cache.delete(key);
  return embedding;
}
