/** Browser session checks must finish or expose a retry, including slow response bodies. */
export async function requestBrowserAuthUser({
  fetchImpl = fetch,
  timeoutMs = 12_000,
}: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<unknown | null> {
  const controller = new AbortController();
  const signal = controller.signal;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('/api/native/v1/auth/browser', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw new Error('登录验证暂时不可用，请重试连接。');
    const result = await response.json();
    return result.data?.user;
  } catch (cause) {
    if (signal.aborted) throw new Error('登录验证超时，请检查网络后重试连接。');
    if (cause instanceof TypeError) throw new Error('无法连接登录服务，请检查网络后重试连接。');
    throw new Error('登录验证暂时不可用，请重试连接。');
  } finally {
    clearTimeout(timer);
  }
}
