import { readFile, writeFile } from 'node:fs/promises';
import { resolveBackendAuth } from './syntara-backend-auth.mjs';

const [inputFile, credentialFile, receiptFile] = process.argv.slice(2);
if (!inputFile || !credentialFile || !receiptFile || process.argv.length !== 5) {
  console.error(
    'Usage: node scripts/learn/course-code-preflight.mjs INPUT.json CREDENTIAL.json RECEIPT.json',
  );
  process.exit(2);
}
try {
  const input = JSON.parse(await readFile(inputFile, 'utf8'));
  const auth = await resolveBackendAuth({ credentialFile });
  const response = await fetch(`${auth.origin}/api/native/v1/course-code-preflight`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await auth.getToken()}`,
      'Content-Type': 'application/json',
    },
    redirect: 'error',
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Preflight failed with HTTP ${response.status}`);
  const result = await response.json();
  if (!result.success || !result.data) throw new Error('Invalid preflight response');
  await writeFile(receiptFile, JSON.stringify(result.data, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(
    `Preflight ${result.data.valid ? 'passed' : 'failed'}; private receipt: ${receiptFile}`,
  );
  if (!result.data.valid) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Preflight failed');
  process.exitCode = 1;
}
