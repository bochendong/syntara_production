/** Bounded text snapshots; credentials and binary media are never retained in usage logs. */
export function serializeUsageContent(value: unknown): string | null {
  if (value == null) return null;
  let budget = 100_000;
  const seen = new WeakSet<object>();
  const clean = (item: unknown, key = '', depth = 0): unknown => {
    if (/^(api[_-]?key|authorization|password|access[_-]?token|secret|headers)$/i.test(key)) {
      return '[敏感字段已隐藏]';
    }
    if (budget <= 0 || depth > 20) return '[内容已截断]';
    budget -= 20;
    if (typeof item === 'string') {
      if (/^(data:.*;base64,)/i.test(item) || /^(b64_json|base64|imageBase64)$/i.test(key)) {
        return '[二进制媒体未保存]';
      }
      const text = item.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[密钥已隐藏]');
      const available = Math.max(0, budget);
      budget -= text.length;
      return text.length > available ? text.slice(0, available) + '\n[内容已截断]' : text;
    }
    if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) return '[二进制媒体未保存]';
    if (item instanceof URL) return clean(item.href, key, depth + 1);
    if (item && typeof item === 'object') {
      if (seen.has(item)) return '[重复引用]';
      seen.add(item);
      const entries = Array.isArray(item)
        ? item.map((v, i) => [String(i), v] as const)
        : Object.entries(item);
      const output: Record<string, unknown> = {};
      for (const [k, v] of entries) {
        if (budget <= 0) {
          output['…'] = '[内容已截断]';
          break;
        }
        output[k] = clean(v, k, depth + 1);
      }
      return Array.isArray(item) ? Object.values(output) : output;
    }
    return typeof item === 'bigint' ? String(item) : item;
  };
  const result = clean(value);
  return typeof result === 'string' ? result : (JSON.stringify(result, null, 2) ?? null);
}
