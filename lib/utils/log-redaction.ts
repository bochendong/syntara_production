const INLINE_DATA_URL_PATTERN =
  /data:([a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+)[^,\s]*,[^\s'")\]}]+/gi;

/** Prevent browser-local attachment bytes from being retained in runtime logs. */
export function redactInlineDataUrls(value: string): string {
  return value.replace(
    INLINE_DATA_URL_PATTERN,
    (_match, mediaType: string) => `data:${mediaType};[redacted]`,
  );
}
