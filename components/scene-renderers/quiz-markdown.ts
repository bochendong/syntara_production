import type { QuizQuestion } from '@/lib/types/stage';

function mapHintToShikiLang(hint?: string | null): string {
  const h = (hint ?? '').trim().toLowerCase();
  if (!h) return 'plaintext';
  if (h === 'cpp' || h === 'c++' || h === 'cc') return 'cpp';
  if (h === 'c') return 'c';
  if (h === 'py' || h === 'python') return 'python';
  if (h === 'java') return 'java';
  if (h === 'racket') return 'racket';
  if (h === 'js' || h === 'javascript') return 'javascript';
  if (h === 'ts' || h === 'typescript') return 'typescript';
  if (h === 'go') return 'go';
  if (h === 'rust' || h === 'rs') return 'rust';
  if (h === 'cs' || h === 'csharp' || h === 'c#') return 'csharp';
  return /^[a-z0-9#+-]{1,24}$/i.test(h) ? h : 'plaintext';
}

function guessShikiLanguageFromLines(lines: string[]): string {
  const first = lines.map((l) => l.trim()).find(Boolean) ?? '';
  if (/^#include\s*[<"]/.test(first)) return 'cpp';
  if (/^#lang\s+racket\b/i.test(first) || /^\(\s*define\b/.test(first)) return 'racket';
  if (
    /^package\s+\w+/.test(first) ||
    /^public\s+class\b/.test(first) ||
    /^import\s+java\./.test(first)
  ) {
    return 'java';
  }
  if (/^using\s+namespace\b|^int\s+main\s*\(/.test(first)) return 'cpp';
  if (/^def\s+\w+\s*\(|^from\s+\S+\s+import\b|^import\s+\w+/.test(first)) return 'python';
  return 'plaintext';
}

function expandSmushedStatements(code: string, languageHint?: string): string {
  const l = (languageHint ?? '').trim().toLowerCase();
  let out = code;
  if (l === 'python' || l === 'py' || (!l && /\bimport\s+\w+\b/.test(out))) {
    out = out.replace(/\b(import\s+[\w.]+)\s+(?=[a-zA-Z_][\w.]*\s*=)/g, '$1\n');
    out = out.replace(/(?<=.)\s+(?=\bimport\b\s)/g, '\n');
    out = out.replace(/(?<=.)\s+(?=\bfrom\s+\S+\s+import\b)/g, '\n');
    out = out.replace(/(?<=.)\s+(?=\bdef\b\s)/g, '\n');
    out = out.replace(/(?<=.)\s+(?=\bclass\b\s)/g, '\n');
  }
  if (l === 'java' || l === 'jav') {
    out = out.replace(
      /;\s+(?=(?:public|private|protected|static|final|class|interface|enum|import|package)\b)/g,
      ';\n',
    );
  }
  return out;
}

function looksLikeCodeLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return (
    /^\s*(\d+[.)]\s+)?(import\s|from\s+\S+\s+import\b|def\s|class\s|#include\s|using\s+namespace\b|namespace\s|public\s+(class|static|void|int)\b|private\s|protected\s|package\s+|#lang\b|\(\s*define\b|fun\s|fn\s|val\s|let\s|struct\s|enum\s|impl\s|\/\/|\/\*|\*\/)/.test(
      t,
    ) ||
    (/(?:[{}();]|\breturn\b|\bif\b|\bfor\b|\bwhile\b)/.test(t) && /[=;{}\[\]]/.test(t))
  );
}

function isProbablyCodeParagraph(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const nonEmpty = t.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (nonEmpty.length === 0) return false;
  if (nonEmpty.some((line) => /[\u3000-\u303f\u4e00-\u9fff]/.test(line))) {
    return false;
  }
  if (nonEmpty.length === 1) {
    const line = nonEmpty[0];
    if (/[\u4e00-\u9fff]/.test(line)) return false;
    return (
      looksLikeCodeLine(line) ||
      (/^\s*import\s+\w+/.test(line) && (/[=.]/.test(line) || /\s/.test(line)))
    );
  }
  const hits = nonEmpty.filter(looksLikeCodeLine).length;
  return hits >= Math.ceil(nonEmpty.length * 0.55);
}

function fenceStandaloneCodeParagraphs(markdown: string, languageHint?: string): string {
  if (!markdown.trim() || markdown.includes('```')) return markdown;
  return markdown
    .split(/\n\n+/)
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed || trimmed.startsWith('```')) return part;
      if (!isProbablyCodeParagraph(trimmed)) return part;
      const lines = trimmed.split(/\r?\n/);
      const lang =
        languageHint?.trim() !== ''
          ? mapHintToShikiLang(languageHint)
          : guessShikiLanguageFromLines(lines);
      const body = expandSmushedStatements(trimmed, languageHint);
      return `\`\`\`${lang}\n${body}\n\`\`\``;
    })
    .join('\n\n');
}

function fenceTrailingCodeAfterProse(block: string, languageHint?: string): string {
  if (!block.trim() || block.includes('```')) return block;
  const anchor =
    /\b(?:import\s+[\w.]+|from\s+\S+\s+import\b|def\s+\w+\s*\(|class\s+\w+|#include\s*[<"]|public\s+class\b|package\s+\w+|\(\s*define\b|#lang\s+\w+)/;
  const m = anchor.exec(block);
  if (!m || m.index === 0) return block;
  const prose = block.slice(0, m.index).trimEnd();
  if (prose.length < 2) return block;
  let codePart = block.slice(m.index).trim();
  codePart = expandSmushedStatements(codePart, languageHint);
  const lang =
    languageHint?.trim() !== ''
      ? mapHintToShikiLang(languageHint)
      : guessShikiLanguageFromLines(codePart.split(/\r?\n/));
  return `${prose}\n\n\`\`\`${lang}\n${codePart}\n\`\`\``;
}

export function normalizeMarkdownForHighlightedCode(
  content: string,
  languageHint?: string,
): string {
  let md = content;
  md = fenceTrailingCodeAfterProse(md, languageHint);
  md = fenceStandaloneCodeParagraphs(md, languageHint);
  return md;
}

export function getDisplayQuestionText(question: QuizQuestion): string {
  const raw = question.question?.trim() ?? '';
  if (!raw || !question.codeSnippet?.trim()) return raw;

  const snippetFirstLine = question.codeSnippet
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (snippetFirstLine) {
    const exactIdx = raw.indexOf(snippetFirstLine);
    if (exactIdx > 0) return raw.slice(0, exactIdx).trim();
  }

  const inlineCodeAnchor =
    /\b(?:python|java|javascript|typescript|cpp|c\+\+|go|rust|racket|code)\b\s+(?=(?:def|class|function|import|from|public|const|let|var|for|if|while|print)\b)/i;
  const m = inlineCodeAnchor.exec(raw);
  if (m && m.index > 0) return raw.slice(0, m.index).trim();

  return raw;
}
