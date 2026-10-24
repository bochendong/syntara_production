import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export type DesktopReleaseInfo = {
  version: string;
  builtAt: string;
  fileName: string;
  size: number;
  sha256: string;
  channel: 'staging';
  architecture: 'arm64';
  minimumSystemVersion: '14.0';
  notarized: boolean;
};

export async function readDesktopRelease(
  directory = process.env.SYNTARA_DESKTOP_RELEASES_DIR ||
    path.join(process.cwd(), '.data', 'desktop-releases'),
): Promise<{ info: DesktopReleaseInfo; filePath: string } | null> {
  try {
    const value = JSON.parse(await readFile(path.join(directory, 'macos-arm64.json'), 'utf8'));
    if (
      typeof value.version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value.version) ||
      typeof value.builtAt !== 'string' ||
      !Number.isFinite(Date.parse(value.builtAt)) ||
      typeof value.fileName !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/.test(value.fileName) ||
      !Number.isSafeInteger(value.size) ||
      value.size <= 0 ||
      typeof value.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.sha256) ||
      value.channel !== 'staging' ||
      value.architecture !== 'arm64' ||
      value.minimumSystemVersion !== '14.0' ||
      typeof value.notarized !== 'boolean'
    ) {
      return null;
    }
    const filePath = path.join(directory, value.fileName);
    const file = await stat(filePath);
    if (!file.isFile() || file.size !== value.size) return null;
    const info: DesktopReleaseInfo = {
      version: value.version,
      builtAt: value.builtAt,
      fileName: value.fileName,
      size: value.size,
      sha256: value.sha256,
      channel: value.channel,
      architecture: value.architecture,
      minimumSystemVersion: value.minimumSystemVersion,
      notarized: value.notarized,
    };
    return { info, filePath };
  } catch {
    return null;
  }
}

/** Single byte ranges let browsers resume an interrupted installer download. */
export function parseDownloadRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return null;
  const start = match[1] ? first : Math.max(0, size - last);
  const end = match[1] && match[2] ? Math.min(last, size - 1) : size - 1;
  if ((!match[1] && last === 0) || start >= size || start > end) return null;
  return { start, end };
}
