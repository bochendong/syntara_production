#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      out: { type: 'string' },
      url: { type: 'string', default: process.env.SYNTARA_API_BASE_URL || 'http://localhost:3000' },
      language: { type: 'string', default: 'zh-CN' },
      'verify-answers': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(
      'Usage: node scripts/problem-import.mjs --file questions.pdf [--out result.json] [--url http://localhost:3000] [--language en-US] [--verify-answers]',
    );
    return;
  }
  if (!values.file) throw new Error('--file is required.');
  const token = process.env.SYNTARA_PUBLIC_API_KEY?.trim();
  if (!token) throw new Error('Set SYNTARA_PUBLIC_API_KEY to your Syntara Bearer token.');
  if (!['zh-CN', 'en-US'].includes(values.language)) {
    throw new Error('--language must be zh-CN or en-US.');
  }
  const buffer = await readFile(values.file);
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) {
    throw new Error('PDF must be non-empty and at most 20 MiB.');
  }
  const form = new FormData();
  form.set('file', new Blob([buffer], { type: 'application/pdf' }), basename(values.file));
  form.set('language', values.language);
  form.set('verify_answers', String(values['verify-answers']));
  const response = await fetch(`${values.url.replace(/\/+$/, '')}/api/v1/problem-imports`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(600_000),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(`${response.status}: ${result.error?.message || 'Problem import failed.'}`);
  }
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (values.out) {
    await writeFile(values.out, json);
    console.error(`Saved ${result.data.problems.length} problems to ${values.out}`);
  } else {
    process.stdout.write(json);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
