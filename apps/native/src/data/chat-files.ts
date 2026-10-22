/** 聊天里附文件：PDF、Word、PPT 和纯文本原样发给平台，由服务端抽成文字交给助教。 */

export const MAX_CHAT_FILES = 3;
export const MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024;

const TEXT_EXTENSIONS =
  'txt|md|markdown|csv|tsv|json|tex|py|js|jsx|ts|tsx|java|c|cc|cpp|h|hpp|cs|go|rs|rb|php|swift|kt|m|r|sql|html|css|xml|yaml|yml';

/** 聊天“+”按钮的文件选择器：图片和这些文件都能选。 */
export const CHAT_ATTACH_ACCEPT = [
  'image/*',
  'application/pdf',
  '.pdf',
  '.docx',
  '.pptx',
  ...TEXT_EXTENSIONS.split('|').map((ext) => `.${ext}`),
  'text/*',
].join(',');

export type ChatFileKind = 'pdf' | 'doc' | 'slides' | 'text';

export interface PendingChatFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: ChatFileKind;
  /** Base64（不带 data: 前缀）。 */
  dataBase64: string;
}

/** 存在用户消息上，历史里显示附过哪些文件（原文件不保存）。 */
export interface ChatFileChip {
  name: string;
  kind: ChatFileKind;
  size?: number;
}

export function chatFileKind(file: Pick<File, 'name' | 'type'>): ChatFileKind | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx') || file.type.includes('wordprocessingml')) return 'doc';
  if (name.endsWith('.pptx') || file.type.includes('presentationml')) return 'slides';
  if (file.type.startsWith('text/') || new RegExp(`\\.(${TEXT_EXTENSIONS})$`).test(name)) {
    return 'text';
  }
  return null;
}

export const CHAT_FILE_LABEL: Record<ChatFileKind, string> = {
  pdf: 'PDF',
  doc: 'DOC',
  slides: 'PPT',
  text: 'TXT',
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error(`“${file.name}”无法读取。`));
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      resolve(value.slice(value.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

export async function prepareChatFile(file: File): Promise<PendingChatFile> {
  const kind = chatFileKind(file);
  if (!kind) {
    throw new Error(
      /\.(doc|ppt|xls|xlsx|key|pages|numbers)$/i.test(file.name)
        ? `“${file.name}”请另存为 PDF、.docx 或 .pptx 再发。`
        : `“${file.name}”暂不支持；可以发图片、PDF、Word、PPT 或文本文件。`,
    );
  }
  if (file.size > MAX_CHAT_FILE_BYTES) {
    throw new Error(`“${file.name}”超过 10 MB。`);
  }
  if (!file.size) throw new Error(`“${file.name}”是空文件。`);
  return {
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    kind,
    dataBase64: await readBase64(file),
  };
}

export function chatFileChips(metadata: unknown): ChatFileChip[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const files = (metadata as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const { name, kind, size } = item as Record<string, unknown>;
    if (typeof name !== 'string') return [];
    return [
      {
        name,
        kind: kind === 'pdf' || kind === 'doc' || kind === 'slides' ? kind : 'text',
        size: typeof size === 'number' ? size : undefined,
      },
    ];
  });
}
