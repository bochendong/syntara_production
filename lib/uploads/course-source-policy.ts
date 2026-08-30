export const COURSE_SOURCE_MAX_FILE_SIZE_MB = 50;
export const COURSE_SOURCE_MAX_FILE_BYTES = COURSE_SOURCE_MAX_FILE_SIZE_MB * 1024 * 1024;

export type CourseSourceFileKind = 'pdf' | 'pptx' | 'docx' | 'markdown' | 'plain_text' | 'image';

type FileLike = Pick<File, 'name' | 'size' | 'type'>;

const EXTENSION_KIND = new Map<string, CourseSourceFileKind>([
  ['pdf', 'pdf'],
  ['pptx', 'pptx'],
  ['docx', 'docx'],
  ['md', 'markdown'],
  ['txt', 'plain_text'],
  ['jpg', 'image'],
  ['jpeg', 'image'],
  ['png', 'image'],
  ['webp', 'image'],
  ['gif', 'image'],
]);

const MIME_KIND = new Map<string, CourseSourceFileKind>([
  ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['text/markdown', 'markdown'],
  ['text/x-markdown', 'markdown'],
  ['text/plain', 'plain_text'],
  ['image/jpeg', 'image'],
  ['image/png', 'image'],
  ['image/webp', 'image'],
  ['image/gif', 'image'],
]);

export const COURSE_SOURCE_ACCEPT = [
  '.pdf',
  '.pptx',
  '.docx',
  '.md',
  '.txt',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  ...MIME_KIND.keys(),
].join(',');

export const COURSE_SOURCE_SUPPORTED_FORMATS =
  'PDF、PPTX、DOCX、Markdown（.md）、TXT、JPG、PNG、WebP 或 GIF';

function extensionOf(fileName: string): string {
  const normalized = fileName.trim().toLowerCase();
  const dot = normalized.lastIndexOf('.');
  return dot >= 0 ? normalized.slice(dot + 1) : '';
}

export function courseSourceFileKind(file: Pick<FileLike, 'name' | 'type'>) {
  const extensionKind = EXTENSION_KIND.get(extensionOf(file.name));
  const mimeKind = MIME_KIND.get((file.type || '').trim().toLowerCase());

  const compatibleTextKinds =
    extensionKind &&
    mimeKind &&
    [extensionKind, mimeKind].every((kind) => kind === 'markdown' || kind === 'plain_text');
  if (extensionKind && mimeKind && extensionKind !== mimeKind && !compatibleTextKinds) return null;
  return extensionKind || mimeKind || null;
}

export function courseSourceFileValidationError(file: FileLike): string | null {
  if (file.size <= 0) return `${file.name || '文件'} 为空，无法上传。`;
  if (!courseSourceFileKind(file)) {
    return `${file.name || '该文件'} 格式不支持。请选择 ${COURSE_SOURCE_SUPPORTED_FORMATS}。`;
  }
  if (file.size > COURSE_SOURCE_MAX_FILE_BYTES) {
    return `${file.name || '该文件'} 超过 ${COURSE_SOURCE_MAX_FILE_SIZE_MB}MB，请压缩后重试。`;
  }
  return null;
}

export function isCourseSourceFile(file: FileLike): boolean {
  return courseSourceFileValidationError(file) === null;
}

export function courseSourceKindLabel(kind: CourseSourceFileKind): string {
  if (kind === 'markdown') return 'Markdown';
  if (kind === 'plain_text') return 'TXT';
  if (kind === 'image') return '图片';
  return kind.toUpperCase();
}

export function normalizedCourseSourceMimeType(
  file: Pick<FileLike, 'name' | 'type'>,
  kind = courseSourceFileKind(file),
): string {
  const declared = (file.type || '').trim().toLowerCase();
  if (declared && MIME_KIND.has(declared)) return declared;
  if (kind === 'pdf') return 'application/pdf';
  if (kind === 'pptx') {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
  if (kind === 'docx') {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (kind === 'markdown') return 'text/markdown';
  if (kind === 'plain_text') return 'text/plain';
  const extension = extensionOf(file.name);
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'gif') return 'image/gif';
  return 'application/octet-stream';
}
