import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const attachmentRoute = fs.readFileSync(
  path.join(root, 'app/api/course-forum/[courseId]/attachments/[attachmentId]/route.ts'),
  'utf8',
);

const checks = [
  {
    name: 'forum attachment names use RFC 5987 UTF-8 encoding',
    pass:
      attachmentRoute.includes("filename*=UTF-8''${encodedFileName(safeName)}") &&
      attachmentRoute.includes('return encodeURIComponent(value).replace(') &&
      attachmentRoute.includes("/[!'()*]/g"),
  },
  {
    name: 'forum attachment headers keep an ASCII-only filename fallback',
    pass:
      attachmentRoute.includes("safeName.replace(/[^\\x20-\\x7e]/g, '_')") &&
      attachmentRoute.includes('filename="${asciiFallback}"'),
  },
  {
    name: 'forum attachment responses retain their image MIME and nosniff protection',
    pass:
      attachmentRoute.includes("'Content-Type': attachment.mimeType") &&
      attachmentRoute.includes("'X-Content-Type-Options': 'nosniff'"),
  },
];

let failed = false;
for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'}: ${check.name}`);
  failed ||= !check.pass;
}

if (failed) process.exit(1);
