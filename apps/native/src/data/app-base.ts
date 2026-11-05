/** Bundled media sit at the app root; builds served under a sub-path (e.g. /home-showcase/) need the prefix. */
export function withAppBase(url: string): string {
  const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '');
  return url.startsWith('/') && base && !url.startsWith(`${base}/`) ? `${base}${url}` : url;
}
