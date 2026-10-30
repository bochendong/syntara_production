import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { COURSE_PROBLEM_IMPORT_DOCUMENTS: documents, COURSE_PROBLEM_IMPORT_GUIDE: guide } = jiti(
  '../../lib/course-problem-import-guide.ts',
);

/** Run inside the real build context, which may exclude files available in a checkout. */
export async function verifyPublishedImportDocuments(root) {
  const result = [];
  for (const document of documents) {
    let content;
    try {
      content = await readFile(path.join(root, 'docs/api', document));
    } catch {
      throw new Error(`Published import document missing from build context: ${document}`);
    }
    const sha256 = createHash('sha256').update(content).digest('hex');
    if (document === 'ai-course-problem-upload.md' && sha256 !== guide.sha256)
      throw new Error('Published import guide differs from its reviewed SHA-256.');
    result.push({ document, bytes: content.length, sha256 });
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyPublishedImportDocuments(process.cwd());
  console.log(
    `PASS: ${result.length} published import documents present; reviewed guide hash matches.`,
  );
}
