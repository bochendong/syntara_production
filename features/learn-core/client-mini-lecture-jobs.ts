'use client';
import { backendJson } from '@/lib/utils/backend-api';
import type { GeneratedMiniLectureManifest, MiniLecturePrompt } from './client-mini-lecture';

export class MiniLectureJobFailed extends Error {
  readonly name = 'MiniLectureJobFailed';
}

export type MiniLectureJob = { id: string; status: string; error?: string };
export async function waitForMiniLectureJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<{ manifest: GeneratedMiniLectureManifest; prompt: MiniLecturePrompt }> {
  // Waiting is UI observation only. Closing the page never cancels durable work.
  while (!signal?.aborted) {
    const result = await backendJson<{
      job: MiniLectureJob;
      data?: GeneratedMiniLectureManifest;
      prompt?: MiniLecturePrompt;
    }>(`/api/learn/mini-lectures?id=${encodeURIComponent(jobId)}`, { signal });
    if (result.job.status === 'completed' && result.data && result.prompt)
      return { manifest: result.data, prompt: result.prompt };
    if (result.job.status === 'failed')
      throw new MiniLectureJobFailed(result.job.error || '课堂生成失败，请重试。');
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, 2500);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  throw new DOMException('Aborted', 'AbortError');
}
